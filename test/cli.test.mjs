import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'dist', 'cli.js');

test('prints help for the CPD-style CLI', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cli, '--help'], { cwd: root });

    assert.match(stdout, /Usage: clone-alert/);
    assert.match(stdout, /--minimum-tokens/);
    assert.match(stdout, /--files/);
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

    await assert.rejects(
        execFileAsync(process.execPath, [cli, '--minimum-tokens', '5', '--files', fixture, '--fail-on-violation'], {
            cwd: root,
        }),
        (error) => {
            assert.equal(error.code, 4);
            assert.match(error.stdout, /Found a \d+ token \(2 occurrences\) duplication:/);
            assert.match(error.stdout, /a\.ts:\d+:\d+/);
            assert.match(error.stdout, /b\.ts:\d+:\d+/);
            return true;
        }
    );
});
