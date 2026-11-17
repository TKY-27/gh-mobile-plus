# 0007. Supporting tooling dependencies

- Status: Accepted
- Date: 2026-11-17

## Context

SPEC §3.3 names the product stack. Its implementation also needs framework adapters, platform types, build tools and test infrastructure. WU0 pins the latest stable direct dependencies compatible with that stack, verified against the official npm registry on 2026-11-17. This table includes every direct dependency, including supporting packages not literally named by SPEC §3.3. The pnpm lockfile pins transitive dependencies.

## Decision

| Dependency | Exact version | Purpose |
|---|---|---|
| [@codemirror/commands](https://www.npmjs.com/package/@codemirror/commands/v/6.11.1) | 6.11.1 | Editing and history commands. |
| [@codemirror/language](https://www.npmjs.com/package/@codemirror/language/v/6.13.1) | 6.13.1 | Editor language infrastructure; grammars are added later. |
| [@codemirror/search](https://www.npmjs.com/package/@codemirror/search/v/6.7.2) | 6.7.2 | Editor search. |
| [@codemirror/state](https://www.npmjs.com/package/@codemirror/state/v/6.7.6) | 6.7.6 | Editor document and transaction state. |
| [@codemirror/view](https://www.npmjs.com/package/@codemirror/view/v/6.43.15) | 6.43.15 | Accessible editor surface. |
| [@tanstack/react-query](https://www.npmjs.com/package/@tanstack/react-query/v/5.107.1) | 5.107.1 | Implements the TanStack Query choice in SPEC §3.3. |
| [@tanstack/react-query-persist-client](https://www.npmjs.com/package/@tanstack/react-query-persist-client/v/5.107.1) | 5.107.1 | Per-account TanStack Query persistence. |
| [@tanstack/react-router](https://www.npmjs.com/package/@tanstack/react-router/v/1.170.46) | 1.170.46 | Implements the TanStack Router choice in SPEC §3.3. |
| [@tanstack/react-virtual](https://www.npmjs.com/package/@tanstack/react-virtual/v/3.14.26) | 3.14.26 | Implements the TanStack Virtual choice in SPEC §3.3. |
| [dompurify](https://www.npmjs.com/package/dompurify/v/3.4.18) | 3.4.18 | Implements the dompurify choice in SPEC §3.3. |
| [gql.tada](https://www.npmjs.com/package/gql.tada/v/1.11.5) | 1.11.5 | Implements the gql.tada choice in SPEC §3.3. |
| [lucide-react](https://www.npmjs.com/package/lucide-react/v/1.73.0) | 1.73.0 | Implements the lucide-react choice in SPEC §3.3. |
| [motion](https://www.npmjs.com/package/motion/v/14.14.0) | 14.14.0 | Implements the motion choice in SPEC §3.3. |
| [react](https://www.npmjs.com/package/react/v/19.3.1) | 19.3.1 | Implements the react choice in SPEC §3.3. |
| [react-aria-components](https://www.npmjs.com/package/react-aria-components/v/1.22.1) | 1.22.1 | Implements the React Aria choice in SPEC §3.3. |
| [react-dom](https://www.npmjs.com/package/react-dom/v/19.3.1) | 19.3.1 | React DOM mounting. |
| [shiki](https://www.npmjs.com/package/shiki/v/4.6.0) | 4.6.0 | Implements the shiki choice in SPEC §3.3. |
| [yaml](https://www.npmjs.com/package/yaml/v/2.9.1) | 2.9.1 | Parse workflow_dispatch inputs and GitHub issue forms. |
| [@0no-co/graphqlsp](https://www.npmjs.com/package/@0no-co/graphqlsp/v/1.18.0) | 1.18.0 | GraphQL editor diagnostics and gql.tada schema generation plugin. |
| [@cloudflare/vitest-plugin](https://www.npmjs.com/package/@cloudflare/vitest-plugin/v/1.8.2) | 1.8.2 | The official new name of `@cloudflare/vitest-pool-workers` named in SPEC §3.3. |
| [@cloudflare/workers-types](https://www.npmjs.com/package/@cloudflare/workers-types/v/5.20261116.1) | 5.20261116.1 | Pages Function and Worker type definitions. |
| [@eslint/js](https://www.npmjs.com/package/@eslint/js/v/10.0.1) | 10.0.1 | ESLint recommended JavaScript rules. |
| [@msw/playwright](https://www.npmjs.com/package/@msw/playwright/v/0.7.0) | 0.7.0 | Official MSW Playwright route interception; stable latest tag, not a prerelease. |
| [@playwright/test](https://www.npmjs.com/package/@playwright/test/v/1.65.1) | 1.65.1 | Implements the Playwright choice in SPEC §3.3. |
| [@testing-library/dom](https://www.npmjs.com/package/@testing-library/dom/v/10.4.2) | 10.4.2 | Required Testing Library React peer. |
| [@testing-library/react](https://www.npmjs.com/package/@testing-library/react/v/16.3.3) | 16.3.3 | React behavior testing. |
| [@types/node](https://www.npmjs.com/package/@types/node/v/26.6.6) | 26.6.6 | Types for native Node TypeScript scripts and build configuration. |
| [@types/react](https://www.npmjs.com/package/@types/react/v/19.3.0) | 19.3.0 | React TypeScript declarations. |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom/v/19.3.0) | 19.3.0 | React DOM TypeScript declarations. |
| [@vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react/v/6.3.0) | 6.3.0 | Official Vite React integration. |
| [eslint](https://www.npmjs.com/package/eslint/v/10.15.0) | 10.15.0 | Implements the eslint choice in SPEC §3.3. |
| [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks/v/7.1.1) | 7.1.1 | Official React Hooks recommended rules. |
| [fake-indexeddb](https://www.npmjs.com/package/fake-indexeddb/v/6.2.8) | 6.2.8 | IndexedDB test environment for the specified persistence work. |
| [graphql](https://www.npmjs.com/package/graphql/v/17.1.0) | 17.1.0 | Required GraphQL plugin and MSW peer. |
| [@0no-co/graphql.web](https://www.npmjs.com/package/@0no-co/graphql.web/v/1.3.4) | 1.3.4 | Prints gql.tada documents for requests. gql.tada already ships it at runtime, so the app bundles one GraphQL library, not two. |
| [jsdom](https://www.npmjs.com/package/jsdom/v/31.0.1) | 31.0.1 | DOM environment for the unit test project. |
| [msw](https://www.npmjs.com/package/msw/v/3.0.6) | 3.0.6 | Implements the msw choice in SPEC §3.3. |
| [prettier](https://www.npmjs.com/package/prettier/v/3.10.1) | 3.10.1 | Implements the prettier choice in SPEC §3.3. |
| [typescript](https://www.npmjs.com/package/typescript/v/6.0.3) | 6.0.3 | Implements the typescript choice in SPEC §3.3. |
| [typescript-eslint](https://www.npmjs.com/package/typescript-eslint/v/8.72.2) | 8.72.2 | Implements the typescript-eslint choice in SPEC §3.3. |
| [vite](https://www.npmjs.com/package/vite/v/8.3.8) | 8.3.8 | Implements the vite choice in SPEC §3.3. |
| [vite-plugin-pwa](https://www.npmjs.com/package/vite-plugin-pwa/v/2.0.0) | 2.0.0 | Implements the vite-plugin-pwa choice in SPEC §3.3. |
| [vitest](https://www.npmjs.com/package/vitest/v/4.1.12) | 4.1.12 | Implements the vitest choice in SPEC §3.3. |
| [workbox-precaching](https://www.npmjs.com/package/workbox-precaching/v/7.4.1) | 7.4.1 | Precache the app shell and remove obsolete caches. |
| [workbox-routing](https://www.npmjs.com/package/workbox-routing/v/7.4.1) | 7.4.1 | Navigation fallback with the auth path excluded. |
| [wrangler](https://www.npmjs.com/package/wrangler/v/4.162.0) | 4.162.0 | Serve Pages Functions and static assets locally. |

Use Node 26 native TypeScript stripping for scripts; no tsx or concurrent process dependency. Use code-based TanStack routes; no router plugin. Use jsdom rather than a second DOM implementation. Use the official stable-tagged @msw/playwright package rather than maintaining a custom MSW adapter.

The pnpm workspace configuration allows build scripts only for esbuild and workerd, which supply the native executables used by the Functions bundler and local Worker runtime.

Compatibility constraints:

- TypeScript 6.0.3 is the latest stable 6.0 release supported by both typescript-eslint 8.72.2 (`<6.1`) and @0no-co/graphqlsp 1.18.0 (`^5 || ^6`). TypeScript 7.0.2 is not compatible with those peers.
- SPEC §3.3 names `@cloudflare/vitest-pool-workers`. Cloudflare renamed it to `@cloudflare/vitest-plugin`; the last release under the old name (0.23.0) bundles a workerd that rejects current compatibility dates. Use the renamed package and its `cloudflareTest()` Vite plugin. SPEC §3.3 is updated to the new name.
- Vite plugin React 6 uses Vite 8's built-in React transform. Optional compiler/Babel peers are unnecessary.

Official API references:

- [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/): `pages dev --port 8788 --proxy 5173`; `--proxy` is a deprecated numeric upstream port. Wrangler ignores it when `pages_build_output_dir` is configured. The dev launcher creates an ephemeral config without that property, symlinks Functions and `.dev.vars`, and removes the workspace on exit. `--binding KEY=VALUE` supplies test origins. The command-based proxy form is deprecated.
- [Cloudflare Vitest configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/): current documentation describes the replacement plugin. The pinned pool's published type declarations verify the equivalent `cloudflareTest` root export and `buildPagesASSETSBinding`. Pages tests use `createPagesEventContext` and `waitOnExecutionContext` from `cloudflare:test`.
- [gql.tada workflows](https://gql-tada.0no.co/get-started/workflows): generate preprocessed `.d.ts` schema output for efficient large-schema checks. Turbo caches document inference; no GraphQL documents exist in WU0, so turbo adds no value yet.
- [GitHub public schema](https://docs.github.com/en/graphql/overview/public-schema): snapshot from `https://docs.github.com/public/fpt/schema.docs.graphql`.
- [Vite PWA injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest): compile the custom service worker and inject its precache list without automatic registration.
- [Workbox precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching) and [routing](https://developer.chrome.com/docs/workbox/modules/workbox-routing): shell-only precache with an auth-denied navigation fallback.
- [MSW Playwright](https://github.com/mswjs/playwright): official package using Playwright routing without installing an MSW service worker.

Playwright 1.65.1 includes the Pixel 8 descriptor: viewport 412×839, screen 412×915, DPR 2.625. WU0 uses it directly; no Pixel 7 fallback is necessary.

## Alternatives rejected

- Upgrading to the renamed Cloudflare test package without changing SPEC: violates the specified stack.
- TypeScript 7 and Vitest 5: incompatible with required peers.
- React compiler, router generation, icon rasterization libraries and process runners: unnecessary for this scaffold.

## Consequences

These dependencies are build, test and tooling support only; the runtime additions are `yaml` and `@0no-co/graphql.web`. End-to-end tests run a mock GitHub on `http://127.0.0.1:8790`. Real-device acceptance remains the manual checklist in docs/TESTING.md.
- Every pinned version is at least one day old, so pnpm's default `minimumReleaseAge` applies with no exemptions. `pnpm-workspace.yaml` only allows the install scripts of `esbuild` and `workerd`. The Workers compatibility date is 2026-11-10, which the pinned workerd supports.
