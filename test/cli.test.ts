import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
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
        '--no-fail-on-violation',
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
        '--no-fail-on-violation',
        '--files',
        fixture,
        '--extensions',
        'js',
    ]);
    const flagged = await execFileAsync(process.execPath, [
        cli,
        '--minimum-tokens',
        '20',
        '--no-fail-on-violation',
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

test('emits SARIF 2.1.0 for GitHub Code Scanning', async () => {
    const fixture = await makeFixture('sarif');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    // Run with cwd at the fixture so artifact URIs are clean relative paths.
    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', '.', '--format', 'sarif', '--no-fail-on-violation'],
        { cwd: fixture }
    );

    const log = JSON.parse(stdout);
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0].tool.driver.name).toBe('clone-alert');
    expect(log.runs[0].tool.driver.rules[0].id).toBe('duplication');

    const result = log.runs[0].results[0];
    expect(result.ruleId).toBe('duplication');
    expect(result.level).toBe('warning');
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toMatch(/^[ab]\.ts$/);
    expect(result.locations[0].physicalLocation.region).toMatchObject({
        startLine: expect.any(Number),
        startColumn: expect.any(Number),
        endLine: expect.any(Number),
        endColumn: expect.any(Number),
    });
    expect(result.relatedLocations).toHaveLength(1);
    expect(result.partialFingerprints['cloneAlert/contentV1']).toMatch(/^[0-9a-f]{16}$/);
});

test('SARIF honors the baseline (only new clones become results)', async () => {
    const fixture = await makeFixture('sarif-baseline');
    const baseline = path.join(fixture, 'baseline.json');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', '.', '--baseline', baseline, '--update-baseline'],
        { cwd: fixture }
    );

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', '.', '--baseline', baseline, '--format', 'sarif'],
        { cwd: fixture }
    );
    expect(JSON.parse(stdout).runs[0].results).toHaveLength(0);
});

test('skips files matched by .gitignore by default and scans them with --no-gitignore', async () => {
    const fixture = await makeFixture('gitignore');
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));
    await writeFile(path.join(fixture, '.gitignore'), 'b.ts\n');

    // b.ts is ignored, so a.ts has no pair and nothing is reported.
    const ignored = await execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture], {
        cwd: root,
    });
    expect(ignored.stdout).toBe('');

    // --no-gitignore brings b.ts back and the duplication surfaces.
    await expect(
        execFileAsync(
            process.execPath,
            [cli, '--minimum-tokens', '5', '--files', fixture, '--no-gitignore', '--fail-on-violation'],
            {
                cwd: root,
            }
        )
    ).rejects.toMatchObject({ code: 4 });
});

test('honors a repo-root .gitignore when scanning a subdirectory', async () => {
    const fixture = await makeFixture('gitignore-ancestor');
    await mkdir(path.join(fixture, '.git'), { recursive: true });
    await mkdir(path.join(fixture, 'src', 'vendor'), { recursive: true });
    await writeFile(path.join(fixture, '.gitignore'), 'src/vendor/\n');
    await writeFile(path.join(fixture, 'src', 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'src', 'vendor', 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));

    const result = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', path.join(fixture, 'src')],
        { cwd: root }
    );
    // The vendored copy is pruned via the parent .gitignore, so no duplication remains.
    expect(result.stdout).toBe('');
});

async function dupFixture(name: string): Promise<string> {
    const fixture = await makeFixture(name);
    await writeFile(path.join(fixture, 'a.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b.ts'), DUP_BLOCK.replace('duplicateOne', 'duplicateTwo'));
    return fixture;
}

test('fails on violation by default (PMD parity)', async () => {
    const fixture = await dupFixture('default-fail');

    await expect(
        execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture], { cwd: root })
    ).rejects.toMatchObject({ code: 4 });
});

test('--no-fail-on-violation reports but exits 0', async () => {
    const fixture = await dupFixture('no-fail');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--no-fail-on-violation'],
        { cwd: root }
    );
    expect(stdout).toMatch(/Found a \d+ token \(2 occurrences\) duplication:/);
});

