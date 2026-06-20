import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const cli = path.join(root, 'dist', 'cli.js');

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

    expect(result.stderr).not.toContain('Angular-шаблон пропущен');
});
