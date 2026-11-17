# 0001. OAuth App instead of GitHub App

- Status: Accepted
- Date: 2026-11-17

## Context

The project brief asked for "secure authentication via a GitHub App". Two GitHub constraints conflict with that:

- The Notifications REST endpoints do not work with GitHub App user access tokens, GitHub App installation tokens, or fine-grained PATs.
- A GitHub App user access token can only act where both the user and the app have access. Write actions (commenting, reviewing) in repositories where the app is not installed are therefore unavailable. A general-purpose client cannot require every repository owner to install it.

## Decision

Use an OAuth App with the authorization-code flow, PKCE (S256) and expiring user tokens. Offer a "public repositories only" sign-in that requests `public_repo` instead of `repo`.

## Consequences

- Notifications and cross-repository writes work like on github.com.
- Scopes are coarser than GitHub App permissions, partly mitigated by the public-only mode.
- Organizations with OAuth App access restrictions or SAML SSO need approval or SSO authorization; the app detects this case and explains it (SPEC 4.5).
- Whether Notifications accepts expiring OAuth tokens is unverified. Spike S1 decides, with `GHM_TOKEN_MODE=persistent` as the fallback.
