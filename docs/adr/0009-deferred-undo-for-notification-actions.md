# 0009. Deferred undo for notification actions

- Status: Accepted
- Date: 2026-11-17

## Context

SPEC §8 requires an Undo toast for Done and Mark read. The Notifications REST API has no endpoint to mark a thread unread or to restore a thread marked done, so an action that was already sent cannot be undone.

## Decision

Done and Mark read update the cache immediately and send the request only after a 5-second undo window. Undo inside the window cancels the request and restores the row. If the request fails, the row rolls back and an error toast offers Retry. Bulk actions and opening a thread (which marks it read) are not deferred.

## Consequences

- Undo is honest: it never pretends to reverse a server-side change.
- If the app is closed within the window, the pending request is lost and the thread stays unread on GitHub. This is the safe failure direction.
