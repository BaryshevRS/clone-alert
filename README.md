# clone-alert

> Fast **copy‑paste detector** for **TypeScript**, **JavaScript**, **JSX/TSX**, **Vue**, **Svelte** and **Angular** — a **PMD CPD‑compatible** duplicate‑code finder you can drop into any project or CI pipeline.

[![CI](https://github.com/BaryshevRS/clone-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/BaryshevRS/clone-alert/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/clone-alert.svg)](https://www.npmjs.com/package/clone-alert) [![license](https://img.shields.io/npm/l/clone-alert.svg)](./LICENSE) [![node](https://img.shields.io/node/v/clone-alert.svg)](https://nodejs.org) [![types](https://img.shields.io/npm/types/clone-alert.svg)](https://www.npmjs.com/package/clone-alert) [![clone-alert](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/BaryshevRS/clone-alert/main/clone-alert-badge.json)](#duplication-badge)

**clone-alert** finds duplicated and copy‑pasted code across your codebase by comparing **token streams** — the same proven approach as [PMD CPD](https://pmd.github.io/) (Copy‑Paste Detector), but built natively for the JavaScript/TypeScript ecosystem and your frontend templates. Catch code clones, enforce **DRY**, reduce technical debt, and fail your build when duplication creeps in.

```sh
npx clone-alert --minimum-tokens 50 --files src
```

---

## Why clone-alert?

- 🎯 **PMD CPD‑compatible** — a faithful port of PMD's match algorithm and JavaScript/TypeScript tokenizers, validated against PMD's own golden fixtures.
- ⚡ **Fast on large monorepos** — a struct‑of‑arrays token core with a Karp–Rabin rolling hash and radix‑sorted buckets. In our [benchmarks](#benchmarks) it runs **10–27× faster** than PMD CPD while using **1.3–2.6× less memory**, on real codebases from Next.js to nx.
- 🧩 **Frontend templates, natively** — tokenizes **Vue** `<template>`, **Svelte** markup, and **Angular** templates, not just `<script>` blocks. Detects template‑to‑script duplication too.
- 🧪 **Zero‑config CLI** — sensible defaults, recursive directory scan, `node_modules`/`.git`/`dist` skipped automatically.
- 📦 **Tiny footprint** — a single runtime dependency (`typescript`). Framework parsers are **optional peer dependencies**, loaded only when needed.
- 🛠 **CI‑ready** — `text`, `json`, PMD‑style `xml` / `csv`, and **SARIF** (GitHub Code Scanning) reports; fails the build on duplication by default (exit code `4`), like PMD CPD.
- 📉 **Baseline for adoption** — accept the clones an existing project already has and fail CI only on **new** ones. Fingerprints are content‑based, so the baseline survives code moving around.
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
# Scan a folder and print a human‑readable report.
# Like PMD CPD, this exits 4 when duplication is found — so it fails CI out of the box.
clone-alert --minimum-tokens 50 --files src

# Just want the report, never a failing exit code? Opt out:
clone-alert --minimum-tokens 50 --files src --no-fail-on-violation

# Machine‑readable output for dashboards (don't fail the job that builds the artifact)
clone-alert --format json --files src,packages --no-fail-on-violation > duplication.json

# Adopt an existing project: accept today's clones, fail only on new ones
clone-alert --files src --baseline .clone-alert-baseline.json --update-baseline
clone-alert --files src --baseline .clone-alert-baseline.json --fail-on-violation
```

## Usage

```sh
clone-alert [options] [<path>...]
```

### CLI options

| Option | Description |
| --- | --- |
| `--files <path[,path...]>` | Files or directories to scan. Can be repeated. |
| `--file-list <path>` | Read newline-separated paths to scan from a file. |
| `--minimum-tokens <n>` | Minimum duplicated token span. Default: `50`. |
| `--minimum-tile-size <n>` | Alias for `--minimum-tokens`. |
| `--format <fmt>` | `text` (default), `xml`, `json`, `sarif`, `csv`, `csv_with_linecount_per_file`, `markdown`, `ai`. `sarif` targets GitHub Code Scanning; the two `csv` formats mirror PMD's CSV renderers. `xml`/`json`/`markdown` embed the duplicated code (PMD's `<codefragment>`, a jscpd-style `fragment` field, and a fenced code block respectively). `ai` is a compact, token-frugal listing for LLM pipelines. `shields` prints a [shields.io endpoint](#duplication-badge) JSON for a duplication badge. `text` and `ai` end with a `N clones · X% duplicated lines` summary. |
| `--extensions <ext[,ext...]>` | Extensions to include during recursive scans. |
| `--exclude <glob[,glob...]>` | Exclude files or directories (glob). Can be repeated. Prunes the walk, not a post-filter — excluded directories are never read. |
| `--non-recursive` | Scan only the top level of each directory. |
| `--gitignore` / `--no-gitignore` | Skip files ignored by `.gitignore` (nested files and the repo-root file honored). On by default. |
| `--skip-duplicate-files` | Skip files with the same name and byte length (PMD parity). |
| `--skip-lexical-errors` | Skip files that fail to tokenize instead of aborting the whole run. |
| `--ignore-identifiers` / `--no-ignore-identifiers` | Normalize or compare identifier names. Strict by default, like PMD. |
| `--ignore-literals` / `--no-ignore-literals` | Normalize or compare literals. Strict by default, like PMD. |
| `--pmd-typescript-compatibility` / `--no-…` | Match PMD `typescript` granularity for `.ts/.tsx` (split template literals into atoms, collapse regexp). On by default. |
| `--svelte-templates` / `--no-svelte-templates` | Tokenize `.svelte` markup, not just `<script>`. On by default. |
| `--vue-templates` / `--no-vue-templates` | Tokenize `.vue` markup, not just `<script>`. On by default. |
| `--angular-inline-templates` | Also scan Angular `@Component` inline templates. |
| `--skip-angular-inline-templates` | Do not scan inline Angular templates (explicit default). |
| `--fail-on-violation` / `--no-fail-on-violation` | Exit with code `4` when duplications are found. **On by default**, like PMD CPD; pass `--no-fail-on-violation` to always exit `0`. |
| `--baseline <path>` | Ignore duplications recorded in this baseline file; report and fail only on **new** ones. Matched by content fingerprint, so accepted clones stay suppressed even after the code moves. |
| `--update-baseline` | Write/regenerate the baseline file at `--baseline` with all current duplications, then exit `0`. Run once to adopt existing debt. |
| `--config <path>` | Read options from a JSON config file. Default: `clone-alert.config.json` in the current directory, if present. |
| `--no-config` | Ignore any `clone-alert.config.json`. |
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

### Configuration file

Instead of repeating flags on every run (and across CI, the GitHub Action, and
local scripts), commit a `clone-alert.config.json` to the project root. It is
picked up automatically from the current directory:

```json
{
  "paths": ["src"],
  "minimumTokens": 70,
  "extensions": ["ts", "tsx", "vue"],
  "exclude": ["**/*.spec.ts", "**/generated/**"],
  "vueTemplates": false
}
```

```sh
clone-alert                      # uses clone-alert.config.json
clone-alert --format json        # CLI flags win over the config
clone-alert --config ci.json     # read a specific file
clone-alert --no-config          # ignore the config entirely
```

- **Keys** mirror the CLI options in camelCase: `paths`, `extensions`,
  `exclude`, `minimumTokens`, `format`, `failOnViolation`, `gitignore`,
  `nonRecursive`, `skipDuplicateFiles`, `skipLexicalErrors`, `ignoreIdentifiers`,
  `ignoreLiterals`, `pmdTypescriptCompatibility`, `svelteTemplates`,
  `vueTemplates`, `angularInlineTemplates`, `baseline`. All are optional.
- **Precedence** is `CLI flag > config file > built-in default`.
- `extensions` **replaces** the default set; `exclude` is **added** to any
  `--exclude` flags; positional CLI paths **replace** the config's `paths`.
- Unknown keys and wrong value types are reported as errors, so typos surface
  immediately.

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

## Baseline (adopting an existing project)

A fresh project can have thousands of pre‑existing clones — enough to light up CI red on day one. A **baseline** lets you accept that debt and gate only on what's added afterwards.

Generate it once, commit it, then check against it in CI:

```sh
# 1. Record today's duplications (writes the file, exits 0)
clone-alert --files src --baseline .clone-alert-baseline.json --update-baseline

# 2. In CI: fail only on clones not in the baseline
clone-alert --files src --baseline .clone-alert-baseline.json --fail-on-violation
```

The baseline is a small, sorted JSON file you commit and review in pull requests:

```json
{
  "version": 1,
  "clones": [
    {
      "fingerprint": "00a034a93cd6e7e3",
      "tokens": 414,
      "files": ["src/server/webkit/webview/wvPage.ts", "src/server/webkit/wkPage.ts"]
    }
  ]
}
```

Each clone is matched by a **content fingerprint** hashed over its tokens only — no line numbers, no file paths. So a baselined clone stays suppressed when the code is moved, reformatted, or shifted by edits above it, and the file produces a stable, churn‑free diff. Introduce a genuinely new duplication and CI fails on that one alone. Re‑run `--update-baseline` to re‑adopt after an intentional change.

> The baseline filters the already‑computed match set, so it adds no measurable cost to a scan — there's no separate cache to persist between CI runs.

## GitHub Code Scanning (SARIF)

`--format sarif` emits a SARIF 2.1.0 log that GitHub ingests as code‑scanning alerts, shown inline in pull requests and in the repository's Security tab. Each duplication's stable content fingerprint is written to `partialFingerprints`, so GitHub tracks an alert across commits and **does not re‑raise it when the clone simply moves**. Artifact URIs are relative to the working directory, so they map onto the checked‑out tree.

### Use the GitHub Action

The quickest way — one step, SARIF uploaded for you:

```yaml
# .github/workflows/clone-alert.yml
name: clone-alert
on: [push, pull_request]
jobs:
  duplication:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write   # required to upload SARIF
    steps:
      - uses: actions/checkout@v4
      - uses: BaryshevRS/clone-alert@v1
        with:
          paths: src
          minimum-tokens: 100
          # fail-on-violation: false   # report-only: surface clones as alerts, don't fail the job
```

> [!IMPORTANT]
> **The `permissions:` block is required.** GitHub Actions grants a job no
> permissions by default, so without it the SARIF upload fails. You need:
> - `security-events: write` — to upload the SARIF report to Code Scanning (the only line that's strictly required);
> - `contents: read` — to let `actions/checkout` read your code.
>
> If you only want a pass/fail gate and **no** Code Scanning alerts, set
> `upload-sarif: false` and you can drop `security-events: write`.

**Inputs** (all optional): `paths` (default `.`), `minimum-tokens` (`100`), `extensions`, `exclude`,
`fail-on-violation` (`true`), `upload-sarif` (`true`), `sarif-file` (`clone-alert.sarif`),
`category` (`clone-alert`), `version` (`latest`), `working-directory` (`.`).
**Outputs:** `exit-code` (`0` clean / `4` duplicates found), `sarif-file`.

### Or wire it up manually

```yaml
# .github/workflows/clone-alert.yml
name: clone-alert
on: [push, pull_request]
jobs:
  duplication:
    runs-on: ubuntu-latest
    permissions:
      security-events: write   # required to upload SARIF
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      # --no-fail-on-violation so the step exits 0 and the SARIF still uploads;
      # GitHub surfaces the duplications as code-scanning alerts instead.
      - run: npx clone-alert src --format sarif --no-fail-on-violation > clone-alert.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: clone-alert.sarif
```

Combine it with a committed `--baseline` to surface only the duplications added after adoption.

## Duplication badge

Show off how clean your codebase is with a [shields.io](https://shields.io/badges/endpoint-badge) badge. `--format shields` prints a shields **endpoint JSON** to stdout — host it (a committed file, a gist, anywhere reachable) and point shields at it:

```sh
clone-alert src --minimum-tokens 70 --format shields --no-fail-on-violation > clone-alert-badge.json
```

```md
[![clone-alert](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OWNER/REPO/main/clone-alert-badge.json)](https://github.com/BaryshevRS/clone-alert)
```

shields fetches the JSON and renders the badge, so it refreshes whenever you regenerate the file. The color comes from a fixed scale, tuned to reward near‑zero duplication:

| Result | Color | |
| --- | --- | --- |
| **0 clones** | 🟢 bright green | the flex — zero copy‑paste |
| **≤ 3%** | 🟢 green | clean |
| **≤ 10%** | 🟡 yellow | has some debt |
| **> 10%** | 🔴 red | needs attention |

The percentage is `duplicated lines / total scanned lines`, so it tracks your chosen `--minimum-tokens` (and which files you scan — exclude `**/*.test.*` and fixtures to badge production code only). Regenerate it in CI to keep it fresh:

```yaml
      - run: npx clone-alert src --minimum-tokens 70 --format shields --no-fail-on-violation > clone-alert-badge.json
      # then commit the file (or push it to a gist) so shields serves the latest value
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

clone-alert is a drop-in for PMD CPD that runs **10–27× faster** on **1.3–2.6× less memory** — on the same files, finding the same clones.

Measured with [`npm run compare:pmd`](#development) on five real-world TypeScript codebases. Only pure `.ts` is compared (the exact file set PMD's `typescript` lexer can parse), so all tools see byte-identical input. macOS, Node 20, `--minimum-tokens 50`, JVM start-up counted for PMD as in real CLI use:

| Repository | clone-alert | PMD CPD | Speed‑up | Peak RAM (clone vs PMD) | Agreement with PMD¹ |
| --- | --- | --- | --- | --- | --- |
| `nestjs/nest` | **0.7 s** | 15.4 s | **23×** | 203 MB vs 526 MB (2.6× less) | 100% |
| `angular/components` | **1.6 s** | 41.9 s | **27×** | 338 MB vs 632 MB (1.9× less) | 95%² |
| `microsoft/playwright` | **3.6 s** | 58.7 s | **16×** | 836 MB vs 1.6 GB (1.9× less) | 99.98% |
| `vercel/next.js` | **6.0 s** | 73.6 s | **12×** | 1.3 GB vs 1.7 GB (1.3× less) | 99.2% |
| `nrwl/nx` | **8.1 s** | 83.2 s | **10×** | 2.1 GB vs 3.2 GB (1.5× less) | 99.9% |

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
| CI baseline (fail only on new) | ✅ committed fingerprint file | ➖ | ⚠️ via on‑disk cache¹ |
| SARIF / GitHub Code Scanning | ✅ | ➖ | ✅ |
| Report formats | text, xml, json, sarif, csv, markdown, ai, shields | text, xml, csv, vs | many |
| PMD CLI flags (`--file-list`, `--non-recursive`, `--skip-duplicate-files`, `--skip-lexical-errors`) | ✅ | ✅ | ➖ |
| `.gitignore` aware | ✅ (on by default, prunes walk) | ➖ | ✅ |
| Install size | tiny (1 dep) | JVM required | npm package |

¹ jscpd derives "new vs known" from a persistent store (LevelDB) that you must keep between runs; clone-alert commits a small, reviewable JSON baseline and stays stateless.

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
