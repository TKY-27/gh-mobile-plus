# Security Policy

GH Mobile+ handles GitHub access tokens, so security reports are taken seriously.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting instead: **Security → Report a vulnerability** on this repository.

Please include:
- affected version or commit,
- steps to reproduce,
- impact as you understand it.

You can expect an acknowledgement within 7 days. Fixes are released as soon as they are ready, and reporters are credited unless they prefer otherwise.

## Scope

In scope:
- the PWA,
- the `/auth` functions,
- the service worker,
- the Content Security Policy,
- token and cookie handling.

Out of scope:
- vulnerabilities in GitHub itself (report them to GitHub's bug bounty program),
- denial of service against the free hosting tier.

## Design notes

See the threat model in [docs/SPEC.md §7.4](docs/SPEC.md#74-threat-model-summary).
