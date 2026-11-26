# 0019. Make gestures reliable and the chrome lighter

- Status: Accepted
- Date: 2026-11-26

## Context

In the installed app, swipes sometimes snapped back or opened the row under the finger. A completed back swipe painted a blank frame. Going back during a push made the screen jump. The revealed screen ignored taps for about 0.6 s after Back. Sheets and the drawer did not follow the finger and disappeared without motion. On iOS, `touch-action: pan-y` does not stop WebKit from turning a slightly downward sideways drag into a vertical scroll, which cancels the pointer. React Aria presses also survive a horizontal drag under `pan-y`, because no `pointercancel` arrives. On Android, the system back gesture owns the leading edge, so an in-app edge swipe wobbles and then pops twice.

The owner asked for chrome closer to Instagram and X.

## Decision

- A capture-phase guard cancels any pending React Aria press once a touch or pen moves more than 10 px. It dispatches `pointercancel` to `document` only, so the app's own gesture handlers never see it.
- Engaged horizontal drags (the stack back swipe, the drawer close swipe, row swipes) call `preventDefault` on a non-passive `touchmove`. Nothing is prevented before engagement or for vertical drags.
- The stack keeps the interrupted position when a pop starts mid-push. It makes only the leaving layer inert, clamps spring overshoot, and does not settle layers before `popstate` commits. Back is ignored while a history traversal is pending.
- On Android the in-app edge back swipe is off. The drawer swipe starts after the first 20 px.
- Sheets dismiss on distance or a downward flick and animate in and out. The drawer follows the finger and stays mounted so it can animate out.
- An in-house critically damped spring replaces the Motion package, which is removed.
- The phone tab bar shows icons only on a translucent bar. The active tab is filled or heavier, and every tab keeps its accessible name. Tab-root headers are translucent; detail headers turn translucent once content scrolls under them. The dark theme background is pure black.
- Large lazy chunks are cached on first use instead of precached.
- In the Inbox, every pending Undo stays visible and names its thread, a removed row collapses before the list closes the gap, and Mark read is an icon button with an accessible name.

## Consequences

Taps that drift less than 10 px still count. A drag cancels the press, as native lists do. Row press highlights wait 60 ms, so starting a scroll does not flash them. Tab labels are no longer visible on phones; the navigation rail on wide screens keeps them. Offline, a language cannot be highlighted and the editor cannot open unless that chunk was loaded before.
