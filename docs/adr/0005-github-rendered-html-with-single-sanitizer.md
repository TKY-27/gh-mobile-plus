# 0005. GitHub-rendered HTML through a single sanitizer

- Status: Accepted
- Date: 2026-11-17

## Context

GitHub-flavored Markdown has many extensions: mentions, references, task lists, alerts, math and diagrams. Re-implementing them client-side risks both rendering drift and XSS.

## Decision

Render only HTML produced by GitHub (`bodyHTML`, the `html` media type, `POST /markdown`). Sanitize it with DOMPurify in the single component `src/markdown/SafeHtml.tsx`, and enforce that with ESLint. A strict CSP forbids inline scripts.

## Consequences

- Rendering matches github.com without a client-side markdown engine.
- Previewing a draft costs one API request.
