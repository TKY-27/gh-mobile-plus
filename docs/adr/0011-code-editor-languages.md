# 0011. Code highlighting and editor languages

- Status: Accepted
- Date: 2026-11-18

## Context

SPEC §3.3 requires Shiki with the JavaScript regex engine in a Web Worker, with languages lazy-loaded, and CodeMirror 6 for editing. SPEC §6.10 asks for "the same language highlighting" in the editor. SPEC §10 keeps both out of the 170 KB initial bundle.

Three constraints shaped the implementation:

- Vite builds workers as IIFE by default, and an IIFE worker cannot code-split. A worker that imports grammars dynamically gets every grammar inlined (2.95 MB), which also exceeds the service worker's 2 MiB precache limit.
- Light and dark Shiki themes would require re-highlighting on every theme change and would not match our design tokens.
- Adding `@codemirror/lang-*` or `@codemirror/language-data` would add a second highlighter, with different tokenization and colors, plus many new packages.

## Decision

- `src/ui/code/highlight.ts` keeps an explicit map from the language ids that `languageForPath()` returns to `import("shiki/langs/<id>.mjs")`. The main thread loads a grammar on first use. Each grammar is its own lazy chunk. It sends the grammar to the worker once per language.
- The worker (`highlight.worker.ts`) uses `shiki/core` and `createJavaScriptRegexEngine({ forgiving: true })` and does all tokenization. It holds no grammars of its own (about 170 KB, lazy). Lines longer than 2,000 characters are not tokenized, so minified files cannot stall the queue. Requests run one at a time and stale ones are cancelled.
- There is one theme: Shiki's CSS-variables theme. The worker returns a token kind (`keyword`, `string`, …) instead of a color. `src/ui/code/code.module.css` maps each kind to design tokens with `light-dark()`, so both themes switch instantly. Every kind keeps 4.5:1 against both background tokens.
- The editor (`src/ui/code/editor.tsx`, lazy) uses only the CodeMirror packages already listed in `package.json`. A small view plugin sends the document to the same worker after a 300 ms pause and applies the returned token kinds as decorations. No `@codemirror/lang-*` or `@codemirror/language-data` package is added.
- The public API is `useHighlightedLines(lines, language)`, which returns per-line tokens or `null` while pending, `CodeTokens` to render one line, and the lazy `CodeEditor` component.

## Consequences

- No new dependency. The initial bundle is unchanged. Grammar chunks are precached for offline reading.
- The viewer, the editor and future diff views share one highlighter and one palette.
- The editor has no language-aware indentation or bracket matching. New lines keep the previous line's indentation, and the indent unit is detected from the file. This is acceptable for light mobile edits.
- Grammars are parsed once on the main thread before transfer. This happens once per language per session.
- If the worker build format later becomes ES modules, the grammar loading can move into the worker without changing the public API.
