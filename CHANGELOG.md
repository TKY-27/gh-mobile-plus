# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public preview at [gh-mobile-plus.pages.dev](https://gh-mobile-plus.pages.dev). Desktop Chrome verified GitHub sign-in with expiring tokens, Inbox reads, and a public Actions job log. The installed-device checklist and full OAuth and log-host checks are pending.
- Stateless `/auth` relay on Cloudflare Pages Functions: OAuth App sign-in with PKCE, encrypted per-account cookies with key rotation, single-use refresh, logout with revocation, and a five-account limit.
- In-memory token session with single-flight refresh across tabs, an offline-first per-account cache in IndexedDB, and drafts that survive restarts.
- Native-feeling shell: five tabs with independent stacks, interactive edge-swipe back, collapsing large titles, command palette, account switcher, offline and rate-limit banners, and update prompts that never interrupt a composer.
- Home (profile, contribution graph, releases from starred repositories, activity feed), the Work queue, Inbox with swipe triage, undo and bulk actions, and Search with GitHub URL jumps.
- Repositories, a code browser with highlighting in a Web Worker, file editing with direct, branch and fork commits, issues, pull requests, merge, review mode with line, range and suggestion comments, commit detail, and GitHub Actions runs, logs, re-runs and workflow_dispatch.
- Account, profiles, organizations and Settings: language, theme, app lock, unread badge, offline privacy, accounts, about, licenses and help.
- English and Japanese, onboarding with install guidance, and a development-only diagnostics screen for spikes S1 and S2.

### Changed

- PR state icons and colors are consistent in details, repository lists, Work and search.
- Public profile READMEs load separately. Repository README requests and direct PR tab requests run in parallel.

### Fixed

- A missing profile README repository no longer blocks the profile.
- GitHub's HTML media type renders correctly in READMEs and Markdown file views.

### Security

- A strict Content Security Policy, a single DOMPurify-based HTML sanitizer, `Origin` and custom-header checks on `/auth`, and an end-to-end test that inspects every browser store for leaked tokens, codes and verifiers.
