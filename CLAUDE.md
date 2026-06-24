# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`clone-alert` is a PMD CPD-like copy-paste detector for TypeScript, JavaScript,
and frontend templates (Vue, Svelte, Angular). **PMD CPD is the etalon**:
divergences from PMD's token stream and match output are treated as defects to
fix toward PMD, not as design choices. Source is in `src/`, docs/README are in
Russian, code comments are mostly Russian, identifiers and CLI/help text are English.

## Commands

```sh
npm run build          # tsc -> dist/ (CLI is dist/cli.js)
npm test               # builds, then `vitest run` (the whole suite)
npm run lint           # biome --write + knip + tsc --noEmit (both tsconfigs) + self-CPD
npm run check          # biome check only (no write)
npm run check-types    # tsc --noEmit for tsconfig.json and tsconfig.test.json
npm run compare:pmd -- <path> --minimum-tokens 50   # benchmark vs PMD/jscpd
```

Run a single test file or test by name:

```sh
npm run build && npx vitest run test/pmd-match-algorithm.test.ts
npm run build && npx vitest run -t "name of the test"
```

Tests import from `dist/`, so **`vitest` needs a fresh `npm run build` first**
(the `test` script already chains it). After editing `src/`, rebuild before
re-running vitest directly.

## Architecture

Three layers, strictly one-directional (core knows nothing about languages,
tokenizers know nothing about frameworks):

1. **`src/core.ts` — language-agnostic match engine.** Consumes a flat
   `RawToken[]` stream per file and finds duplicate token spans. It is a faithful
   port of PMD's algorithm; the comparison logic in `MatchCollector` mirrors
   `MatchCollector.java` line-for-line. Performance-critical and heavily tuned:
   - Tokens are stored **struct-of-arrays** on `Int32Array` columns (interned
     image id, file id, begin/end line/col). Full `TokenEntry` objects are
     materialized lazily only for marks that land in a match (`entryAt`).
   - Duplicate detection is **Karp-Rabin rolling hash** (`hash()`, right-to-left,
     all 32-bit arithmetic via `Math.imul`/`| 0` to match the Java hashes
     bit-for-bit) + a **stable LSD radix sort** by hash (`radixSortByHash`)
     instead of a comparator sort.
   - `id === 0` is the EOF/barrier sentinel inserted between files (and at forced
     `barrier` tokens) so matches never cross file/block boundaries.

2. **`src/tokenizers.ts` — the TS/JS tokenizer + shared utilities.**
   `tokenizeTypeScript` drives the TypeScript `Scanner` (not the parser; line
   mapping uses `createLineMap`, no AST). Key behaviors:
   - **PMD typescript compatibility** (`pmdTypescriptCompatibility`, default on,
     `.ts/.tsx` only): splits template literals into PMD-grammar atoms (backtick,
     `${`, `}`, one token per text char) and collapses regexp literals into a
     single token. `.js/.jsx` always use the native scanner (template = 1 token).
   - `--ignore-identifiers` / `--ignore-literals` normalize to the `TS_ID` /
     `TS_LIT` sentinels. Note: clone-alert actually implements these for TS,
     whereas PMD's CLI flags are effectively no-ops for typescript — so there is
     no PMD etalon to diff against in normalize mode.
   - `CPD-OFF` / `CPD-ON` comment markers suppress ranges (`findCpdSuppressedRanges`).
   - Shared helpers `optional()`, `moduleResolveDirs()`, `remap()` are used by all
     framework modules.

3. **Framework tokenizer extensions — `src/angular.ts`, `src/vue.ts`,
   `src/svelte.ts`.** Each emits two token layers:
   - **Markup structure** (tags, directives, attribute names, static text):
     images are prefixed with the module's namespace built on the shared Unicode
     private-use sentinel `S` (``), e.g. `VUE:`, `SV:`, `NG:`. The prefix
     guarantees markup tokens **never cross-match script tokens**.
   - **Binding/interpolation expressions** (`{{ }}`, `:prop`, `v-if`, `@event`,
     `{...}`): these are the same TypeScript in the component scope, so the module
     slices the source and runs it through `tokenizeTypeScript` **without a
     prefix** — so a duplicated expression across template ↔ `<script>` is caught.

   The compilers (`@vue/compiler-sfc`, `svelte`, `@angular/compiler`) are
   **optional peerDependencies**, resolved via `optional()` starting from the
   analyzed file's directory (project's own compiler version first, falling back
   to clone-alert's `node_modules`). Missing compiler → file skipped with a
   warning. **Svelte markup requires svelte 5+** (uses `ast.fragment`; svelte 3/4
   silently fall back to `<script>`-only).

**`src/index.ts`** is the public `Cpd` class: dispatches by extension to the
right tokenizer, feeds tokens to `CpdCore`, and materializes `MatchLocation`s for
reporting. **`src/cli.ts`** is the arg parser + file walker + text/json/xml
reporters. Exit code `4` when `--fail-on-violation` and duplicates are found.

## Conventions

- Biome formats with **4-space indent, single quotes, 120 col, ES5 trailing
  commas** for JS/TS (note: JSON uses 2-space). Run `npm run check:fix` /
  `npm run lint` rather than hand-formatting.
- The lint pipeline includes a **self-CPD pass** (`lint:cpd`) that runs the built
  CLI on `src/` at `--minimum-tokens 70` and fails on violations — large copy-paste
  in `src/` breaks the build.
- Default `--minimum-tokens` is **50**, like PMD, but clone-alert emits ~3.6×
  fewer tokens than PMD on the same code (it collapses templates/regexp), so the
  threshold is **not 1:1 comparable** to a PMD run.

## Tests

Vitest suite in `test/`, anchored to PMD parity. PMD golden fixtures are vendored
under `test/fixtures/pmd/**` (excluded from Biome/tsc so upstream content isn't
reformatted) — no PMD checkout or submodule needed. Notable groups:
`pmd-tokenizer-fixtures` / `pmd-core-coverage` / `pmd-match-algorithm` (parity
with PMD), `pmd-jsx-tsx`, `{angular,vue,svelte}-tokenizer`, `cli` +
`pmd-cli-compat` (CLI behavior). `scripts/compare-pmd-cpd.mjs` (run via
`compare:pmd`) benchmarks PMD, clone-alert, and jscpd on one tree, one language
per run, dropping non-parseable extensions for a fair comparison; jscpd is not a
dependency (pass `--jscpd <command>`).
