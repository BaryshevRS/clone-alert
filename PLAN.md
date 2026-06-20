# JS/TS CPD Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Bring the JS/TS duplicate-detection behavior closer to PMD CPD by expanding vendored fixtures, option coverage, JSX/TSX coverage, real npm-project scenarios, and end-to-end report comparisons.

**Architecture:** Keep PMD-derived golden data under `test/fixtures/pmd/**` and keep it excluded from formatting/typechecking. Put PMD fixture parsing in `test/helpers/pmd-fixtures.ts`; keep tokenizer expectations in tokenizer tests, matching expectations in algorithm tests, and CLI/report expectations in CLI compatibility tests.

**Tech Stack:** TypeScript 6, Node.js ESM, Vitest, Biome, Knip, vendored PMD CPD JavaScript/TypeScript fixtures.

---

## File Map

- Modify: `test/helpers/pmd-fixtures.ts`
  - Add discovery helpers for all vendored JS/TS PMD CPD fixture pairs.
  - Add support markers so unsupported fixtures fail intentionally with a named reason instead of disappearing silently.
- Modify: `test/pmd-tokenizer-fixtures.test.ts`
  - Cover every supported PMD JS/TS tokenizer fixture pair.
  - Assert unsupported fixture names are listed explicitly.
- Modify: `test/pmd-match-algorithm.test.ts`
  - Add duplicate-search option tests for `ignoreIdentifiers`, `ignoreLiterals`, and `CPD-OFF/CPD-ON`.
- Create: `test/pmd-jsx-tsx.test.ts`
  - Add JSX and TSX tokenizer/report tests that reflect real React/TS usage.
- Create: `test/pmd-project-scenarios.test.ts`
  - Add real npm-project CLI scenarios: glob-style directory scans, generated-file ignores, and monorepo packages.
- Modify: `test/pmd-cli-compat.test.ts`
  - Compare final duplicate reports in `text`, `json`, and `xml`, including order, token count, line ranges, and file paths.
- Modify as needed: `src/tokenizers.ts`
  - Fix tokenizer behavior only when a failing golden/edge test proves a mismatch.
- Modify as needed: `src/core.ts`
  - Fix duplicate matching behavior only when a failing matching/report test proves a mismatch.
- Modify as needed: `src/cli.ts`
  - Fix CLI option/report behavior only when an end-to-end test proves a mismatch.
- Modify: `README.md`
  - Document the supported JS/TS compatibility scope and the fixture policy.

---

### Task 1: Inventory All PMD JS/TS CPD Fixtures

**Files:**
- Modify: `test/helpers/pmd-fixtures.ts`
- Modify: `test/pmd-tokenizer-fixtures.test.ts`
- Modify: `test/fixtures/pmd/README.md`

- [x] **Step 1: Inspect vendored fixture coverage**

Run:

```bash
find test/fixtures/pmd/pmd-javascript/src/test/resources/net/sourceforge/pmd/lang -path '*cpd/testdata*' -type f | sort
```

Expected: the command lists every vendored `.js`, `.ts`, `.txt`, and nested `ts/*` fixture.

- [x] **Step 2: Add explicit fixture support metadata**

In `test/helpers/pmd-fixtures.ts`, add:

```ts
export interface PmdFixtureCase {
  name: string;
  sourcePath: string;
  expectedPath: string;
  supported: boolean;
  reason?: string;
}

export const UNSUPPORTED_PMD_FIXTURES: Record<string, string> = {
  // Add exact fixture names here only when a test proves the current clone cannot
  // match PMD behavior yet. Each reason must name the missing behavior.
};
```

- [x] **Step 3: Generate fixture pairs from disk**

In `test/helpers/pmd-fixtures.ts`, add a helper that pairs each source file with its `.txt` token dump:

```ts
export function discoverPmdFixtureCases(): PmdFixtureCase[] {
  const pairs = discoverPmdTokenFixtures();
  return pairs.map((fixture) => {
    const reason = UNSUPPORTED_PMD_FIXTURES[fixture.name];
    return {
      name: fixture.name,
      sourcePath: fixture.sourcePath,
      expectedPath: fixture.expectedPath,
      supported: reason === undefined,
      reason,
    };
  });
}
```

- [x] **Step 4: Update tokenizer test to use discovered supported fixtures**

In `test/pmd-tokenizer-fixtures.test.ts`, replace hardcoded fixture names with:

