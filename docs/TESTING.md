# Manual real-device checklist

Automated tests cover behavior in WebKit and Chromium emulation. Before each release, run this checklist on a real iPhone (iOS 18.4 or later, installed to the Home Screen) and a real Android phone (Chrome, installed as an app).

Record results, and any spike outcomes (SPEC §12), in the release PR.

## Install and sign-in (spike S3)

- [ ] The install guide appears only in a browser tab, not in the installed app.
- [ ] Sign in from the installed app. The GitHub page opens, then the app returns signed in, with no stuck browser view.
- [ ] Add a second account. GitHub shows the account picker, and both accounts are listed.
- [ ] Switch accounts by long-pressing the Account tab.
- [ ] Sign out of one account. Its cached data disappears, and the other account still works.
- [ ] A denied consent lands on the sign-in screen with a clear message.

## Session

- [ ] Leave the app for longer than 8 hours. On return, content loads without a sign-in prompt.
- [ ] With two installed app windows or tabs open, both stay signed in after the token refreshes.

## Shell and gestures

- [ ] Each tab keeps its own stack and scroll position.
- [ ] Re-tapping the active tab scrolls to top, then pops to the root.
- [ ] Edge-swipe back is interactive and can be cancelled midway.
- [ ] The keyboard hides the tab bar, and composer fields stay visible above the keyboard.
- [ ] Safe areas are correct with the notch or Dynamic Island, the home indicator, and in landscape.

## Notifications (spike S1)

- [ ] The Inbox loads, and swipe Done and swipe Mark read both sync with github.com.
- [ ] With the badge setting enabled and permission granted, the app icon badge matches the unread count (iOS).

## Review and editing

- [ ] Single-line, range and suggestion comments appear on the correct lines on github.com.
- [ ] A file edit commits directly, through a branch and PR, and through a fork and PR.
- [ ] The conflict path shows the latest version and keeps the draft.

## Actions (spike S2)

- [ ] Completed job logs load with step folding, or show "Open on GitHub" if S2 found them unreadable.
- [ ] Re-run and cancel work, and the workflow_dispatch form submits.

## Offline and lock

- [ ] In airplane mode, previously opened screens render with the offline banner.
- [ ] The app lock prompts Face ID or fingerprint after the idle time, and the lock screen hides content in the app switcher.

## Spikes S1 and S2 (diagnostics screen)

Run these once with a development OAuth App before relying on the defaults.

1. Fill `GHM_GITHUB_CLIENT_ID` and `GHM_GITHUB_CLIENT_SECRET` in `.dev.vars`, run `pnpm dev`, and sign in at http://localhost:8788.
2. Open http://localhost:8788/__diagnostics.
3. **S1:** run the Notifications probe. It lists notifications, repeats the request with `If-Modified-Since`, and marks one already-read thread read and done and unsubscribes from it. If any step fails with an expiring token, set `GHM_TOKEN_MODE=persistent` and record the result in a new ADR.
4. **S2:** enter a repository with a completed Actions run and run the logs probe. Record the final log host and whether it was readable. If it was not readable, set `LOGS_READABLE` to `false` in `src/data/actions/index.ts`. Either way, reduce `connect-src` in `public/_headers` to the hosts observed, and record both in a new ADR.

## Acceptance criteria that need a real device or live GitHub

Automated tests cover these with emulation and recorded fixtures. Confirm them on hardware or against github.com before each release.

- [ ] 200 notifications, 500-row lists and a 5,000-line diff scroll at 60 fps on a mid-range phone (SPEC §6.3.5, §6.13.3, §10).
- [ ] Edge-swipe back stays at 60 fps and can be cancelled on a mid-range phone (SPEC §6.1).
- [ ] Single-line, range and suggestion comments land on the correct lines on github.com, including a range that starts on an unchanged line and ends on a deleted line (SPEC §6.13.3).
- [ ] Marking a file viewed in the app shows it as viewed on github.com, and the other way round (SPEC §6.13.3).
- [ ] A fork + PR edit works against a repository you cannot push to, and the PR opens from your fork (SPEC §6.10).
- [ ] A merge with "Delete branch" removes the head branch on github.com (SPEC §6.12).
- [ ] An organization with OAuth App access restrictions or SAML SSO shows the explanation and the approval or SSO link (SPEC §4.5).
- [ ] Startup: the installed app is interactive within 1.0 s from a warm cache on an iPhone 13-class device, and LCP is under 2.5 s on Fast 4G (SPEC §10).
- [ ] VoiceOver and TalkBack can reach every swipe action through the row's actions button, and focus moves to the new screen title on navigation (SPEC §10).
- [ ] Dynamic Type at the largest sizes and landscape on a notched iPhone do not break the tab bar, large titles or sheets (SPEC §2, §8).
