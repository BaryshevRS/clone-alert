import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const cli = path.join(root, 'dist', 'cli.js');

async function makeFixture(name: string): Promise<string> {
    const dir = path.join(tmpdir(), `clone-alert-${name}-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    return dir;
}

const DUP_BLOCK = `
function duplicateOne() {
  const alpha = 1;
  const beta = 2;
  return alpha + beta;
}
`;

test('prints help for the CPD-style CLI', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cli, '--help'], { cwd: root });

    expect(stdout).toMatch(/Usage: clone-alert/);
    expect(stdout).toMatch(/--minimum-tokens/);
    expect(stdout).toMatch(/--files/);
    expect(stdout).toMatch(/--angular-inline-templates/);
});

test('reports duplicate TypeScript code and can fail on violation', async () => {
    const fixture = path.join(tmpdir(), `clone-alert-${process.pid}-${Date.now()}`);
    await mkdir(fixture, { recursive: true });
    const repeated = `
function duplicateOne() {
  const alpha = 1;
  const beta = 2;
  return alpha + beta;
}
`;
    await writeFile(path.join(fixture, 'a.ts'), repeated);
    await writeFile(path.join(fixture, 'b.ts'), repeated.replace('duplicateOne', 'duplicateTwo'));

    await expect(
        execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture, '--fail-on-violation'], {
            cwd: root,
        })
    ).rejects.toMatchObject({
        code: 4,
        stdout: expect.stringMatching(/Found a \d+ token \(2 occurrences\) duplication:/),
    });
});

test('uses PMD-like strict comparison by default and enables normalization by flag', async () => {
    const fixture = path.join(tmpdir(), `clone-alert-strict-${process.pid}-${Date.now()}`);
    await mkdir(fixture, { recursive: true });

    await writeFile(path.join(fixture, 'a.ts'), 'function alpha(value: number) { return value + 1; }');
    await writeFile(path.join(fixture, 'b.ts'), 'function beta(input: number) { return input + 1; }');

    const strict = await execFileAsync(process.execPath, [cli, '--minimum-tokens', '8', '--files', fixture], {
        cwd: root,
    });
    const normalized = await execFileAsync(process.execPath, [
        cli,
        '--minimum-tokens',
        '8',
        '--ignore-identifiers',
        '--files',
        fixture,
    ]);

    expect(strict.stdout).toBe('');
    expect(normalized.stdout).toMatch(/Found a \d+ token \(2 occurrences\) duplication:/);
});

test('tokenizes JavaScript natively regardless of the PMD typescript flag', async () => {
    const fixture = path.join(tmpdir(), `clone-alert-pmd-js-${process.pid}-${Date.now()}`);
    await mkdir(fixture, { recursive: true });
    const repeated = 'const copy = (value) => ({ ...value, nested: { ...value.data } });';

    await writeFile(path.join(fixture, 'a.js'), repeated);
    await writeFile(path.join(fixture, 'b.js'), repeated);

    const detected = await execFileAsync(process.execPath, [
        cli,
        '--minimum-tokens',
        '20',
        '--files',
        fixture,
        '--extensions',
        'js',
    ]);
    const flagged = await execFileAsync(process.execPath, [
        cli,
        '--minimum-tokens',
        '20',
        '--files',
        fixture,
        '--extensions',
        'js',
        '--no-pmd-typescript-compatibility',
    ]);

    // PMD typescript compatibility is .ts-only: => and ... stay single native tokens.
    expect(detected.stdout).toMatch(/Found a 23 token \(2 occurrences\) duplication:/);
    expect(flagged.stdout).toBe(detected.stdout);
});

test('does not scan Angular inline templates by default', async () => {
    const fixture = path.join(tmpdir(), `clone-alert-angular-${process.pid}-${Date.now()}`);
    await mkdir(fixture, { recursive: true });
    await writeFile(
        path.join(fixture, 'component.ts'),
        `
        @Component({
          template: '<div>{{ value }}</div>'
        })
        export class ExampleComponent {}
        `
    );

    const result = await execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture], {
        cwd: root,
    });

    expect(result.stderr).not.toContain('Angular template skipped');
});

test('--update-baseline records current duplications and suppresses them on the next run', async () => {
    const fixture = await makeFixture('baseline');
    const baseline = path.join(fixture, 'baseline.json');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    const args = [cli, '--minimum-tokens', '5', '--files', fixture, '--baseline', baseline];

    const update = await execFileAsync(process.execPath, [...args, '--update-baseline'], { cwd: root });
    expect(update.stderr).toMatch(/wrote baseline with 1 duplication/);

    const written = JSON.parse(await readFile(baseline, 'utf-8')) as {
        version: number;
        clones: { fingerprint: string; tokens: number; files: string[] }[];
    };
    expect(written.version).toBe(1);
    expect(written.clones).toHaveLength(1);
    expect(written.clones[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);

    // Known clone is suppressed; --fail-on-violation must not trip.
    const checked = await execFileAsync(process.execPath, [...args, '--fail-on-violation'], { cwd: root });
    expect(checked.stdout).toBe('');
    expect(checked.stderr).toMatch(/1 known duplication\(s\) suppressed by baseline/);
});

test('baseline fails on a new clone while still suppressing the known one', async () => {
    const fixture = await makeFixture('baseline-new');
    const baseline = path.join(fixture, 'baseline.json');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    const args = [cli, '--minimum-tokens', '5', '--files', fixture, '--baseline', baseline];
    await execFileAsync(process.execPath, [...args, '--update-baseline'], { cwd: root });

    // Add a second, different duplication that is not in the baseline.
    const otherDup = `
function freshOne() {
  const gamma = 10;
  const delta = 20;
  return gamma * delta;
}
`;
    await writeFile(path.join(fixture, 'c.ts'), otherDup);
    await writeFile(path.join(fixture, 'd.ts'), otherDup.replace('freshOne', 'freshTwo'));

    await expect(
        execFileAsync(process.execPath, [...args, '--fail-on-violation'], { cwd: root })
    ).rejects.toMatchObject({
        code: 4,
        // Only the new clone (c.ts/d.ts) is reported; the baselined a.ts/b.ts is not.
        stdout: expect.stringMatching(/[cd]\.ts/),
    });
});

test('baseline fingerprint survives the duplicated code moving in the file', async () => {
    const fixture = await makeFixture('baseline-move');
    const baseline = path.join(fixture, 'baseline.json');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    const args = [cli, '--minimum-tokens', '5', '--files', fixture, '--baseline', baseline];
    await execFileAsync(process.execPath, [...args, '--update-baseline'], { cwd: root });

    // Push the block down with DISTINCT prelude lines per file (so the padding is
    // not itself a clone): line numbers shift, the block's content fingerprint does
    // not, so the baseline still recognizes it.
    await writeFile(path.join(fixture, 'a.ts'), `\nconst onlyInA = 42;\n${DUP_BLOCK}`);
    await writeFile(
        path.join(fixture, 'b.ts'),
        `\nconst onlyInB = 7;\nconst extraInB = 9;\n${DUP_BLOCK.replace('duplicateOne', 'duplicateTwo')}`
    );

    const checked = await execFileAsync(process.execPath, [...args, '--fail-on-violation'], { cwd: root });
    expect(checked.stdout).toBe('');
    expect(checked.stderr).toMatch(/suppressed by baseline/);
});

test('--update-baseline without --baseline is an error', async () => {
    const fixture = await makeFixture('baseline-missing-flag');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);

    await expect(
        execFileAsync(process.execPath, [cli, '--files', fixture, '--update-baseline'], { cwd: root })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/--update-baseline requires --baseline/),
    });
});

test('--baseline pointing at a missing file is an error', async () => {
    const fixture = await makeFixture('baseline-absent');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    await expect(
        execFileAsync(
            process.execPath,
            [cli, '--minimum-tokens', '5', '--files', fixture, '--baseline', path.join(fixture, 'nope.json')],
            { cwd: root }
        )
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/baseline file not found/),
    });
});
