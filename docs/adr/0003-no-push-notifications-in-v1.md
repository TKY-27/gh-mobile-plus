# 0003. No push notifications in v1

- Status: Accepted
- Date: 2026-11-17

## Context

GitHub offers no webhook for a user's notification inbox. Delivering Web Push would require a server that stores every user's token and polls GitHub on their behalf. That contradicts the zero-cost and no-server-side-data goals.

## Decision

Do not deliver push notifications in v1. While the app is visible, it polls `/notifications` with `If-Modified-Since`, honoring `X-Poll-Interval`. An opt-in setting updates the app icon badge; on iOS this requires notification permission.

## Consequences

- The app competes on triage experience, not on alert delivery.
- Revisit only together with a design that keeps tokens off the server.
