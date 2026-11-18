# GH Mobile+ — Specification (v1)

Single source of truth for GH Mobile+. When code, docs or agent instructions disagree with this file, this file wins. Changes to decisions require an update here, an entry in the Changelog at the bottom, and an ADR in `docs/adr/`.

This document describes the finished v1. It contains no phases.

---

## 1. Product

### 1.1 What it is

GH Mobile+ is an **unofficial, free, open-source (MIT) GitHub client delivered as a Progressive Web App**. It targets individual developers who want to do real GitHub work on a phone: triage notifications, review and merge pull requests, manage issues, read and lightly edit code, and operate GitHub Actions.

It is not affiliated with or endorsed by GitHub, Inc. The UI says "Unofficial GitHub client" on the sign-in screen and in About. It never uses the GitHub logo, the Octocat, or GitHub's trade dress.

### 1.2 Goals

1. Feel indistinguishable from a well-made native app on iPhone, with equal quality on Android.
2. Make mobile code review genuinely good, not just possible.
3. Make the notification inbox fast to triage with one thumb.
4. Run at a hosting cost of zero. The default deployment is Cloudflare Pages free tier on a `*.pages.dev` domain.
5. Hold no user data on any server. No database, no server-side token storage, no analytics, no third-party trackers.

### 1.3 Target users

Individual developers with personal accounts who also belong to ordinary organizations. GitHub Enterprise Server, organization administration and enterprise SSO administration are not targets.

### 1.4 Out of scope for v1

Each of these has an "Open on GitHub" escape hatch where the user would reasonably look for it.

- Web Push and any background notification delivery
- Copilot, Copilot coding agent sessions, and AI features of any kind
- Discussions, Gists, Projects (v2) editing, Wikis, Packages, Codespaces, Security/Dependabot alerts UI
- Multi-file edits, creating files, renaming or deleting files
- An offline write queue. Offline is read-only; drafts are kept locally.
- GitHub Enterprise Server and GHE.com
- Organization and repository settings administration
- Platform-adaptive UI. One custom design runs on all platforms.
- Native wrappers (Capacitor, TWA). The product is a PWA.

---

## 2. Platforms and constraints

| Item | Requirement |
|---|---|
| iOS / iPadOS | 18.4 or later, Safari, installed to the Home Screen (standalone). Browser-tab use is supported but degraded. |
| Android | Current and previous major version of Chrome. Installed as a WebAPK or used in a tab. |
| Desktop | Works in current Chromium, Safari and Firefox at narrow widths. Not a design target. |
| Orientation | Portrait first. Landscape must not break; no tablet split view in v1. |
| Display mode | `standalone`, theme and background colors from design tokens, maskable icons. |

Platform facts the design depends on (verified November 2026):

- `https://github.com/login/oauth/access_token` does not support CORS and requires `client_secret`, even with PKCE. A server-side relay is mandatory.
- `api.github.com` (REST and GraphQL) supports CORS for bearer-token requests.
- Notifications REST endpoints do not work with GitHub App user tokens or fine-grained PATs. OAuth App tokens are therefore required. See spike S1.
- Single-use refresh tokens: refreshing invalidates the previous refresh token and access token.
- iOS has no programmatic install prompt; installation is manual through the Share sheet.
- On iOS, the Home Screen app has its own cookie and storage jar, separate from Safari.
- On iOS, the App Badging API shows a badge only after notification permission is granted.
- The Events API is not real-time (30 s to 6 h latency), keeps at most 300 events and 30 days, and excludes starred repositories.
- The Notifications API has no "save" endpoint.

---

## 3. Architecture

### 3.1 Overview

```
 ┌──────────────────────────── Browser (PWA) ────────────────────────────┐
 │  app/ shell (tabs, stacks, gestures)                                  │
 │  features/* screens  ──uses──▶  data/ typed hooks & mutations         │
 │                                   │                                    │
 │                                   ├── GitHubClient ──▶ api.github.com  │
 │                                   │        (REST + GraphQL, direct)    │
 │                                   └── auth session ──▶ /auth/* (same   │
 │                                                        origin Worker)  │
 │  Service Worker: app shell precache only (never /auth/*, never API)   │
 │  IndexedDB: per-account query cache, drafts, local preferences        │
 └────────────────────────────────────────────────────────────────────────┘
                                          │
                     Cloudflare Pages Functions (/auth/*), stateless
                                          │
                              github.com/login/oauth/*
```

### 3.2 Repository layout and ownership

The typed API exported from `src/data/` is the contract between UI work and data work. UI code never writes GraphQL or calls `fetch` against GitHub directly.

| Path | Contents | Owner role |
|---|---|---|
| `functions/auth/` | Cloudflare Pages Functions for OAuth | Data/auth agent |
| `src/data/` | GitHub client, GraphQL documents, query and mutation hooks, accounts, session, cache persistence, rate-limit handling, error types | Data/auth agent |
| `src/ui/` | Design tokens, primitives built on React Aria, motion presets | UI agent |
| `src/app/` | Router, tab shell, navigation stacks, gestures, onboarding, app lock | UI agent |
| `src/features/<area>/` | Screens per area | UI agent |
| `src/markdown/` | The single sanitized HTML renderer | Security owner |
| `src/i18n/` | `en` and `ja` message catalogs | UI agent |
| `e2e/` | Playwright tests and GitHub API fixtures | Whoever owns the feature |
| `schema/github.graphql` | Pinned GitHub GraphQL schema snapshot for typing | Data/auth agent |

