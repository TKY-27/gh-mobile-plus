# 0013. Offline privacy setting excludes all repository content

- Status: Accepted
- Date: 2026-11-18

## Context

SPEC §5.3 says that when "Keep private repository content offline" is off, queries whose results come from private repositories are excluded from persistence. Many queries mix repositories (Inbox, Work, the activity feed, search) or do not carry a visibility flag for every item, so classifying each query exactly would need per-result inspection in every module, and a mistake would leak private content to disk.

## Decision

When the setting is off, the query cache is default-deny: only queries explicitly marked as basic profile information are saved and restored, and every other query is excluded, whether its repository is public or private and whether or not its module marked it. Turning the setting off purges every account's saved cache with the same rule. The Settings footer says exactly this.

## Consequences

- With the setting off, private repository content never reaches the query cache on disk. This fails safe, including for queries added later. Drafts the user writes are stored separately and are deleted on sign-out.
- With the setting off, public repository content is not available offline either. Users who want offline reading keep the default (on).
