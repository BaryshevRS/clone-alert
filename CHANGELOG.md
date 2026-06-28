# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