Feature areas: `home`, `work`, `inbox`, `search`, `account`, `repo`, `code`, `issue`, `pull`, `review`, `actions`, `settings`, `onboarding`.

### 3.3 Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| UI | React 19 |
| Build | Vite, SPA, no SSR |
| Routing | TanStack Router (typed routes, search params) |
| Server state | TanStack Query, persisted per account to IndexedDB |
| Accessible primitives | React Aria (headless), all styling custom |
| Styling | CSS Modules plus CSS custom properties for tokens |
| Animation | Motion |
| Virtualized lists | TanStack Virtual |
| GraphQL typing | gql.tada against `schema/github.graphql` |
| Code viewing | Shiki with the JavaScript regex engine, in a Web Worker, languages lazy-loaded |
| Code editing | CodeMirror 6 |
| HTML sanitizing | DOMPurify |
| PWA | vite-plugin-pwa (Workbox), `injectManifest` strategy |
| Server | Cloudflare Pages Functions |
| Package manager | pnpm |
| Tests | Vitest, `@cloudflare/vitest-plugin` (formerly `@cloudflare/vitest-pool-workers`), Playwright (WebKit iPhone and Chromium Pixel profiles), MSW for API fixtures |
| Lint and format | ESLint (flat config, typescript-eslint `strictTypeChecked`), Prettier |

Every dependency must be verified against its official documentation before use. Adding a dependency not listed here requires an ADR.

---

## 4. Authentication and session

### 4.1 Model

- **OAuth App**, authorization-code flow with **PKCE (S256)**.
- Scopes: `repo notifications workflow read:org read:user user:email user:follow`. `user:follow` is needed for the follow toggle (6.15).
- Optional "Public repositories only" sign-in that requests `public_repo` instead of `repo`. The choice is per account and shown in Account settings.
- **Token mode** is a deployment setting, `GHM_TOKEN_MODE`:
  - `expiring` (default): the OAuth App has expiring user tokens enabled. Access tokens last 8 hours, and refresh tokens are single-use.
  - `persistent`: non-expiring OAuth token. This exists only as the fallback if spike S1 shows Notifications rejects expiring tokens.
- No GitHub App. See ADR 0001.

### 4.2 Server endpoints (`functions/auth/`)

All endpoints are same-origin with the app. They set no CORS headers and return `Cache-Control: no-store`. They never log tokens, codes, verifiers or cookie contents. Every non-GET endpoint requires an `Origin` header equal to the deployment origin and the header `X-GHM-Request: 1`; otherwise it returns 403.

| Endpoint | Behavior |
|---|---|
| `GET /auth/login?mode=add\|reauth&account=<id>&public=0\|1&return=<path>` | Generates `state` (32 random bytes) and a PKCE verifier. Stores both, plus mode and the return path (accepted only if it has no control characters or backslashes and resolves to the request origin; default `/`), in an encrypted cookie `__Host-ghm_oauth` (`SameSite=Lax`, `HttpOnly`, `Secure`, `Max-Age=600`, `Path=/`). Redirects to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256` and, for `mode=add`, `prompt=select_account`. |
| `GET /auth/callback` | Verifies `state` in constant time against the cookie, then deletes the cookie. Exchanges `code` plus `code_verifier` plus `client_secret` for tokens. Calls `GET /user` to obtain the numeric user id, login and avatar. Writes the account cookie (4.3), refusing a sixth account. Redirects to the stored return path with no token or code in the URL. On any failure, redirects to `/signin?error=<code>`, where `code` is one of `state_mismatch`, `access_denied`, `exchange_failed`, `org_restricted` or `account_limit`. |
| `POST /auth/token` body `{ "accountId": number }` | Decrypts that account's cookie. In `expiring` mode it refreshes with GitHub, rotates the cookie, and returns `{ accessToken, expiresAt }`, where `expiresAt` is epoch milliseconds. In `persistent` mode it returns the stored token with `expiresAt: null`. On `bad_refresh_token` it deletes the cookie and returns 401 `{ error: "reauth_required" }`. |
| `GET /auth/accounts` | Returns `[{ id, login, avatarUrl, publicOnly }]` decoded from account cookies. Returns no tokens. Sends the non-secret OAuth client id in the `X-GHM-Client-Id` header for the link in 4.5. |
| `POST /auth/logout` body `{ "accountId": number }` | Revokes the token at GitHub (`DELETE /applications/{client_id}/token` with basic auth), then deletes the cookie. A revoke failure is logged without secrets and is not surfaced as a logout failure. |

### 4.3 Cookies

- One cookie per account: `__Host-ghm_acct_<userId>`, with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`.
- The payload is a JSON object `{ v, login, avatarUrl, publicOnly, refreshToken | accessToken, refreshExpiresAt }`, encrypted with AES-256-GCM.
- Envelope: `<kid>.<base64url iv>.<base64url ciphertext>`. Keys come from the secret `GHM_COOKIE_KEYS` (a JSON map `kid → base64 key`); new cookies use `GHM_COOKIE_ACTIVE_KID`. Decryption accepts any listed kid, so keys can be rotated.
- At most 5 accounts. Adding a sixth is refused with an explanation.
- Local development on `http://localhost` cannot use `__Host-` or `Secure`. When `GHM_DEV_INSECURE_COOKIES=1` **and** the request host is `localhost` or `127.0.0.1`, the Worker uses unprefixed names without `Secure`. In every other case the flag is ignored.

