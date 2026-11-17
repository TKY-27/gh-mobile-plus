# 0004. Web stack

- Status: Accepted
- Date: 2026-11-17

## Context

The build is performed by AI agents, so the stack should be well represented in training data and well documented. The UI needs full visual freedom, with first-class touch handling and accessibility. Security favors a static SPA with no server rendering.

## Decision

React 19, TypeScript strict, Vite SPA, TanStack Router and Query, React Aria (headless), CSS Modules with token variables, Motion, TanStack Virtual, gql.tada, Shiki (JavaScript engine, in a Web Worker), CodeMirror 6, DOMPurify and vite-plugin-pwa, deployed on Cloudflare Pages with Pages Functions.

## Alternatives rejected

- SolidJS and Svelte: smaller ecosystems for accessible headless primitives and less agent familiarity.
- Monaco: poor mobile support and a heavy bundle.
- Prebuilt component kits: they constrain the custom design.

## Consequences

Any new dependency requires an ADR.