```ts
const fixtureCases = discoverPmdFixtureCases();
const supportedCases = fixtureCases.filter((fixture) => fixture.supported);
const unsupportedCases = fixtureCases.filter((fixture) => !fixture.supported);

describe('PMD JavaScript/TypeScript tokenizer fixtures', () => {
  test.each(supportedCases)('$name matches PMD token dump', (fixture) => {
    expectTokenizerFixtureToMatchPmd(fixture);
  });

  it('documents every unsupported PMD fixture explicitly', () => {
    expect(unsupportedCases).toEqual(
      unsupportedCases.map((fixture) =>
        expect.objectContaining({
          name: expect.any(String),
          reason: expect.stringMatching(/\S/),
        })
      )
    );
  });
});
```

- [x] **Step 5: Run the focused tokenizer suite**

Run:

```bash
npm test -- test/pmd-tokenizer-fixtures.test.ts
```

Expected: all supported fixture tests pass; unsupported fixtures are visible in the test output only if intentionally marked.

- [x] **Step 6: Commit**

```bash
git add test/helpers/pmd-fixtures.ts test/pmd-tokenizer-fixtures.test.ts test/fixtures/pmd/README.md
git commit -m "Expand PMD JS TS fixture inventory"
```

---

### Task 2: Add Option Behavior Tests

**Files:**
- Modify: `test/pmd-match-algorithm.test.ts`
- Modify as needed: `src/tokenizers.ts`
- Modify as needed: `src/core.ts`

- [x] **Step 1: Add failing tests for identifier normalization**

In `test/pmd-match-algorithm.test.ts`, add a test that proves same structure with renamed identifiers matches when `ignoreIdentifiers` is enabled and does not match when disabled:

```ts
it('matches renamed code only when ignoreIdentifiers is enabled', () => {
  const left = 'function alpha(value: number) { return value + 1; }';
  const right = 'function beta(input: number) { return input + 1; }';

  const normalized = detectClonesFromSources([left, right], {
    minimumTokens: 8,
    ignoreIdentifiers: true,
    ignoreLiterals: false,
  });
  const strict = detectClonesFromSources([left, right], {
    minimumTokens: 8,
    ignoreIdentifiers: false,
    ignoreLiterals: false,
  });

  expect(normalized).toHaveLength(1);
  expect(strict).toHaveLength(0);
});
```

- [x] **Step 2: Add failing tests for literal normalization**

Add:

```ts
it('matches changed literals only when ignoreLiterals is enabled', () => {
  const left = 'const config = { retries: 2, url: "https://one.example" };';
  const right = 'const config = { retries: 5, url: "https://two.example" };';

  const normalized = detectClonesFromSources([left, right], {
    minimumTokens: 10,
    ignoreIdentifiers: false,
    ignoreLiterals: true,
  });
  const strict = detectClonesFromSources([left, right], {
    minimumTokens: 10,
    ignoreIdentifiers: false,
    ignoreLiterals: false,
  });

  expect(normalized).toHaveLength(1);
  expect(strict).toHaveLength(0);
});
```

- [x] **Step 3: Add failing tests for CPD suppression markers**

Add:

```ts
it('does not report duplicates inside CPD-OFF and CPD-ON regions', () => {
  const source = `
    // CPD-OFF
    export function repeatedOne() { return 1 + 2 + 3 + 4; }
    export function repeatedTwo() { return 1 + 2 + 3 + 4; }
    // CPD-ON
    export function unique() { return 9; }
  `;

  const matches = detectClonesFromSources([source], {
    minimumTokens: 8,
    ignoreIdentifiers: true,
    ignoreLiterals: true,
  });

  expect(matches).toHaveLength(0);
});
```

- [x] **Step 4: Run the focused matching suite**

Run:

```bash
npm test -- test/pmd-match-algorithm.test.ts
```

Expected before fixes: new tests fail only if current behavior is mismatched. Expected after fixes: all matching tests pass.

- [x] **Step 5: Implement the minimum behavior changes**

If tests fail, adjust only `src/tokenizers.ts` or `src/core.ts`:

```ts
// Keep option handling in tokenization, not in report formatting.
const tokens = tokenizeTypeScript(filePath, source, {
  ignoreIdentifiers: options.ignoreIdentifiers,
  ignoreLiterals: options.ignoreLiterals,
});
```

- [x] **Step 6: Run checks and commit**

```bash
npm test -- test/pmd-match-algorithm.test.ts
npm run lint
git add src/tokenizers.ts src/core.ts test/pmd-match-algorithm.test.ts
git commit -m "Cover CPD normalization options"
```

---

### Task 3: Add JSX and TSX Coverage

**Files:**
- Create: `test/pmd-jsx-tsx.test.ts`
- Modify as needed: `src/tokenizers.ts`
- Modify as needed: `src/cli.ts`

