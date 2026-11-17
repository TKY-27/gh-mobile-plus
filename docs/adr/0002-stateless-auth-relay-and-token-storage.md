# 0002. Stateless auth relay and token storage

- Status: Accepted
- Date: 2026-11-17

## Context

GitHub's token endpoint has no CORS support and requires `client_secret`, so a pure static PWA cannot finish OAuth. The project must cost nothing to run and must not hold user data.

## Decision

- A same-origin Cloudflare Pages Function under `/auth/*` performs code exchange, refresh, account listing and logout. It stores nothing.
- Refresh tokens live in per-account AES-256-GCM encrypted `HttpOnly`, `Secure`, `SameSite=Strict` cookies, with rotatable keys.
- Access tokens live only in JavaScript memory. All GitHub API traffic goes from the browser directly to `api.github.com`.
- Refresh is single-flight across tabs, using Web Locks plus BroadcastChannel, because refresh tokens are single-use.

## Alternatives rejected

- Proxying all API traffic through the Worker: tokens transit the server on every call, and request volume would exceed the free tier.
- Storing tokens in localStorage or IndexedDB: maximizes the impact of XSS and storage inspection.
- Device flow: also relies on the non-CORS token endpoint, and is worse UX on a phone.

## Consequences

- XSS can still use the in-memory token or call `/auth/token`. This is mitigated by a strict CSP, a single sanitizer, and `Origin` and custom-header checks.
- If the app is suspended mid-refresh, the session can be lost. This is accepted and documented in the help screen.
