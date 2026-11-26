# 0018. Put personal activity first on Home

- Status: Accepted
- Date: 2026-11-22

## Context

Following opened first and personal contributions and repositories were hidden in Overview. The requester selected a compact card layout with contributions at the top while retaining all five navigation destinations.

## Decision

Open Home on You. Place the contribution calendar first, then four Work-count links and two recently pushed repository cards. Use the existing Work query and cache, with links selecting the matching Work segment. Refresh contributions and work together. Keep loading, error and stale-data states distinct from a genuine zero count.

Keep Following as a separate Home section. Its labeled notifications link opens the existing Inbox rather than mixing received events with personal notifications. Retain the header bell and all five tabs.

Use the current system typography, semantic colors and spacing tokens. Let the contribution calendar carry the visual identity; cards group actionable data without shadows, ornamental gradients or nonessential motion.

## Consequences

Home loads the existing combined Work query earlier; the Work tab reuses its cache. Following queries mount only when that Home section is selected, keeping the cold Home, Work and Inbox request budget unchanged. Recent repositories show a two-card preview instead of a horizontal rail; the complete list remains one tap away. Work segment selection is reflected in the URL and survives tab switching. Opening a Home work card intentionally returns the Work tab to its root queue rather than retaining its previous detail stack.