- [x] **Step 1: Add JSX tokenizer tests**

Create `test/pmd-jsx-tsx.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { tokenizeTypeScript } from '../src/tokenizers';

describe('JSX and TSX tokenization', () => {
  it('tokenizes JSX text and expressions without dropping structural tokens', () => {
    const source = 'export const View = () => <section><h1>{title}</h1><p>Hello</p></section>;';
    const images = tokenizeTypeScript('View.jsx', source, { ignoreIdentifiers: false, ignoreLiterals: false }, ts.ScriptKind.JSX).map(
      (token) => token.image
    );

    expect(images).toContain('<');
    expect(images).toContain('section');
    expect(images).toContain('title');
    expect(images).toContain('Hello');
  });
});
```

- [x] **Step 2: Add TSX duplicate detection test**

In the same file, add a CLI or core-level test with two similar React components:

```ts
it('detects duplicate TSX component structure', () => {
  const first = 'export function A({title}: {title: string}) { return <Card><h2>{title}</h2><Button /></Card>; }';
  const second = 'export function B({label}: {label: string}) { return <Card><h2>{label}</h2><Button /></Card>; }';

  const firstTokens = tokenizeTypeScript('A.tsx', first, { ignoreIdentifiers: true, ignoreLiterals: true }, ts.ScriptKind.TSX);
  const secondTokens = tokenizeTypeScript('B.tsx', second, { ignoreIdentifiers: true, ignoreLiterals: true }, ts.ScriptKind.TSX);

  expect(firstTokens.length).toBeGreaterThan(10);
  expect(secondTokens.length).toBeGreaterThan(10);
  expect(firstTokens.map((token) => token.image)).toEqual(secondTokens.map((token) => token.image));
});
```

- [x] **Step 3: Run the focused JSX/TSX suite**

```bash
npm test -- test/pmd-jsx-tsx.test.ts
```

Expected: tests pass after tokenizer fixes; failures must identify exact JSX tokenization mismatch.

- [x] **Step 4: Run full tests and commit**

```bash
npm test
npm run lint
git add src/tokenizers.ts src/cli.ts test/pmd-jsx-tsx.test.ts
git commit -m "Add JSX TSX CPD coverage"
```

---

### Task 4: Add Real npm Project Scenarios

**Files:**
- Create: `test/pmd-project-scenarios.test.ts`
- Modify as needed: `src/cli.ts`
- Modify: `README.md`

- [x] **Step 1: Add temporary project fixture helpers**