### 4.4 Client session (`src/data/session`)

- Access tokens live only in memory, keyed by account id. They are never written to storage, never put in URLs, and never logged.
- **Single-flight refresh:** every call to `/auth/token` for an account runs inside the Web Lock `ghm-token-<accountId>`. The tab that holds the lock broadcasts the new token on the `BroadcastChannel` named `ghm-session`. Other tabs adopt it instead of refreshing.
- Proactive refresh happens when 80 % of the token lifetime has elapsed, and on `visibilitychange` to visible when less than 15 minutes remain.
- A `401` from GitHub triggers exactly one refresh and one retry. A second failure marks the account `signedOut`.
- `reauth_required` marks the account `signedOut`. The UI then shows "Session expired — sign in again", with a one-tap reauth that uses `mode=reauth`.
- **Known limitation, documented in the UI help:** if the app is suspended after GitHub rotates the refresh token but before the response with the new cookie arrives, the session is lost and the user must sign in again.

### 4.5 Organization restrictions

A `403` whose body or headers indicate OAuth App access restrictions or SAML SSO (`X-GitHub-SSO` header, or messages naming "OAuth App access restrictions" or "SAML") maps to the error `OrgAccessRestricted { org, ssoUrl? }`. The UI explains it in plain language and offers:

- the SSO authorization link when GitHub provides one, otherwise
- `https://github.com/settings/connections/applications/<client_id>`, where the user can request organization approval.

### 4.6 Onboarding

1. **Welcome:** what the app is and that it is unofficial.
2. **Install guide:** shown only when not running standalone. iOS gets an illustrated Share → Add to Home Screen walkthrough; Android gets the `beforeinstallprompt` button when it is available. A "Continue in browser" option is always present.
3. **Sign in with GitHub**, with the "Public repositories only" toggle. On iOS standalone, a note explains that the app has its own sign-in separate from Safari, so the user may need to sign in to github.com again.
4. **Optional app lock** (4.7) and **optional unread badge** (6.4).

### 4.7 App lock

- Opt-in. Uses a WebAuthn platform credential (`userVerification: "required"`) created for this origin.
- When enabled, the app shows an opaque lock screen on cold start and on resume after the configured idle time (1, 5 or 15 minutes; default 5).
- It is a **privacy screen, not a security boundary**: cookies and the cache are not encrypted by it. Settings and help say exactly this.
- After 5 failed attempts, it offers "Sign out all accounts".

### 4.8 Acceptance criteria

