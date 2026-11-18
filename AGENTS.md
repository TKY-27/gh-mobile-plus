# AGENTS.md

Instructions for every AI agent working in this repository.

## 1. Source of truth

- Read `docs/SPEC.md` before any work. When anything conflicts with it, SPEC.md wins.
- When a decision changes, update `docs/SPEC.md`, add a line to its `## Changelog`, and add an ADR in `docs/adr/` (next number, same format as existing ADRs).
- All code, comments, docs, commit messages and identifiers are in English. The only exception is `README.ja.md` and the `ja` message catalog.

## 2. Commands

| Purpose | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Dev server (app + `/auth` functions) | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint (zero warnings) | `pnpm lint` |
| Format check / write | `pnpm format:check` / `pnpm format` |
| Unit and Worker tests | `pnpm test` |
| End-to-end tests | `pnpm e2e` |
| i18n key parity | `pnpm i18n:check` |
| Production build + size budget | `pnpm build && pnpm size` |
| Everything CI runs | `pnpm ci:all` |

These scripts must exist in `package.json` with exactly these names. `.github/workflows/ci.yml` calls them.

## 3. Code Quality Rules

AI slop is code that compiles and passes a glance review but degrades the codebase. It is forbidden everywhere, with no exceptions.

Comments
- Never write a comment of 8 or more words. This includes doc comments.
- Comment only why: intent, constraint, trade-off, surprising behavior.
- Never restate the code, echo a signature, or narrate steps.
- No placeholder, TODO, section-divider or commented-out code.
- Prefer a clearer name over any comment.

Structure
- No speculative abstraction: no single-implementation interfaces or protocols, no single-product factories, no layers without a second caller.
- No single-use helpers unless they clearly improve readability.
- No over-modularization: do not split simple logic across files.
- No god functions; keep functions short with one responsibility.
- Search the codebase before adding a helper; reuse, never duplicate.
- Use the standard library and platform APIs before writing your own.
- Follow the language's official style guide and the existing patterns in the repo.

Correctness and safety
- Never swallow errors or add silent fallbacks; handle specific, expected errors.
- No defensive bloat: do not re-validate already-typed inputs; validate at trust boundaries only.
- No unsafe casts, force unwraps or `any` to silence the compiler; fix the types.
- Verify every dependency exists and every API against official docs; keep dependencies minimal.
- No hardcoded magic values; use named constants or configuration.
- No secrets in code or logs.

Naming
- Specific domain names. Never `data`, `info`, `item`, `manager`, `helper`, `util`, `process`, `handle`, `temp` as a whole name.

Hygiene
- No dead code, unused imports, debug prints or leftover experiments.
- Formatter and linter must pass with zero warnings.

Tests
- Test behavior, not implementation; no mocking so heavy the test only checks the mock.
- Never edit, weaken, skip or delete a test to make it pass; fix the code.
- Never game checks in any way.

### Project-specific rules

- `dangerouslySetInnerHTML` is allowed only in `src/markdown/SafeHtml.tsx`; ESLint enforces it.
- UI code (`src/app`, `src/features`, `src/ui`) never calls `fetch` against GitHub and never contains GraphQL. It consumes hooks exported from `src/data`.
- Tokens, codes, verifiers and cookie contents never reach storage, URLs, logs or error messages.
- Every user-facing string goes through the i18n catalogs, in both `en` and `ja`.
- Every gesture has a non-gesture alternative.

## 4. Git and deployment

- The published v1 commit starts the shared Git history. Keep shared commits intact and use Conventional Commits in English.
- Pull requests run CI. A successful `main` push runs the production Cloudflare Pages deployment after all checks.
- Treat every push to `main` as a production deployment and obtain the operator's authorization.
- Never commit secrets: `.dev.vars` stays ignored, and only `.dev.vars.example` is committed.
- Keep the working tree passing `pnpm ci:all` at every checkpoint.

## 5. Workflow and roles

The operator runs Claude Code with **Opus 5.5 (high effort) as orchestrator**. The orchestrator plans work units, assigns them, integrates, and keeps SPEC.md current.

| Role | Model | Owns |
|---|---|---|
| Orchestrator | Opus 5.5 high | Planning, integration, `docs/`, final squash |
| UI/UX and performance | Opus 5.5 subagents | `src/app`, `src/features`, `src/ui`, `src/i18n` |
| Data layer, auth, tooling | GPT-6.1 Sol or GPT-6.1 Terra via the `codex:rescue` skill | `src/data`, `functions/auth`, `schema/`, build and CI config |
| Complex implementation and whole-repo review | GPT-6 Astra via the `codex:rescue` skill | Security review of `src/markdown`, `functions/auth`, `src/data/session`; final review |

Rules:

- The typed exports of `src/data` are the contract between roles. Define or change a contract first, then build UI against it.
- One owner per directory at a time. Never have two agents edit the same file concurrently.
- After each major unit of work, a **fresh review subagent** with no prior context checks the diff against SPEC.md and the Code Quality Rules. Fix every valid finding before the next checkpoint.
- Anything touching auth, session, cookies, CSP or `SafeHtml` additionally gets a GPT-6 Astra security review.

## 6. Documentation upkeep

Keep `README.md`, `README.ja.md` and `CHANGELOG.md` (Unreleased section) in sync with what is actually implemented. Replace every "to be completed" marker in the READMEs before the final commit.
