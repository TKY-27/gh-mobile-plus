# 0006. One custom design and a native-like shell

- Status: Accepted
- Date: 2026-11-17

## Context

The app must feel like a native app on iPhone, with equal quality on Android. Mimicking both Cupertino and Material doubles the work and produces imitations of each.

## Decision

- One custom, near-monochrome design with a single accent color and translucent bars, used on every platform.
- Native feel comes from behavior: a five-tab bar (Home, Work, Inbox, Search, Account), independent per-tab stacks with preserved scroll, re-tap to scroll to top and pop to root, an interactive edge-swipe back, keyboard-aware bars, and safe areas.

## Consequences

Platform differences are limited to install guidance and safe-area handling.