- Signing in, adding a second account, switching accounts and signing out each work in iOS standalone, Android WebAPK and a desktop tab.
- No access token, refresh token, code or verifier appears in `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, URLs, logs or service-worker caches. This is verified by an automated test that inspects storage after a full sign-in.
- Two tabs that refresh at the same moment end with one valid session (automated test).
- `/auth/*` rejects requests without a matching `Origin` or without `X-GHM-Request` (automated test).
- A state mismatch, a denied consent and an expired code each land on `/signin` with a specific, localized message.

---

## 5. Data layer (`src/data/`)

### 5.1 GitHubClient

- Base URL `https://api.github.com`. Headers on every request:
  - `Authorization: Bearer <token>`
  - `X-GitHub-Api-Version: 2026-03-10`
  - `Accept: application/vnd.github+json`
- GraphQL goes through `POST /graphql`. Documents are typed with gql.tada.
- REST GETs that GitHub serves with an ETag are cached by URL and account, and revalidated with `If-None-Match`. A `304` answer reuses the cached body.
- Rate-limit state comes from the `x-ratelimit-*` headers and the GraphQL `rateLimit` field. Below 10 % remaining, background polling stops and a quiet banner appears.
- Secondary rate limits: honor `retry-after`, or `x-ratelimit-reset` when present; otherwise back off exponentially from 60 seconds. Never retry write requests automatically, except the throttled bulk notification queue (6.3.3).
- Errors are a closed union:

```ts
type GitHubError =
  | { kind: "authExpired" }
  | { kind: "orgAccessRestricted"; org: string; ssoUrl?: string }
  | { kind: "rateLimited"; resetAt: Date; secondary: boolean }
  | { kind: "notFound" }
  | { kind: "forbidden"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "validation"; message: string; fields: string[] }
  | { kind: "network" }
  | { kind: "server"; status: number };
```

### 5.2 Query hooks

- Every screen loads with **one primary GraphQL query where the API allows**, plus REST only for things GraphQL lacks: notifications, events, PR file patches, Actions logs, and the code-search REST endpoint.
- Query keys always start with the account id.
- `staleTime` defaults: lists 30 s, details 60 s, the contribution calendar 1 h, repository README 10 min.
- Mutations are optimistic where the result is predictable (mark done, star, label toggle, close/reopen). They roll back on error and show a toast.

### 5.3 Persistence

- TanStack Query persistence goes to IndexedDB in a database named `ghm-cache-<accountId>`, with a maximum age of 7 days.
- Drafts (comments, review comments, issue bodies, file edits) go to `ghm-drafts-<accountId>` and are saved on change with 500 ms debounce. Pending review comments are saved immediately, in one transaction per change, so no comment is lost between tabs.
- Sign-out, a `reauth_required` response, or a removed account deletes both databases for that account.
- Setting "Keep private repository content offline" (default on): when off, queries whose results come from private repositories are excluded from persistence. Because many queries mix repositories, persistence is default-deny when the setting is off: only basic profile queries are kept (ADR 0013).
- Device-local, non-secret keys in `localStorage`: `ghm-preferences`, `ghm-onboarding`, `ghm-active-account` (an account id), `ghm-pending-logout` (ids of accounts signed out on this device whose server logout is still pending), `ghm-accounts` (the `{ id, login, avatarUrl, publicOnly }` list, so an offline cold start can render), and `ghm-recent-searches-<accountId>`. Nothing else is stored outside the two IndexedDB databases.
- Signed GitHub asset URLs (`private-user-images.githubusercontent.com`) expire. Offline views show a placeholder with "Image unavailable offline" instead of a broken image.

---

## 6. Navigation shell and screens

### 6.1 Shell

- **Primary navigation** has five destinations in order: **Home, Repositories, Work, Search, Account**. On phones a solid bottom bar shows icons with labels above the safe area. From 56 rem wide, the same destinations appear in a side rail beside a bounded reading column.
- **Independent navigation stack per tab.** Switching tabs preserves each stack and its scroll positions.
- Re-tapping the active tab scrolls to top if the screen is scrolled; otherwise it pops to the tab root.
- **Edge-swipe back:** a swipe starting within 20 px of the leading edge pops the stack with an interactive, cancellable transition, at 60 fps on a mid-range device.
- Tab roots use a single compact, left-aligned title bar. Long detail titles collapse into the navigation bar on scroll.
- The tab bar hides while the software keyboard is open (using the `visualViewport` API).
- Long-pressing the **Account** tab opens the account switcher sheet. The notification bell on Home shows unread status and announces the count. The adjacent settings button opens Settings.
- Deep links: in-app routes mirror GitHub paths (`/:owner/:repo/pull/:n`, etc.), so a pasted github.com URL can be opened by replacing the host. Search accepts pasted github.com URLs.
- A global **command palette** opens from a button in the Search tab and from the `/` key on hardware keyboards. It jumps to `owner/repo`, `owner/repo#123`, `@user`, and the settings screens.
- "Open on GitHub" is available from every detail screen's overflow menu.

### 6.2 Home

From top to bottom:

1. **Account header:** avatar, display name and login link to the profile.
2. **Contributions:** a green activity calendar for the last 52 weeks, with a yearly total, month markers and a scale. Narrow viewports start at the current week and can scroll back.
3. **Recent repositories:** up to six repositories owned by the active user, ordered by last push. The viewer query includes these summaries. See all opens the Repositories tab at `/repositories`.
4. **Activity:** the default Following view groups consecutive received events by actor and repository. Filters cover releases, stars, pushes, issues and PRs, and follows. A separate option shows recent releases from the 100 most recently starred repositories, limited to 10 releases per repository and a 14-day window. The feed uses infinite scroll to the 300-event limit and notes GitHub's delivery delay.

Pull-to-refresh and the refresh button update the calendar, repository summaries, activity and releases.

### 6.3 Notifications

#### 6.3.1 List

- Filters: **Unread** (default), **Participating**, **All**. Grouping by repository can be toggled.
- Each row shows the repository, subject type icon, title, reason (mention, review requested, …), updated time, and an unread dot.
- **Swipe right → Done** (`DELETE /notifications/threads/{id}`). **Swipe left → Mark read.** Each unread row also has a direct Mark as read button. The long-press menu offers Unsubscribe, Mark read and Open on GitHub.
- Multi-select mode supports bulk Done and bulk Mark read.

#### 6.3.2 Polling

While the app is visible, it polls `/notifications` with `If-Modified-Since`, honoring `X-Poll-Interval` (minimum 60 s). Polling stops when the app is hidden.

#### 6.3.3 Bulk actions

Bulk actions go through a throttled queue (at most 4 concurrent requests, 250 ms spacing). It shows progress, stops on a secondary rate limit, and reports partial success.

#### 6.3.4 Opening

Opening an unread notification online marks it as read. Issue, pull request and commit notifications open in the app. Releases open the repository’s releases list. Actions notifications open the run if its URL is available, or the repository’s run list when GitHub supplies only a check suite ID. For unsupported subjects such as discussions, the app first shows the notification with an explicit Open on GitHub action.

#### 6.3.5 Acceptance criteria

- Done and Mark read are reflected instantly and roll back on failure.
- 200 notifications scroll at 60 fps.
- Rows are not limited to swipes: every action is also reachable by VoiceOver/TalkBack custom actions.

### 6.4 Badge

- Opt-in setting: "Show unread count on the app icon". Turning it on requests notification permission (required on iOS), then calls `navigator.setAppBadge(count)` after each poll.
- If permission is denied, the setting explains why it cannot work.

### 6.5 Work

Segmented control: **Review requested**, **My PRs**, **Assigned**, **CI failing**. Each segment is one GraphQL search query:

| Segment | Query |
|---|---|
| Review requested | `is:open is:pr review-requested:@me archived:false` |
| My PRs | `is:open is:pr author:@me archived:false` |
| Assigned | `is:open assignee:@me archived:false` |
| CI failing | `is:open is:pr author:@me status:failure archived:false` |

- Rows show the repository, number, title, checks rollup (success, failure, pending), review decision, draft state, and updated time.
- Each segment header shows its count, so the screen reads as a queue that reaches zero.
- Acceptance criterion: each segment loads with a single GraphQL request.

### 6.6 Search

- Scopes: **Repositories, Issues & PRs, Users, Code**. Each scope offers runnable qualifier examples. Matching qualifiers can be inserted into the search field.
- Recent searches are stored locally per account.
- Code search uses the REST code search endpoint. The UI notes that it uses GitHub's API search syntax and a lower rate limit, which may differ from github.com.
- Pasting a github.com URL or typing `owner/repo#n` offers a direct jump.

### 6.7 Account

- The full profile, with profile README rendering (`<login>/<login>` README when present).
- Profile details and navigation are usable while a public profile README loads independently. A missing namesake repository leaves the profile visible.
- My repositories, Starred, and Organizations. The Repositories tab searches owned repositories by name, including forks. Offline, it can reuse a saved search or filter the downloaded list and indicate when only part of it is available.
- **Settings:** language (System / English / 日本語), theme (System / Light / Dark), app lock, unread badge, offline private content, accounts (add, switch, sign out, public-only indicator), about and licenses, and help (including the known limitations from this spec).

### 6.8 Repository

- **Header:** owner/name, description, stars, forks, watchers, language, and license. Star and Watch toggles; fork opens on GitHub.
- **Sections:** README (default), Code, Issues, Pull requests, Actions, Releases.
- A branch and tag switcher is available on the Code and README sections.

### 6.9 Code browser and viewer

- The file tree is navigated through the stack, with a breadcrumb in the navigation bar.
- **Viewer:**
  - Syntax highlighting with Shiki in a Web Worker, plus line numbers.
  - Optional soft wrap (default on), long-press line selection, and "Copy permalink".
  - Markdown files render through `SafeHtml` and have a Raw/Rendered toggle.
- **Limits:**
  - Files larger than 1 MB, or with more than 20,000 lines, show a size notice with "Open raw on GitHub".
  - Images render.
  - Other binary files show metadata only.

### 6.10 File editing

- An **Edit** action appears on text files up to 1 MB.
- The editor is CodeMirror 6 with the same language highlighting, autosaved drafts, and an on-screen accessory bar with Tab, indent and outdent, undo, redo, and find.
- **Commit sheet** (the default is a new branch named `ghm/<login>/<short-date>-<file-stem>`):
  - **With push access:** commit directly to the current branch, or create a new branch and open a pull request.
  - **Without push access:** fork the repository if no fork exists (`POST /repos/{owner}/{repo}/forks`), wait until it is ready, create a branch on the fork, commit, and open a pull request to the upstream repository. This mirrors github.com's behavior.
- Commits use GraphQL `createCommitOnBranch` with `expectedHeadOid`. New branches use `createRef`.
- **Conflict handling:** if the head moved, the sheet shows "This file changed since you opened it", with **View latest** (draft kept, side-by-side diff of the user's version against the latest) or **Commit to a new branch instead**.
- Branch protection rejections map to a clear message, with "Commit to a new branch instead" offered.
- Acceptance criterion: all three paths (direct, new branch + PR, fork + PR) work and end on the resulting commit or PR screen.

### 6.11 Issue detail

- One GraphQL query loads the header, body and the timeline, paginated by 50.
- Timeline items render comments, labels, assignment, cross-references, commits, close/reopen and rename.
- **Composer:**
  - Markdown with Write/Preview tabs (preview through `POST /markdown`, rendered by `SafeHtml`).
  - `@mention` autocomplete from assignable users and participants, and `#reference` autocomplete from the repository's recent issues and PRs.
  - Saved replies are not supported. Image upload is not supported in v1; the composer shows a hint.
- Edit labels, assignees and milestone in sheets. Close as completed or not planned, reopen, lock (when permitted), and subscribe or unsubscribe.
- Reactions: add or remove on the body and on comments.
- **New issue:** a template picker from `.github/ISSUE_TEMPLATE`. Markdown templates prefill the body; issue forms (YAML) render as native fields for `input`, `textarea`, `dropdown` and `checkboxes`, and fall back to "Open on GitHub" for anything else.

### 6.12 Pull request detail

- **Tabs:** Conversation, Files, Checks, Commits.
- The detail header, repository lists, Work and search use the same PR state icons and colors. Open is green, draft is gray, merged is purple and closed is red.
- **Conversation:** as in 6.11, plus review summaries and requested reviewers. Requesting reviewers is supported.
- **Checks:** the check runs and statuses rollup, grouped by suite. Tapping a check run that belongs to Actions opens the job screen (6.14). Other checks open their details URL externally.
- **Merge sheet:**
  - A split button for the default method, with Squash / Merge commit / Rebase limited to those the repository allows.
  - Editable commit title and message, and an optional "Delete branch" toggle.
  - Mergeability and blocked reasons are shown before the button is enabled.
- Ready for review and convert to draft. Update branch when behind.

### 6.13 Review mode

This is the flagship experience.

#### 6.13.1 Data source

- **File list and patches:** `GET /repos/{o}/{r}/pulls/{n}/files`, paginated. A file whose `patch` is absent (too large) shows "Diff too large — Open on GitHub". PRs with more than 300 changed files show a banner, and only the first 300 are listed.
- **Viewed state:** GraphQL `PullRequest.files.viewerViewedState`, updated with the `markFileAsViewed` and `unmarkFileAsViewed` mutations.
- **Existing review threads:** GraphQL `reviewThreads`, with resolve and unresolve support.
- **Review submission:** GraphQL `addPullRequestReview` (pending), then `addPullRequestReviewThread` for each comment, then `submitPullRequestReview`. Comments use `path`, `line`, `side` and, for ranges, `startLine` and `startSide`. Diff positions are never used.

#### 6.13.2 UI

- The file list shows a viewed checkbox, additions and deletions, and a progress indicator ("12 / 31 viewed").
- The diff viewer:
  - Unified view, virtualized, with Shiki highlighting.
  - Soft wrap (on by default) and a toggle for hiding whitespace changes.
  - **Next and previous hunk** buttons in a thumb-reach bottom bar, and **swipe left or right to move between files**.
- **Commenting:**
  - Long-press a line to comment. Drag the handles to extend to a range.
  - "Suggest change" pre-fills a ```suggestion block with the selected lines, editable in CodeMirror.
- Pending comments are kept in drafts until the review is submitted, and survive app restarts.
- The **submit sheet** offers Comment, Approve and Request changes, with a summary body and a count of pending comments.
- **Applying suggestions** from others is supported via "Commit suggestion", which reuses the file-edit commit path with `expectedHeadOid`.

#### 6.13.3 Acceptance criteria

- A 5,000-line diff scrolls at 60 fps.
- Single-line, multi-line and suggestion comments land on the correct lines on github.com (verified against fixtures with known line mappings).
- Viewed state round-trips with github.com.

### 6.14 Actions

- **Workflow runs list:** filter by workflow, branch, event and status, with status icons, duration and actor.
- **Run detail:** jobs and their steps with status and timing. Actions: re-run all jobs, re-run failed jobs, and cancel.
- **Logs:**
  - **Completed jobs:** download through `GET /repos/{o}/{r}/actions/jobs/{job_id}/logs`. Logs render in a virtualized monospace view with step folding (parsing `##[group]` and `##[endgroup]`), search, and ANSI color support. Logs over 5 MB show only the last 5 MB, with a notice.
  - **Running jobs:** step status only, refreshed every 10 seconds, plus "Open on GitHub" for live logs.
  - If spike S2 finds that the log redirect target is not CORS-readable, log viewing becomes "Open on GitHub". It is **never** proxied through the Worker.
- **workflow_dispatch:** the inputs form is generated from the workflow file's `on.workflow_dispatch.inputs`, read with the Contents API and parsed as YAML. It supports the `string`, `boolean`, `choice`, `number` and `environment` types, and a ref picker.

### 6.15 Other screens

- Other users' profiles: README, pinned repositories, repositories, and a follow toggle. Profile lists use `/:owner?tab=repositories|stars|members`.
- Organization pages: repositories and members.
- Releases list and detail, with notes rendered through `SafeHtml` and asset links.
- Commit detail (message, files, diff), reusing the diff viewer read-only.

---

## 7. Rendering and security

### 7.1 Markdown and HTML

- The only component that injects HTML is `src/markdown/SafeHtml.tsx`. ESLint forbids `dangerouslySetInnerHTML` everywhere else.
- Input is always GitHub-rendered HTML (GraphQL `bodyHTML`, or REST with `Accept: application/vnd.github.html+json`, or `POST /markdown`). Raw markdown is never rendered client-side.
- Sanitization: a DOMPurify allowlist suited to GitHub's output. Script, style and iframe elements are forbidden, as are event-handler attributes, and `javascript:` and `data:` URLs except `data:image/*` in `img`.
- Links:
  - External links open with `rel="noopener noreferrer"` and `target="_blank"`.
  - github.com links that map to in-app routes are intercepted and navigated in-app.
- Task-list checkboxes render read-only.

### 7.2 Content Security Policy

The header is served for all app routes through `public/_headers`:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://avatars.githubusercontent.com https://camo.githubusercontent.com https://raw.githubusercontent.com https://user-images.githubusercontent.com https://private-user-images.githubusercontent.com https://github.com https://objects.githubusercontent.com https://repository-images.githubusercontent.com https://opengraph.githubassets.com;
media-src 'self' https://github.com https://user-images.githubusercontent.com https://private-user-images.githubusercontent.com https://objects.githubusercontent.com;
connect-src 'self' https://api.github.com https://*.actions.githubusercontent.com https://*.blob.core.windows.net;
worker-src 'self' blob:;
font-src 'self';
frame-src 'none';
frame-ancestors 'none';
base-uri 'none';
form-action 'self' https://github.com;
object-src 'none';
upgrade-insecure-requests
```

- `style-src 'unsafe-inline'` is needed by CodeMirror and Motion's inline styles. Scripts are never inline.
- The `connect-src` hosts for logs are finalized by spike S2, and must be reduced to the exact hosts observed.
- Other headers: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Cross-Origin-Opener-Policy: same-origin`.

### 7.3 Service worker

- Precaches the built app shell and static assets only.
- **Never** caches or intercepts `/auth/*` or any `api.github.com` request.
- New versions are shown as an "Update available — Reload" toast; activation is never forced while the user is composing.

### 7.4 Threat model summary

| Threat | Mitigation |
|---|---|
| XSS steals the access token or calls `/auth/token` | Strict CSP, a single sanitizer, no inline scripts; `/auth/*` requires same-origin and a custom header. Residual risk accepted and documented. |
| Token leakage through storage | Tokens are in memory only, refresh tokens in encrypted `HttpOnly` cookies, and this is verified by an automated test. |
| CSRF on `/auth/*` | `SameSite=Strict` account cookies, an `Origin` check, and a custom header. |
| OAuth code interception | PKCE S256, `state` in an encrypted short-lived cookie, and a fixed `redirect_uri`. |
| Device theft with the app unlocked | Optional app lock (privacy screen), sign-out wipes per-account data, GitHub-side revocation. |
| Server compromise | The server stores nothing; cookie keys are rotatable; tokens are never logged. |

---

## 8. Design system

- **Character:** near-monochrome surfaces with **one accent color** (token `--accent`, default `#3D7BFF` in light mode and `#5B8FFF` in dark mode). Information-dense, typographically led, and quiet. Where used, translucent bars use `backdrop-filter: blur(20px) saturate(180%)`, with a solid fallback when `prefers-reduced-transparency` is set or `backdrop-filter` is unsupported.
- **Same design on every platform.** No Material or Cupertino imitation. Platform differences are limited to safe areas and install guidance.
- **Typography:** the system font stack (`-apple-system, "SF Pro Text", Roboto, "Noto Sans JP", system-ui, sans-serif`) and a monospace stack (`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace`). Dynamic Type is respected by sizing type with `rem` and honoring the user's font-size setting.
- **Color:** light and dark themes from tokens, following the system by default. `--accent` is used for indicators and focus (at least 3:1). Accent-colored text and filled buttons use `--accent-text` and `--accent-fill`, which reach 4.5:1 (ADR 0010). Status colors (success, failure, pending, merged, closed, draft) have a contrast ratio of at least 4.5:1 against their background, and are always paired with an icon or shape.
- **Spacing:** a 4 px grid. Touch targets are at least 44×44 px. The one exception is the diff line-number gutter, whose buttons are at least 24 px tall so dense rows stay readable; long-pressing the full-width line and the "Select range" sheet are the larger alternatives.
- **Motion:** standard durations of 120 / 200 / 320 ms. Stack transitions are interruptible and physics-based. All non-essential motion is disabled under `prefers-reduced-motion`.
- **Feedback:** every async action shows pending state within 100 ms. Every optimistic action can be undone from a toast where an undo exists (Done, Mark read, label toggle). GitHub has no API to undo Done or Mark read, so those requests are sent only after the 5-second undo window closes (ADR 0009).
- **Empty states:** every list has an empty state that says why it is empty and what to do next. Notifications and Work name the empty filter in plain language.
- **Icons:** one open-source icon set (Lucide), tree-shaken.

---

## 9. Internationalization

- `en` and `ja`, with every user-facing string in catalogs. Language comes from the system by default and can be overridden in Settings.
- Relative times and numbers use `Intl.RelativeTimeFormat` and `Intl.NumberFormat`.
- A CI check fails when a key is missing in either catalog.

---

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Startup | Installed app, warm cache: shell interactive in under 1.0 s on an iPhone 13-class device. Cold start from network: Largest Contentful Paint under 2.5 s on Fast 4G. |
| Bundle | Initial JS no larger than 170 KB gzip. Shiki, CodeMirror, review mode and Actions logs are lazy-loaded chunks. A CI size check enforces this. |
| Scrolling | 60 fps on lists of 500 rows and diffs of 5,000 lines (virtualized). |
| Rate-limit economy | Cold opens of Home, Work and Inbox together cost at most 6 requests. |
| Accessibility | WCAG 2.2 AA. Every gesture has a button or menu alternative; VoiceOver and TalkBack labels and custom actions; focus management on navigation. |
| Privacy | No analytics, telemetry or third-party requests beyond GitHub hosts. |
| Reliability | Any screen can render from cache when offline, with an "Offline — showing saved data" banner. Errors never show a blank screen. |

---

## 11. Error handling policy

- Every `GitHubError` kind has a localized message and a defined UI: an inline error with Retry for loads, a toast with Retry for mutations, a full-screen state only for `authExpired` and for `notFound` of the primary resource.
- `orgAccessRestricted` always shows the explanation and link from 4.5.
- `rateLimited` shows the reset time and pauses polling until then.
- No silent catch. An unexpected error renders a generic error state with "Copy details", which copies non-secret diagnostics only.

---

## 12. Spikes to resolve at the start of the build

Each spike's result is recorded in a new ADR, and this spec is updated.

| Id | Question | How | Fallback |
|---|---|---|---|
| S1 | Do the Notifications endpoints (list, `If-Modified-Since`, mark read, mark done, unsubscribe) accept **expiring** OAuth App user tokens? | The dev-only `/__diagnostics` screen, available only in `pnpm dev` builds, runs each call with the current session and reports status. The operator signs in once locally and shares the result. | `GHM_TOKEN_MODE=persistent` |
| S2 | Is the Actions job-log redirect target readable cross-origin from the PWA origin, and which hosts does it use? | The diagnostics screen fetches the logs of a completed job and reports the final URL host and CORS result. | Logs become "Open on GitHub" |
| S3 | Does the OAuth round trip complete inside iOS standalone and an Android WebAPK, returning to the installed app with the session? | A manual test on real devices, following the checklist in `docs/TESTING.md`. | Document the browser-tab sign-in, then return to the app |

---

## 13. Testing

- **Unit (Vitest):**
  - Data mappers, error mapping, and the token single-flight logic.
  - The cookie envelope and key rotation.
  - The suggestion-block generation and line-range mapping.
  - Log group parsing, and the workflow_dispatch input parsing.
- **Worker (Vitest with `@cloudflare/vitest-plugin`):**
  - Login, callback (success, `state` mismatch, denied, exchange failure), token refresh and rotation, `bad_refresh_token`, and logout with revoke.
  - Origin and header enforcement, and the dev cookie flag being ignored for non-localhost hosts.
- **End-to-end (Playwright, WebKit "iPhone 15" and Chromium "Pixel 8" profiles, GitHub API mocked with recorded fixtures):**
  - Sign-in through a mocked OAuth server.
  - Tab stacks and re-tap behavior, and edge-swipe back.
  - Inbox swipe Done and its rollback.
  - The review flow end to end with a pending review and suggestion.
  - The edit and commit flows (direct, branch + PR, fork + PR, and the conflict path).
  - The merge sheet, and offline mode rendering from cache.
  - The storage-inspection test from 4.8.
- `docs/TESTING.md` contains the manual real-device checklist for iOS standalone and Android WebAPK.
- CI runs typecheck, lint, format check, unit, Worker, end-to-end, the i18n key check, and the bundle-size check.

---

## 14. Configuration

| Name | Where | Purpose |
|---|---|---|
| `GHM_GITHUB_CLIENT_ID` | Pages env var | OAuth App client id |
| `GHM_GITHUB_CLIENT_SECRET` | Pages secret | OAuth App client secret |
| `GHM_COOKIE_KEYS` | Pages secret | JSON map `kid → base64 32-byte key` |
| `GHM_COOKIE_ACTIVE_KID` | Pages env var | Kid used for new cookies |
| `GHM_TOKEN_MODE` | Pages env var | `expiring` (default) or `persistent` |
| `VITE_GHM_SOURCE_URL` | Build environment or GitHub Actions variable | Public source-code URL shown in About. Optional. |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions variable | Cloudflare account that owns the Pages project |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Account-scoped Cloudflare Pages Edit token for deploying |
| `GHM_DEV_INSECURE_COOKIES` | `.dev.vars` only | `1` to allow non-`Secure` cookies on localhost |
| `GHM_GITHUB_OAUTH_ORIGIN` | End-to-end tests only | Overrides `https://github.com` so tests can use a mock OAuth server. Honored only for `localhost` and `127.0.0.1` requests. |
| `GHM_GITHUB_API_ORIGIN` | End-to-end tests only | Overrides `https://api.github.com` for the Worker's own calls. Honored only for `localhost` and `127.0.0.1` requests. |

The local file `.dev.vars` is git-ignored, and `.dev.vars.example` documents the keys. Local development needs its own OAuth App, with callback URL `http://localhost:8788/auth/callback`. Production needs a second OAuth App with callback URL `https://<project>.pages.dev/auth/callback`.

The production URL is `https://gh-mobile-plus.pages.dev`. A push to `main` deploys the checked build to the existing Direct Upload project after all CI jobs pass. OAuth and cookie secrets stay in Cloudflare Pages (ADR 0015).

---

## Changelog

- 2026-11-17: Initial v1 specification.
- 2026-11-17: Auth relay details: `return` path, `account_limit` error, `expiresAt` unit, `X-GHM-Client-Id` header, test-only origin overrides (ADR 0008). Deferred-request undo for notification actions (ADR 0009). Supporting tooling dependencies, and `@cloudflare/vitest-plugin` replacing its deprecated former name (ADR 0007).
- 2026-11-17: Accent text and fill tokens for contrast (ADR 0010). `account_limit` sign-in error in the client. Local non-secret storage keys listed in 5.3. `user:follow` scope for following users. `VITE_GHM_SOURCE_URL` build setting. Profile list routes. Tab roots load on first visit, so cold Home, Work and Inbox stay within 6 requests. Shiki grammars load per language with the CSS-variables theme (ADR 0011). Diff gutter touch-target exception in §8.
- 2026-11-18: Spikes S1–S3 not yet run; defaults and fallbacks in force (ADR 0012). Offline privacy setting excludes all repository content when off (ADR 0013). `ghm-pending-logout` key. Known v1 limits: each Work segment lists its first 50 items (the count is exact); New releases reads up to 10 releases per starred repository; a release notification opens the repository's releases list; pending review comments are saved immediately rather than debounced, so none is lost. A desktop Chromium Playwright project runs the auth spec for the desktop-tab part of 4.8. Inbox Unsubscribe ignores the thread subscription, because deleting it keeps notifications from watched repositories.
- 2026-11-18: Profile READMEs load independently. Repository README representations and direct PR tab data load concurrently (ADR 0014). PR states use consistent icons and colors across screens.
- 2026-11-18: GitHub Actions deploys successful `main` builds to the existing Cloudflare Pages project (ADR 0015).
- 2026-11-18: Repositories becomes a primary destination. Home brings together identity, contributions, recently pushed repositories, activity, notifications and settings. Search offers scoped qualifier examples. Wide screens use a navigation rail (ADR 0016).
