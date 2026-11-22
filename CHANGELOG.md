# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Profile editing, social account management, profile sharing and browsable follower lists. Profile-write consent is requested on demand.
- Personal repository creation, configurable forks and general repository settings for administrators.
- Create a new text file from a branch directory, or compare two branches and open a pull request, including drafts.
- Public preview at [gh-mobile-plus.pages.dev](https://gh-mobile-plus.pages.dev). Desktop Chrome verified GitHub sign-in with expiring tokens, Inbox reads, and a public Actions job log. The installed-device checklist and full OAuth and log-host checks are pending.
- Stateless `/auth` relay on Cloudflare Pages Functions: OAuth App sign-in with PKCE, encrypted per-account cookies with key rotation, single-use refresh, logout with revocation, and a five-account limit.
- In-memory token session with single-flight refresh across tabs, an offline-first per-account cache in IndexedDB, and drafts that survive restarts.
- Native-feeling shell: five tabs with independent stacks, interactive edge-swipe back, collapsing large titles, command palette, account switcher, offline and rate-limit banners, and update prompts that never interrupt a composer.
- Home (profile, contribution graph, releases from starred repositories, activity feed), the Work queue, Inbox with swipe triage, undo and bulk actions, and Search with GitHub URL jumps.
- Repositories, a code browser with highlighting in a Web Worker, file editing with direct, branch and fork commits, issues, pull requests, merge, review mode with line, range and suggestion comments, commit detail, and GitHub Actions runs, logs, re-runs and workflow_dispatch.
- Account, profiles, organizations and Settings: language, theme, app lock, unread badge, offline privacy, accounts, about, licenses and help.
- English and Japanese, onboarding with install guidance, and a development-only diagnostics screen for spikes S1 and S2.

### Changed

- Home opens to You: contributions first, four actionable Work-count cards and two recent repository cards. Following remains separate with a personal notifications link. Work shortcuts select the matching queue.
- The leading control on every tab opens a left drawer. Account keeps settings, switching and profile actions at the top.
- Home shows contributions, recently pushed repositories and following activity. Notifications and settings open from its header. The Repositories tab opens the signed-in account’s list.
- Repository and profile lists have a bounded reading width. Search suggests qualifiers for each result type. Notification rows expose a one-tap read action.

- Successful GitHub Actions runs on `main` deploy the checked build to the existing Cloudflare Pages project.
- PR state icons and colors are consistent in details, repository lists, Work and search.
- Public profile READMEs load separately. Repository README requests and direct PR tab requests run in parallel.

### Fixed

- Repeated or cancelled gestures preserve tab stacks, notification actions and review-file navigation. Vertical scrolls and multi-touch cancellation no longer trigger Home refresh.
- Retrying an interrupted file proposal checks for its existing commit and pull request. A delayed save preserves edits made after dismissing the sheet.
- Virtualized rows stay visible during deep scrolling and when returning to a list.
- Notification swipes and edge navigation no longer compete. Unread counts refresh after a thread action.
- Edits made while submitting an issue are saved when switching to its detail screen, including when the detail is still loading.

- A missing profile README repository no longer blocks the profile.
- GitHub's HTML media type renders correctly in READMEs and Markdown file views.

### Security

- A strict Content Security Policy, a single DOMPurify-based HTML sanitizer, `Origin` and custom-header checks on `/auth`, and an end-to-end test that inspects every browser store for leaked tokens, codes and verifiers.
