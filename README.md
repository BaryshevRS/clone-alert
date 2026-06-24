# clone-alert

> Fast **copy‑paste detector** for **TypeScript**, **JavaScript**, **JSX/TSX**, **Vue**, **Svelte** and **Angular** — a **PMD CPD‑compatible** duplicate‑code finder you can drop into any project or CI pipeline.

[![npm version](https://img.shields.io/npm/v/clone-alert.svg)](https://www.npmjs.com/package/clone-alert)
[![license](https://img.shields.io/npm/l/clone-alert.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/clone-alert.svg)](https://nodejs.org)
[![types](https://img.shields.io/npm/types/clone-alert.svg)](https://www.npmjs.com/package/clone-alert)

**clone-alert** finds duplicated and copy‑pasted code across your codebase by comparing **token streams** — the same proven approach as [PMD CPD](https://pmd.github.io/) (Copy‑Paste Detector), but built natively for the JavaScript/TypeScript ecosystem and your frontend templates. Catch code clones, enforce **DRY**, reduce technical debt, and fail your build when duplication creeps in.

```sh
npx clone-alert --minimum-tokens 50 --files src
```

---

## Why clone-alert?

- 🎯 **PMD CPD‑compatible** — a faithful port of PMD's match algorithm and JavaScript/TypeScript tokenizers, validated against PMD's own golden fixtures.
- ⚡ **Fast on large monorepos** — a struct‑of‑arrays token core with a Karp–Rabin rolling hash and radix‑sorted buckets. In our [benchmarks](#benchmarks) it runs **10–30× faster** than PMD CPD while using **1.4–2.5× less memory**, on real codebases from Next.js to nx.
- 🧩 **Frontend templates, natively** — tokenizes **Vue** `<template>`, **Svelte** markup, and **Angular** templates, not just `<script>` blocks. Detects template‑to‑script duplication too.
- 🧪 **Zero‑config CLI** — sensible defaults, recursive directory scan, `node_modules`/`.git`/`dist` skipped automatically.
- 📦 **Tiny footprint** — a single runtime dependency (`typescript`). Framework parsers are **optional peer dependencies**, loaded only when needed.
- 🛠 **CI‑ready** — `text`, `json`, and PMD‑style `xml` reports, plus `--fail-on-violation` (exit code `4`).
- 🔇 **Inline suppression** — ignore known duplication with `CPD-OFF` / `CPD-ON` comment markers.

## Supported languages & frameworks

| Language / framework | Extensions | Notes |
| --- | --- | --- |
| TypeScript | `.ts`, `.mts`, `.cts` | PMD `typescript` token granularity by default |
| TSX / JSX | `.tsx`, `.jsx` | React‑style components |
| JavaScript | `.js`, `.mjs`, `.cjs` | Native scanner tokenization |
| Vue | `.vue` | `<script>`, `<script setup>` and `<template>` markup |
| Svelte | `.svelte` | `<script>` and markup (**requires Svelte 5+**) |
| Angular | `.html`, `.htm`, inline templates | External and `@Component` inline templates |

## Installation

Add it as a dev dependency:

```sh
npm install --save-dev clone-alert
# or
pnpm add -D clone-alert
# or
yarn add -D clone-alert
```

Or run it once, without installing:

```sh
npx clone-alert --minimum-tokens 50 --files src
```

Requires **Node.js 18+**.

## Quick start

```sh
# Scan a folder and print a human‑readable report
clone-alert --minimum-tokens 50 --files src

# Fail CI when duplication is found (exit code 4)
clone-alert --minimum-tokens 50 --files src --fail-on-violation

# Machine‑readable output for dashboards
clone-alert --format json --files src,packages > duplication.json
```

## Usage

```sh
clone-alert [options] [<path>...]
```

### CLI options

| Option | Description |
| --- | --- |
| `--files <path[,path...]>` | Files or directories to scan. Can be repeated. |
| `--minimum-tokens <n>` | Minimum duplicated token span. Default: `50`. |
| `--minimum-tile-size <n>` | Alias for `--minimum-tokens`. |
| `--format <text\|xml\|json>` | Report format. Default: `text`. |
| `--extensions <ext[,ext...]>` | Extensions to include during recursive scans. |
| `--exclude <glob[,glob...]>` | Exclude files or directories (glob). Can be repeated. |
| `--ignore-identifiers` / `--no-ignore-identifiers` | Normalize or compare identifier names. Strict by default, like PMD. |
| `--ignore-literals` / `--no-ignore-literals` | Normalize or compare literals. Strict by default, like PMD. |
| `--pmd-typescript-compatibility` / `--no-…` | Match PMD `typescript` granularity for `.ts/.tsx` (split template literals into atoms, collapse regexp). On by default. |
| `--svelte-templates` / `--no-svelte-templates` | Tokenize `.svelte` markup, not just `<script>`. On by default. |
| `--vue-templates` / `--no-vue-templates` | Tokenize `.vue` markup, not just `<script>`. On by default. |
| `--angular-inline-templates` | Also scan Angular `@Component` inline templates. |
| `--skip-angular-inline-templates` | Do not scan inline Angular templates (explicit default). |
| `--fail-on-violation` | Exit with code `4` when duplications are found. |
| `-h, --help` | Show help. |
| `-V, --version` | Show version. |

Default extensions:

```text
.ts  .tsx  .js  .jsx  .mts  .cts  .mjs  .cjs  .vue  .svelte  .html  .htm
```

### Examples

```sh
# Strict, PMD‑like scan of a source tree, fail the build on any clone
clone-alert --minimum-tokens 30 --files src --fail-on-violation

# PMD‑style XML report across several paths
clone-alert --minimum-tokens 50 --format xml src test

# JSON report for a monorepo, excluding generated code
clone-alert --format json --files src,packages --exclude '**/generated/**'

# Find renamed clones by normalizing identifiers and literals
clone-alert --minimum-tokens 40 --ignore-identifiers --ignore-literals --files src
```

## PMD CPD compatibility

clone-alert targets PMD CPD‑style duplicate detection for the JavaScript/TypeScript ecosystem: `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, plus the frontend templates typical of TS projects. Verified compatibility currently covers:

- PMD JavaScript/TypeScript CPD tokenizer fixtures (vendored, so tests need no PMD checkout).
- The token‑based duplicate search, including `--ignore-identifiers`, `--ignore-literals`, and `CPD-OFF` / `CPD-ON` suppression markers.
- JSX/TSX tokenization and clone detection for React‑style components.
- Real npm layouts: `src/**/*.ts`, `src/**/*.tsx`, monorepo `packages/**`, and excluding generated files via `--exclude`.
- `text`, `json`, and `xml` reports: occurrence order, token counts, line ranges, and paths.

PMD compatibility mode is on by default: JS operators absent from PMD's ES5 JavaCC grammar are split into the same token stream (e.g. `=>` → `=` and `>`, `...` → `.` `.` `.`), and regexp literals collapse to a single token, just like PMD.

> **Note:** `--ignore-identifiers` in clone-alert really does normalize JS identifiers. In PMD's `ecmascript` lexer the same flag barely changes the token stream, so for a strict PMD‑JS comparison, leave it off.

## Frontend templates

For `.vue`, `.svelte`, and Angular HTML, clone-alert uses the optional peer packages `@vue/compiler-sfc`, `svelte`, and `@angular/compiler`. If a package isn't installed, matching files are skipped with a warning.

- **Vue** — binding and interpolation expressions (`{{ }}`, `:prop`, `v-if`, `@event`) are tokenized as TypeScript in the component scope, so a duplicated expression across `<template>` and `<script setup>` is caught too.
- **Svelte** — markup tokenization requires **Svelte 5+** (it relies on the modern `ast.fragment` AST). On Svelte 3/4 only `<script>` is scanned, silently and without errors.
- **Angular** — inline templates are **off by default** to keep TypeScript mode closer to PMD CPD. Enable `--angular-inline-templates` to scan them as a clone-alert extension.

Markup and code often want different thresholds (markup is noisy at a low `--minimum-tokens`), so the template layers sit behind toggles. Run two passes for the best of both:

```sh
# Code at a low threshold, markup at a high one (two runs)
clone-alert --minimum-tokens 40 --no-svelte-templates --files src
clone-alert --minimum-tokens 150 --files src
```

## Suppressing duplication

Wrap intentional or generated duplication in `CPD-OFF` / `CPD-ON` comments and it won't be reported:

```ts
// CPD-OFF
const generatedTableA = { /* ... */ };
const generatedTableB = { /* ... */ };
// CPD-ON
```

## Programmatic API

clone-alert ships with TypeScript types and a small Node API:

```ts
import { Cpd } from 'clone-alert';

const cpd = new Cpd({ minTileSize: 50 });
cpd.addPath('src/a.ts');
cpd.addPath('src/b.ts');

const matches = cpd.run();
console.log(cpd.report(matches));
```

## How it works

1. Each file is tokenized into a flat stream of lexical tokens (TypeScript scanner for code; framework compilers for Vue/Svelte/Angular markup).
2. Tokens are interned into a compact struct‑of‑arrays store backed by typed arrays.
3. A Karp–Rabin rolling hash plus a stable radix sort group candidate windows, and a PMD‑style collector reports the longest non‑overlapping matches.

Framework template tokens live in a separate namespace from script tokens, so markup never cross‑matches code by accident — while shared‑language expressions still do.

## Benchmarks

clone-alert is a drop-in for PMD CPD that runs **10–30× faster** on **1.4–2.5× less memory** — on the same files, finding the same clones.

Measured with [`npm run compare:pmd`](#development) on five real-world TypeScript codebases. Only pure `.ts` is compared (the exact file set PMD's `typescript` lexer can parse), so all tools see byte-identical input. macOS, Node 20, `--minimum-tokens 50`, JVM start-up counted for PMD as in real CLI use:

| Repository | clone-alert | PMD CPD | Speed‑up | Peak RAM (clone vs PMD) | Agreement with PMD¹ |
| --- | --- | --- | --- | --- | --- |
| `nestjs/nest` | **1.8 s** | 52.7 s | **30×** | 203 MB vs 500 MB (2.5× less) | 100% |
| `angular/components` | **1.5 s** | 42.5 s | **28×** | 338 MB vs 577 MB (1.7× less) | 95%² |
| `microsoft/playwright` | **9.3 s** | 153 s | **16×** | 838 MB vs 1.4 GB (1.7× less) | 99.98% |
| `vercel/next.js` | **5.8 s** | 73.4 s | **13×** | 1.3 GB vs 1.9 GB (1.4× less) | 99.2% |
| `nrwl/nx` | **8.6 s** | 84.1 s | **10×** | 2.1 GB vs 3.3 GB (1.6× less) | 99.9% |

<sub>¹ Jaccard overlap of the file pairs both tools flag as duplicated. ² `angular/components` ships ~20 near‑identical table demos sharing the same 398‑token block. clone-alert and PMD cut that clone's boundary **identically** (398, 391, 390, 210… tokens, token‑for‑token); they only disagree on *which* of the interchangeable demo files get grouped into the same `<duplication>` — a symmetric clustering tie‑break, not missed or mis‑sized duplication. On this small sample (~2 000 file pairs) that grouping noise is the whole 5%.</sub>

### Same tokens as PMD — verified, not approximated

The clone-alert TypeScript tokenizer is **identical to PMD's**, byte for byte. It is checked in CI against **PMD's own original tokenizer conformance fixtures** (vendored verbatim from the PMD repository): every token's image, line, and column must match PMD's golden output, element for element. clone-alert passes the full suite.

It earns that parity without reimplementing PMD's grammar: clone-alert lexes with the **real TypeScript compiler `Scanner`** — the same lexer `tsc` uses. PMD lexes TypeScript with a hand-maintained JavaCC grammar that trails the language. So clone-alert is **1:1 with PMD where PMD can lex, and still correct on modern syntax PMD's grammar can't** (`satisfies`, `using`, decorators, template‑literal types, newer operators).

### Where the numbers differ from PMD, and why

Because the tokens are identical and the match engine is a faithful port of PMD's `MatchCollector`, the residual differences are **never missed or invented duplication** — they live entirely in how identical matches are *bucketed*:

- **Grouping.** The same set of pairwise matches is occasionally packed into a different number of `<duplication>` groups (e.g. 30 vs 31 occurrences). Same clones, different bucketing; it nudges raw counts by ~2%.
- **Anchor jitter.** In hyper‑repetitive monorepo code (nx), a block repeated dozens of times can be anchored one line apart by each tool. Line‑exact that looks like a gap; by *which files share duplication* it's **99.9%**, and the divergence is **symmetric** (each tool has equally many "own" matches) — so it's reporting noise, not a detection error in either direction.

## Comparison

| | clone-alert | PMD CPD | jscpd |
| --- | --- | --- | --- |
| TS/JS/JSX/TSX | ✅ | ✅ | ✅ |
| Vue `<template>` markup | ✅ | ➖ | partial |
| Svelte markup | ✅ (Svelte 5+) | ➖ | ➖ |
| Angular templates | ✅ | ➖ | flat HTML only |
| PMD CPD algorithm parity | ✅ | — | ➖ |
| Install size | tiny (1 dep) | JVM required | npm package |

## Development

```sh
npm install
npm run build        # compile to dist/
npm test             # build + Vitest suite
npm run lint         # Biome + Knip + type‑check + self‑CPD
npm run compare:pmd -- /path/to/project --minimum-tokens 50
```

`npm run compare:pmd` runs PMD CPD, clone-alert, and jscpd on the same file tree and prints a JSON summary of time, peak RSS, duplicate counts, occurrences, and overlap. (jscpd is not a dependency; install it separately or pass `--jscpd <command>`.)

## Keywords

copy‑paste detector · duplicate code finder · code clone detection · CPD · PMD CPD alternative · jscpd alternative · TypeScript duplicate code · JavaScript duplicate code · JSX/TSX clones · Vue / Svelte / Angular duplication · DRY · static analysis · code quality · CI lint.

## License

[MIT](./LICENSE)
