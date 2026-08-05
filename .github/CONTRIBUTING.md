# Contributing to clone-alert

Thanks for helping out! This is a copy-paste detector that ports **PMD CPD** to
the JS/TS ecosystem. The guiding rule: **PMD CPD is the etalon** — any divergence
from PMD's token stream or match output is treated as a bug to fix toward PMD,
not a design choice.

## Setup

Requires Node.js 18+ (CI runs on 24).

```sh
pnpm install       # also installs the commit-msg hook via simple-git-hooks
pnpm run build     # tsc -> dist/ (the CLI is dist/cli.js)
pnpm test          # builds, then runs the full vitest suite
```

Tests import from `dist/`, so **rebuild (`pnpm run build`) before running vitest
directly** after editing `src/`. The `pnpm test` script already chains the build.

## Useful commands

```sh
pnpm run lint          # biome --write + StopSlop + tsc --noEmit (both tsconfigs)
pnpm run check         # biome check only (read-only; this is what the publish gate runs)
pnpm run check-types   # tsc --noEmit for both tsconfigs
pnpm run build && pnpm exec vitest run test/<file>.test.ts   # a single test file
```

The lint pipeline includes a **self-CPD pass**: large copy-paste inside `src/`
fails the build.

## Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/)
— they are validated by commitlint (a `commit-msg` hook installed on
`pnpm install`) and drive automated releases and the changelog:

- `feat:` → minor release · `fix:` → patch · `feat!:` / `BREAKING CHANGE:` → major
- `docs:`, `ci:`, `chore:`, `refactor:`, `test:`, `perf:` → no release

Example: `feat(vue): tokenize scoped slots`.

## Project layout

- `src/core.ts` — language-agnostic match engine (the PMD algorithm port).
- `src/tokenizers.ts` — TS/JS tokenizer + shared helpers.
- `src/angular.ts` / `src/vue.ts` / `src/svelte.ts` — framework template tokenizers.
- `src/cli.ts` — arg/config parser, file walker, reporters.
- `test/` — vitest suite, anchored to PMD parity (golden fixtures under
  `test/fixtures/pmd/**`).

## Pull requests

Open a PR against `main`. Make sure `pnpm test` and `pnpm run lint` pass, add tests
for your change, and keep the PR title in Conventional Commit form. If your change
could affect parity with PMD, please note how you verified it.