test('--format csv emits the PMD CSV header and a row per duplication', async () => {
    const fixture = await dupFixture('csv');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--format', 'csv', '--no-fail-on-violation'],
        { cwd: root }
    );

    const lines = stdout.trim().split('\n');
    expect(lines[0]).toBe('lines,tokens,occurrences');
    const cells = lines[1].split(',');
    expect(cells[2]).toBe('2'); // occurrences
    expect(lines[1].match(/"/g)).toHaveLength(4); // two quoted file paths
    expect(lines[1]).toContain('a.ts');
    expect(lines[1]).toContain('b.ts');
});

test('--format csv_with_linecount_per_file omits the header', async () => {
    const fixture = await dupFixture('csv-lc');

    const { stdout } = await execFileAsync(
        process.execPath,
        [
            cli,
            '--minimum-tokens',
            '5',
            '--files',
            fixture,
            '--format',
            'csv_with_linecount_per_file',
            '--no-fail-on-violation',
        ],
        { cwd: root }
    );

    const lines = stdout.trim().split('\n');
    expect(lines[0]).not.toBe('lines,tokens,occurrences');
    expect(lines[0].split(',')[0]).toBe('2'); // occurrences first
    expect(lines[0].match(/"/g)).toHaveLength(4);
});

test('--format xml embeds the duplicated code in a codefragment (like PMD)', async () => {
    const fixture = await dupFixture('xml-fragment');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--format', 'xml', '--no-fail-on-violation'],
        { cwd: root }
    );

    expect(stdout).toContain('<codefragment><![CDATA[');
    expect(stdout).toContain(']]></codefragment>');
    // The CDATA carries the shared body lines verbatim.
    expect(stdout).toMatch(/<codefragment><!\[CDATA\[[\s\S]*const alpha = 1;[\s\S]*\]\]><\/codefragment>/);
});

test('--format json carries the duplicated code in a fragment field (like jscpd)', async () => {
    const fixture = await dupFixture('json-fragment');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--format', 'json', '--no-fail-on-violation'],
        { cwd: root }
    );

    const report = JSON.parse(stdout) as { duplicates: Array<{ fragment: string }> };
    expect(report.duplicates[0].fragment).toContain('const alpha = 1;');
    expect(report.duplicates[0].fragment).toContain('\n'); // multi-line source preserved
});

test('--format markdown writes a report with a fenced code block of the clone', async () => {
    const fixture = await dupFixture('markdown');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--format', 'markdown', '--no-fail-on-violation'],
        { cwd: root }
    );

    expect(stdout).toContain('# Copy/paste detection report');
    expect(stdout).toMatch(/> Found 1 clone\./);
    expect(stdout).toMatch(/## Clone \(\d+ tokens, 2 occurrences\)/);
    expect(stdout).toContain('a.ts` [');
    // The duplicated body sits inside a fenced block.
    expect(stdout).toMatch(/```\n[\s\S]*const alpha = 1;[\s\S]*\n```/);
});

test('--format ai emits a compact listing with a duplication-stats summary', async () => {
    const fixture = await dupFixture('ai');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--format', 'ai', '--no-fail-on-violation'],
        { cwd: root }
    );

    const lines = stdout.trim().split('\n');
    // One clone line with both occurrences joined by ` ~ `, the shared dir stripped.
    expect(lines[0]).toMatch(/^a\.ts:\d+-\d+ ~ b\.ts:\d+-\d+$/);
    expect(lines.at(-2)).toBe('---');
    expect(lines.at(-1)).toMatch(/^1 clone · \d+\.\d{2}% duplicated lines$/);
    // Compact: no source code in the output.
    expect(stdout).not.toContain('const alpha');
});

