# 0010. Accent text contrast

- Status: Accepted
- Date: 2026-11-17

## Context

SPEC §8 sets the accent to `#3D7BFF` in light mode and `#5B8FFF` in dark mode, and requires WCAG 2.2 AA. `#3D7BFF` on white is about 3.9:1. That passes the 3:1 minimum for non-text indicators but fails the 4.5:1 minimum for normal text, such as links and accent-colored labels.

## Decision

- `--accent` keeps the specified values and is used for indicators: focus rings, selection, progress, and icons with a text label.
- `--accent-text` is used for accent-colored text: `#1F5FE6` in light mode and `#7AA5FF` in dark mode.
- `--accent-fill` is the background of filled accent buttons, paired with `--on-accent` text so the pair reaches 4.5:1.
- A unit test checks every text, status and accent pairing in both themes.

## Consequences

- The design still reads as one accent color, while text meets AA.
- New UI must pick the right token: `--accent` never colors text.
