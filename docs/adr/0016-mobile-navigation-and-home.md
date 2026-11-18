# 0016. Put owned repositories in primary navigation

- Status: Accepted
- Date: 2026-11-18

## Context

Reaching an owned repository required opening a profile and then its repository list. Home gave release previews priority over activity. At wide widths, list rows stretched across the viewport.

## Decision

Home, Repositories, Work, Search and Account share the same order in the mobile tab bar and the wide-screen navigation rail. Home places notifications and settings beside the profile link. The notification URL stays at `/notifications`. The Repositories tab opens the active account’s owned list. Links to other users’ repositories keep their profile context.

The Home viewer query includes six owned repositories ordered by last push. Activity follows the contribution calendar and repository strip. Releases from starred repositories remain accessible from the activity selector. Search exposes examples for the selected GitHub search scope.

## Consequences

Owned repositories are one tap away from every primary screen. Notifications take one tap from Home and retain a direct URL. Home gains repository summaries within the existing API request budget. Long lists and navigation controls share a bounded workspace on desktop.
