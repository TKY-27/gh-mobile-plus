# 0012. Spikes pending at release and the defaults in force

- Status: Accepted
- Date: 2026-11-18

## Context

SPEC §12 asks for spikes S1 (Notifications with expiring tokens), S2 (cross-origin readability of Actions job logs) and S3 (OAuth inside iOS standalone and an Android WebAPK) to be run at the start of the build, with each result recorded in an ADR. They need a development OAuth App and real devices. No OAuth App credentials were available during the build, so none of the spikes has been run.

## Decision

Ship v1 with the defaults and fallbacks the spec defines, and treat the spikes as a release gate for the operator:

- **S1:** `GHM_TOKEN_MODE=expiring`. If Notifications rejects expiring tokens, set `persistent`; no code change is needed.
- **S2:** `LOGS_READABLE = true`. Any log fetch that fails cross-origin while online already falls back to "Open on GitHub". `connect-src` keeps `https://*.actions.githubusercontent.com` and `https://*.blob.core.windows.net` until the observed hosts are known.
- **S3:** no change. If the round trip fails in an installed app, document browser-tab sign-in as SPEC §12 describes.

The procedure is in `docs/TESTING.md`. Each result gets its own ADR, and S2's result must reduce `connect-src` to the exact hosts observed (SPEC §7.2).

## Consequences

- Until S2 runs, `connect-src` allows every Azure Blob host. The CSP still blocks inline scripts and other origins, so this widens only where an injected script could send data, and only after a separate sanitizer failure.
- If S1 fails, the Inbox fails with `authExpired` or `forbidden` in `expiring` mode until the deployment switches modes.
