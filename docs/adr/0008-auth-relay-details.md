# 0008. Auth relay details

- Status: Accepted
- Date: 2026-11-17

## Context

SPEC 4.2 leaves a few details of the `/auth/*` Worker open: where the user returns after sign-in, how the five-account limit is reported, the unit of `expiresAt`, how the client learns the OAuth client id needed for the organization-approval link (SPEC 4.5), and how end-to-end tests can sign in without contacting github.com.

## Decision

- `GET /auth/login` accepts `return=<path>`. A value that does not start with `/`, or contains a control character or a backslash, is rejected; otherwise it is resolved against the request origin with `new URL()` and accepted only if the resulting origin equals the request origin. Anything else becomes `/`. The callback redirects there.
- A sixth distinct account is refused with `/signin?error=account_limit`. Re-authenticating an existing account is always allowed. Account cookies are `SameSite=Strict` and are not sent on the cross-site return from GitHub, so `/auth/login` records the ids of the existing accounts in the encrypted OAuth cookie and the callback checks the limit against that list.
- `expiresAt` is epoch milliseconds, or `null` in `persistent` mode.
- `GET /auth/accounts` sends the client id in the `X-GHM-Client-Id` response header. The client id is public, and this keeps it in one place: the Worker's environment.
- `GHM_GITHUB_OAUTH_ORIGIN` and `GHM_GITHUB_API_ORIGIN` override the GitHub origins for the Worker's own calls. They exist only so end-to-end tests can run a mock OAuth server. Like `GHM_DEV_INSECURE_COOKIES`, they are honored only when the request host is `localhost` or `127.0.0.1`.
- `GET /auth/login` defaults to `mode=add` and `public=0`. `mode=reauth` requires a positive integer `account`. Invalid parameters return 400 `{ "error": "invalid_request" }` without setting a cookie.
- If a reauth signs in as a different GitHub user, it is treated as adding that user.
- Token requests to GitHub send their parameters in a form body, never in a URL.
- In `expiring` mode the account cookie's `Max-Age` is the refresh token's remaining lifetime. In `persistent` mode it is 400 days, the browser maximum.
- An account cookie that cannot be decrypted (for example, after its key was removed) is ignored by `/auth/accounts` and does not count toward the limit.
- `POST /auth/logout` always deletes the cookie and returns 204, even when there is no cookie or GitHub's revocation fails.
- `POST /auth/token` returns 502 `{ "error": "upstream_failed" }` for GitHub failures other than `bad_refresh_token`, and keeps the cookie. A missing or invalid secret returns 500 `{ "error": "server_misconfigured" }`. Unexpected Worker errors return 500 `{ "error": "internal_error" }`.
- `public/_headers` does not apply to Function responses, so every `/auth/*` response sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` itself.

## Consequences

- The return path cannot be used as an open redirect.
- The client needs no build-time copy of the client id.
- A production deployment that sets the override variables by mistake still talks to GitHub, because the overrides are ignored for non-local hosts.
