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