test('--format shields emits a bright-green "0 clones" endpoint payload when clean', async () => {
    const fixture = await makeFixture('shields-clean');
    await writeFile(path.join(fixture, 'a.ts'), 'export const a = 1;\n');
    await writeFile(path.join(fixture, 'b.ts'), 'export const b = 2;\n');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '10', '--files', fixture, '--format', 'shields'],
        { cwd: root }
    );

    const payload = JSON.parse(stdout) as { schemaVersion: number; label: string; message: string; color: string };
    expect(payload).toEqual({ schemaVersion: 1, label: 'clone-alert', message: '0 clones', color: 'brightgreen' });
});

test('--format shields reports the percentage and a non-hero color when code duplicates', async () => {
    const fixture = await dupFixture('shields-dirty');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--format', 'shields', '--no-fail-on-violation'],
        { cwd: root }
    );

    const payload = JSON.parse(stdout) as { message: string; color: string };
    expect(payload.message).toMatch(/^\d+\.\d%$/);
    expect(payload.color).not.toBe('brightgreen'); // mostly-clone fixtures aren't the hero state
});

test('text report ends with a duplication-stats footer', async () => {
    const fixture = await dupFixture('text-footer');

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--no-fail-on-violation'],
        { cwd: root }
    );

    expect(stdout).toMatch(/Found a \d+ token \(2 occurrences\) duplication:/);
    expect(stdout.trim().split('\n').at(-1)).toMatch(/^1 clone · \d+\.\d{2}% duplicated lines$/);
});

test('--skip-duplicate-files skips same-name same-length copies', async () => {
    const fixture = await makeFixture('skip-dup');
    await mkdir(path.join(fixture, 'a'), { recursive: true });
    await mkdir(path.join(fixture, 'b'), { recursive: true });
    // Same basename, identical content → identical byte length.
    await writeFile(path.join(fixture, 'a', 'dup.ts'), DUP_BLOCK);
    await writeFile(path.join(fixture, 'b', 'dup.ts'), DUP_BLOCK);

    // Skipped: only one copy is scanned, so there is no cross-file clone.
    const skipped = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--skip-duplicate-files'],
        { cwd: root }
    );
    expect(skipped.stdout).toBe('');

    // Without the flag both copies are scanned and the duplication trips the default exit 4.
    await expect(
        execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture], { cwd: root })
    ).rejects.toMatchObject({ code: 4 });
});

test('--file-list scans the newline-separated paths it points at', async () => {
    const fixture = await dupFixture('file-list');
    const listPath = path.join(fixture, 'list.txt');
    await writeFile(listPath, `${path.join(fixture, 'a.ts')}\n${path.join(fixture, 'b.ts')}\n`);

    const { stdout } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--file-list', listPath, '--no-fail-on-violation'],
        { cwd: root }
    );
    expect(stdout).toMatch(/Found a \d+ token \(2 occurrences\) duplication:/);
});

test('--file-list pointing at a missing file is an error', async () => {
    await expect(
        execFileAsync(process.execPath, [cli, '--file-list', path.join(tmpdir(), 'no-such-list.txt')], { cwd: root })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/--file-list not readable/),
    });
});

const cannotChmod = process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0);

test.skipIf(cannotChmod)('--skip-lexical-errors skips unreadable files instead of aborting', async () => {
    const fixture = await dupFixture('lexical');
    const bad = path.join(fixture, 'bad.ts');
    await writeFile(bad, DUP_BLOCK);
    await chmod(bad, 0o000);

    // Without the flag the read failure aborts the run with a usage exit code.
    await expect(
        execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture], { cwd: root })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/--skip-lexical-errors/),
    });

    // With it, bad.ts is skipped (with a warning) and the a.ts/b.ts clone is still reported.
    const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [cli, '--minimum-tokens', '5', '--files', fixture, '--skip-lexical-errors', '--no-fail-on-violation'],
        { cwd: root }
    );
    expect(stderr).toMatch(/skipping .*bad\.ts/);
    expect(stdout).toMatch(/Found a \d+ token \(2 occurrences\) duplication:/);

    await chmod(bad, 0o644); // restore so the tmp dir can be cleaned up
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