Create `test/pmd-project-scenarios.test.ts` with helpers that build temp project trees through Node APIs:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'clone-alert-project-'));
}
```

- [x] **Step 2: Add monorepo package scan test**

Add:

```ts
it('scans duplicate TypeScript across monorepo packages', async () => {
  const root = await makeProject();
  await mkdir(join(root, 'packages/a/src'), { recursive: true });
  await mkdir(join(root, 'packages/b/src'), { recursive: true });
  await writeFile(join(root, 'packages/a/src/index.ts'), 'export function alpha(x: number) { const y = x + 1; return y * y; }');
  await writeFile(join(root, 'packages/b/src/index.ts'), 'export function beta(x: number) { const y = x + 1; return y * y; }');

  const { stdout } = await execFileAsync('node', [
    'dist/cli.js',
    '--minimum-tokens',
    '10',
    '--files',
    join(root, 'packages'),
    '--extensions',
    'ts',
    '--format',
    'json',
  ]);

  const report = JSON.parse(stdout);
  expect(report.duplicates).toHaveLength(1);
  expect(report.duplicates[0].files.map((file: { path: string }) => file.path).sort()).toEqual([
    join(root, 'packages/a/src/index.ts'),
    join(root, 'packages/b/src/index.ts'),
  ]);
});
```

- [x] **Step 3: Add generated-file ignore scenario**

Add a test for the project ignore mechanism that already exists in the CLI. If there is no ignore option yet, add `--exclude` to `src/cli.ts` first and test it here:

```ts
it('excludes generated files from duplicate detection', async () => {
  const root = await makeProject();
  await mkdir(join(root, 'src/generated'), { recursive: true });
  await mkdir(join(root, 'src/manual'), { recursive: true });
  await writeFile(join(root, 'src/generated/client.ts'), 'export function generated() { return "same" + "same" + "same"; }');
  await writeFile(join(root, 'src/manual/client.ts'), 'export function manual() { return "same" + "same" + "same"; }');

  const { stdout } = await execFileAsync('node', [
    'dist/cli.js',
    '--minimum-tokens',
    '8',
    '--files',
    join(root, 'src'),
    '--extensions',
    'ts',
    '--exclude',
    '**/generated/**',
    '--format',
    'json',
  ]);

  expect(JSON.parse(stdout).duplicates).toHaveLength(0);
});
```

- [x] **Step 4: Run project scenario tests**

```bash
npm run build
npm test -- test/pmd-project-scenarios.test.ts
```

Expected: project scenario tests pass; if `--exclude` did not exist before, README documents it.

- [x] **Step 5: Commit**

```bash
git add src/cli.ts README.md test/pmd-project-scenarios.test.ts
git commit -m "Add npm project CPD scenarios"
```

---

### Task 5: Compare Final Duplicate Reports

**Files:**
- Modify: `test/pmd-cli-compat.test.ts`
- Modify as needed: `src/cli.ts`
- Modify as needed: `src/core.ts`

- [x] **Step 1: Add deterministic duplicate fixture**

In `test/pmd-cli-compat.test.ts`, add a temp directory fixture with two files whose duplicate boundaries are easy to verify:

```ts
const duplicateBody = `
export function repeated(value: number) {
  const next = value + 1;
  const label = String(next);
  return label.toUpperCase();
}
`;
```

- [x] **Step 2: Assert JSON report shape and ordering**

Add:

```ts
expect(report.duplicates[0]).toEqual(
  expect.objectContaining({
    lines: expect.any(Number),
    tokens: expect.any(Number),
    files: [
      expect.objectContaining({ path: firstFile, startLine: 1 }),
      expect.objectContaining({ path: secondFile, startLine: 1 }),
    ],
  })
);
expect(report.duplicates[0].tokens).toBeGreaterThanOrEqual(10);
```

- [x] **Step 3: Assert XML report escaping and attributes**

Add an XML run for the same fixture and assert:

```ts
expect(stdout).toContain('<duplication ');
expect(stdout).toContain('tokens="');
expect(stdout).toContain('<file ');
expect(stdout).toContain('line="1"');
expect(stdout).toContain('&quot;');
```

- [x] **Step 4: Assert text report ordering**

Add a text run and assert first occurrence order:

```ts
const firstIndex = stdout.indexOf(firstFile);
const secondIndex = stdout.indexOf(secondFile);
expect(firstIndex).toBeGreaterThanOrEqual(0);
expect(secondIndex).toBeGreaterThan(firstIndex);
```

- [x] **Step 5: Run focused CLI compatibility tests**

```bash
npm test -- test/pmd-cli-compat.test.ts
```

Expected: JSON, XML, and text reports are deterministic and preserve path ordering, line ranges, and token counts.

- [x] **Step 6: Commit**

```bash
git add src/cli.ts src/core.ts test/pmd-cli-compat.test.ts
git commit -m "Compare CPD duplicate reports"
```

---

### Task 6: Final Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `test/fixtures/pmd/README.md`

- [x] **Step 1: Document supported scope**

In `README.md`, document:

```md
## PMD CPD compatibility scope

This project targets PMD CPD-like duplicate detection for the JavaScript and TypeScript ecosystem:
`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, and `.jsx`.

The compatibility suite vendors selected PMD JavaScript/TypeScript CPD fixtures under
`test/fixtures/pmd/**` so tests do not require a local PMD checkout or git submodule.
Vendored fixtures are excluded from Biome and TypeScript project checking because they are upstream
golden data.
```

- [x] **Step 2: Run the full verification pipeline**

```bash
npm run lint
npm test
git status --short
```

Expected:

```text
npm run lint exits 0
npm test exits 0
git status --short shows only intentional documentation or test changes before commit
```

- [x] **Step 3: Commit final docs**

```bash
git add README.md test/fixtures/pmd/README.md PLAN.md
git commit -m "Document JS TS CPD compatibility plan"
```

---

## Completion Criteria

- [x] Every vendored PMD JS/TS CPD fixture is either tested or listed in `UNSUPPORTED_PMD_FIXTURES` with a concrete reason.
- [x] `--ignore-identifiers`, `--ignore-literals`, and `CPD-OFF/CPD-ON` have Vitest coverage.
- [x] JSX and TSX have explicit tokenizer and duplicate-detection tests.
- [x] Real npm project layouts are covered: normal `src`, generated ignores, and monorepo packages.
- [x] `text`, `json`, and `xml` duplicate reports are compared for order, line ranges, token counts, and paths.
- [x] `npm run lint` passes.
- [x] `npm test` passes.
- [x] Each task is committed separately.
