# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
