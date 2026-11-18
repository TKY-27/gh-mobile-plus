# GH Mobile+

An unofficial, free and open-source GitHub client for your phone, delivered as a Progressive Web App.

> GH Mobile+ is not affiliated with or endorsed by GitHub, Inc.

## Why

Use GH Mobile+ to review a diff, check notifications or find a repository on your phone. It installs from the browser and keeps session and offline data on your device.

## Features

- **Home:** your contribution calendar, recently pushed repositories, activity from people you follow, and releases from starred repositories.
- **Repositories and search:** open your repositories from the tab bar, or search GitHub by type with qualifiers.
- **Work:** review requests, your open PRs, assigned issues and failing CI, in one place.
- **Notifications:** open the bell on Home to read threads, mark individual notifications as read, or act on a selection.
- **Code review:** mark files viewed, step through hunks, comment on lines and ranges, suggest changes, and submit reviews.
- **Pull requests and issues:** timelines, composer with preview and autocomplete, labels, assignees and merge. PR state icons and colors match across lists, search and detail.
- **Code:** browse with syntax highlighting, edit a file, and commit directly or through a branch, fork and PR.
- **Actions:** runs, jobs, logs, re-run, cancel, and workflow_dispatch with inputs.
- Multiple accounts, an optional app lock, offline reading of loaded content, and English and Japanese.

## Requirements

- iOS or iPadOS 18.4 or later with Safari, or a current Chrome on Android.
- Installing to the Home Screen is recommended. Some features, such as the badge and full-screen layout, need it.

## Using it

Open the public preview at [gh-mobile-plus.pages.dev](https://gh-mobile-plus.pages.dev). GitHub sign-in, Inbox and a public Actions job log have been verified in desktop Chrome. Verification on installed iPhone and Android devices is pending.

- **iPhone and iPad:** open the address in Safari, tap the Share button, then **Add to Home Screen**. Open GH Mobile+ from the Home Screen and sign in there; the installed app keeps its own sign-in, separate from Safari.
- **Android:** open the address in Chrome and tap **Install app** when the app offers it, or use the Chrome menu and choose **Add to Home screen**.
- **Any browser:** the app also works in a normal tab. Choose **Continue in browser** during onboarding.

## Self-hosting

GH Mobile+ runs on the Cloudflare Pages free tier.

1. Create a GitHub **OAuth App**, with the callback URL `https://<your-project>.pages.dev/auth/callback`. Enable expiring user tokens.
2. Create a Cloudflare Pages Direct Upload project with production branch `main`. Set `name` in `wrangler.toml` to your Pages project name.
3. Set the environment variables and secrets listed in [docs/SPEC.md §14](docs/SPEC.md#14-configuration).

`public/_headers` sets the Content Security Policy and security headers, and `public/_routes.json` limits Functions to `/auth/*`. Set `GHM_GITHUB_CLIENT_ID`, `GHM_TOKEN_MODE` (`expiring`) and `GHM_COOKIE_ACTIVE_KID` as variables, and `GHM_GITHUB_CLIENT_SECRET` and `GHM_COOKIE_KEYS` as secrets. Generate a cookie key with `openssl rand -base64 32` and store it as `{"k1":"<key>"}`. Never set `GHM_DEV_INSECURE_COOKIES`, `GHM_GITHUB_OAUTH_ORIGIN` or `GHM_GITHUB_API_ORIGIN` in production; they are for local development and tests only. Optionally set the repository variable `VITE_GHM_SOURCE_URL` to your public repository URL so About links to it.

GitHub Actions deploys the checked build after all CI jobs pass on a push to `main`. Set the repository variable `CLOUDFLARE_ACCOUNT_ID` and the Actions secret `CLOUDFLARE_API_TOKEN` with the Cloudflare Pages Edit permission. Keep the OAuth secrets in Cloudflare Pages.

For a manual deployment:

```sh
pnpm build
pnpm exec wrangler pages deploy dist --branch main
```

To rotate the cookie key, add a new kid to `GHM_COOKIE_KEYS`, point `GHM_COOKIE_ACTIVE_KID` at it, and remove the old kid after the longest session you want to keep (refresh tokens last up to six months).

## Development

Requires Node.js LTS and pnpm.

```sh
pnpm install
cp .dev.vars.example .dev.vars   # fill in a development OAuth App
pnpm dev
```

Use a separate OAuth App for local development, with the callback URL `http://localhost:8788/auth/callback`.

| Purpose | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| App and `/auth` functions on http://localhost:8788 | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint (zero warnings) | `pnpm lint` |
| Format check / write | `pnpm format:check` / `pnpm format` |
| Unit and Worker tests | `pnpm test` |
| End-to-end tests (WebKit iPhone 15, Chromium Pixel 8) | `pnpm e2e` |
| Message catalog parity | `pnpm i18n:check` |
| Production build and size budget | `pnpm build && pnpm size` |
| Everything CI runs | `pnpm ci:all` |
| Regenerate GraphQL types | `pnpm gql:generate` |
| Regenerate app icons / license list | `pnpm icons` / `pnpm run licenses` |

The first end-to-end run needs `pnpm exec playwright install webkit chromium`. End-to-end tests serve the production build over HTTPS on port 8788 with a mock GitHub on port 8790, and never read `.dev.vars`.

In development builds, `/__diagnostics` runs the spike probes from SPEC §12 with your signed-in account. The Notifications probe marks one already-read thread as read and done and unsubscribes from it.

## Architecture

The app is a React single-page app that calls the GitHub REST and GraphQL APIs directly from the browser. A tiny stateless Cloudflare function under `/auth` handles only the OAuth code exchange and token refresh. That function is required because GitHub's token endpoint does not allow browser requests.

Tokens are kept in memory, and refresh tokens are kept in encrypted HttpOnly cookies. There is no database, no analytics and no tracking.

See [docs/SPEC.md](docs/SPEC.md) and [docs/adr](docs/adr).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
