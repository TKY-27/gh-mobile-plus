# 0017. Keep navigation, profile editing and repository management within reach

- Status: Accepted
- Date: 2026-11-19

## Context

Settings and account switching were below profile content. Contributions and recent repositories preceded the Home feed. The client could read a profile, but editing it or forking a repository required leaving the application.

## Decision

Keep five persistent destinations and the independent navigation stacks. Add a left drawer to every tab root and move account switching and settings into the Account header. A leading-edge gesture opens the drawer at a root and goes back within a stack. Safari retains its native history gesture. Bottom sheets use a fixed dialog with a draggable header so focusing or scrolling a form cannot dismiss it. Following and Overview share Home. Profile statistics link to the corresponding lists. Profile editing and sharing sit together above the profile sections.

Request the GitHub OAuth `user` scope when the viewer enables profile editing. Retain the same GitHub account and public-only or full repository grant through consent. Keep editable fields out of the offline cache. Use the documented user, social account and repository APIs for changes. Show administration to repository administrators and patch only the fields they change.

## Consequences

The app can update the user's profile, manage social links, create personal repositories, fork into a selected account and change general repository settings. Files can be created from a branch directory after checking the target path at the expected commit. Pull requests can also start from the repository pull list by comparing existing branches. Submitting these operations requires a connection. GitHub credentials, passkeys and payment instruments remain under GitHub's control.
