# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/BaryshevRS/clone-alert/compare/clone-alert-v1.0.1...clone-alert-v1.1.0) (2026-06-28)


### Features

* add PMD ecmascript token compatibility ([8bbec20](https://github.com/BaryshevRS/clone-alert/commit/8bbec206e28b5f47676338850530f0d16c84d28c))
* **angular:** tokenize template binding expressions, extract into module ([a7c5da9](https://github.com/BaryshevRS/clone-alert/commit/a7c5da947b6f58db5ffdce5457b04d3bf3092b1d))
* **cli:** add --baseline to fail only on new clones ([7e79db5](https://github.com/BaryshevRS/clone-alert/commit/7e79db57715e1acf97926d38883f69b54c8455a6))
* **cli:** add --gitignore (on by default), extract file walk into files.ts ([7a24314](https://github.com/BaryshevRS/clone-alert/commit/7a243143139f9eddf907295ca1bc749489f6afd8))
* **cli:** add PMD-parity flags and default --fail-on-violation ([6458075](https://github.com/BaryshevRS/clone-alert/commit/6458075f699fec51bdf583d9618274e07a99c693))
* **cli:** add SARIF reporter for GitHub Code Scanning ([e860d38](https://github.com/BaryshevRS/clone-alert/commit/e860d382021e1db60ebdac15732636b55c36630c))
* PMD typescript template tokenization + SoA token store ([00500a3](https://github.com/BaryshevRS/clone-alert/commit/00500a387e3a860ed9f073f8394221152a79e4f2))
* **report:** add --format badge (SVG duplication badge to stdout) ([ee0552b](https://github.com/BaryshevRS/clone-alert/commit/ee0552bb05f9929fbc41fe05f5c7feda246c163a))
* **report:** add duplication stats + compact ai format ([2e01a05](https://github.com/BaryshevRS/clone-alert/commit/2e01a059ec65932d5cb90d2a5a55008077bc64d0))
* **report:** embed duplicated code in xml, json, and a new markdown format ([7aef60d](https://github.com/BaryshevRS/clone-alert/commit/7aef60dd75fa8e74c5595f7ffa945f65da7d1c79))
* **report:** marketing badge scale + dogfood it in the README ([f321857](https://github.com/BaryshevRS/clone-alert/commit/f3218573f1dfd6c9c470bc79fef404a63fbb46b8))
* **report:** replace --format badge with --format shields (endpoint JSON) ([b3caeac](https://github.com/BaryshevRS/clone-alert/commit/b3caeace58605e263429873f9f235e8e91806185))
* resolve optional template compilers from analyzed project ([8538e9c](https://github.com/BaryshevRS/clone-alert/commit/8538e9c0d1d4b9cc9dee6e212469131229d77078))
* **svelte:** add --svelte-templates toggle; document svelte 5+ requirement ([184a8b1](https://github.com/BaryshevRS/clone-alert/commit/184a8b1599e45ca49eda5e929a9ba65fd56a877b))
* **svelte:** tokenize template markup, not just &lt;script&gt; ([1ed9d8f](https://github.com/BaryshevRS/clone-alert/commit/1ed9d8f92f9b7539add4081760d83072cd301a65))
* **vue:** tokenize template markup, extract into module ([b7f942d](https://github.com/BaryshevRS/clone-alert/commit/b7f942ddd2b9e4d83d7ac4c46ba5b4470f2c346b))


### Bug Fixes

* **action:** shorten description under Marketplace 125-char limit ([13be88e](https://github.com/BaryshevRS/clone-alert/commit/13be88e3a9d6c528ab91acf1c691e53b8896fb34))
* collapse regexp literals in PMD mode ([6936cad](https://github.com/BaryshevRS/clone-alert/commit/6936cad239199370030287a7df6b855be127a8fb))
* **test:** match action.yml default in single or double quotes; badges on one line ([2023bd4](https://github.com/BaryshevRS/clone-alert/commit/2023bd4059c800f0e53a1a64f0b236b8418cae22))


### Performance Improvements

* **core:** inline matchEnded into the hot scan loop ([7f8b21d](https://github.com/BaryshevRS/clone-alert/commit/7f8b21d4be698677aa0101333b684aa57e7ac957))
* drop full AST parse in tokenizer, use bare line-map ([8c9aeed](https://github.com/BaryshevRS/clone-alert/commit/8c9aeedb25165e49ebf12725ba0122fde4094cdd))
* memoize Match.marks to kill repeated sort in reportMatch ([8afaa76](https://github.com/BaryshevRS/clone-alert/commit/8afaa765d5794756f0c583ea0dec19b4cedb5b77))
* replace comparator group-sort with LSD radix sort ([40709c5](https://github.com/BaryshevRS/clone-alert/commit/40709c542cc648e4b359680997c0ad001807c3f1))

## [1.0.0] - 2026-06-27

First stable release. The public API (the `Cpd` class) and the CLI flags are now
considered stable and follow Semantic Versioning.

### Added

- Official **GitHub Marketplace Action** (`uses: BaryshevRS/clone-alert@v1`): a
  composite action that runs the detector, uploads a SARIF report to GitHub Code
  Scanning (annotations appear inline in the PR diff), and fails the job on
  duplicates. Inputs for `paths`, `minimum-tokens`, `extensions`, `exclude`, and
  `fail-on-violation`.
- CI infrastructure: lint + test workflow, a workflow that publishes the live
  duplication badge to `main`, and a code-scanning workflow that dogfoods the
  action on this repo.

## [0.4.0] - 2026-06-25

### Added

- `--baseline <path>` / `--update-baseline`: suppress already-accepted clones and
  fail only on newly introduced ones. Matching is by content fingerprint, so
  accepted duplications stay suppressed even after the code moves.
- `--format sarif`: SARIF 2.1.0 reporter for GitHub Code Scanning
  (`github/codeql-action/upload-sarif`), one result per duplication with the
  other occurrences as related locations.
- `--format markdown`: fenced-code report that embeds each duplicated fragment;
  `xml` and `json` now embed the duplicated code too (PMD's `<codefragment>` and
  a jscpd-style `fragment` field).
- `--format ai`: compact, token-frugal listing of duplications for LLM pipelines.
- `--format shields`: prints a [shields.io endpoint](https://shields.io/badges/endpoint-badge)
  JSON for a duplication badge, with a color scale tuned to reward near-zero
  duplication. Dogfooded in the README via a live endpoint badge.
- Duplication summary footer (`N clones · X% duplicated lines`) on `text` and
  `ai` output.
- `--gitignore` (on by default) skips files ignored by `.gitignore` within the
  git repo; `--no-gitignore` scans them anyway.
- PMD-parity CLI flags, including `--minimum-tile-size` (alias for
  `--minimum-tokens`), `--exclude`, `--non-recursive`, `--file-list`,
  `--skip-duplicate-files`, and `--skip-lexical-errors`.

### Changed

- `--fail-on-violation` is now the default: clone-alert exits with code `4` when
  duplications are found. Use `--no-fail-on-violation` to always exit `0`.

### Performance

- Inlined `matchEnded` into the hot scan loop in the core match engine
  (byte-identical output).

### Docs

- Refreshed benchmark numbers (10–27× faster than PMD, 1.3–2.6× less memory).
