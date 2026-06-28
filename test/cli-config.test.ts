import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const cli = path.join(root, 'dist', 'cli.js');

const DUP = `
function duplicateOne() {
  const alpha = 1;
  const beta = 2;
  return alpha + beta;
}
`;

let counter = 0;
async function makeFixture(): Promise<string> {
    const dir = path.join(tmpdir(), `clone-alert-config-${process.pid}-${Date.now()}-${counter++}`);
    await mkdir(dir, { recursive: true });
    return dir;
}

test('reads clone-alert.config.json from the working directory', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);
    await writeFile(path.join(dir, 'b.ts'), DUP.replace('duplicateOne', 'duplicateTwo'));
    await writeFile(
        path.join(dir, 'clone-alert.config.json'),
        JSON.stringify({ paths: ['.'], minimumTokens: 5, format: 'json', failOnViolation: false })
    );

    const { stdout } = await execFileAsync(process.execPath, [cli], { cwd: dir });
    const parsed = JSON.parse(stdout);
    expect(parsed.duplicates.length).toBeGreaterThan(0);
});

test('CLI flags override config values', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);
    await writeFile(path.join(dir, 'b.ts'), DUP.replace('duplicateOne', 'duplicateTwo'));
    await writeFile(
        path.join(dir, 'clone-alert.config.json'),
        JSON.stringify({ paths: ['.'], minimumTokens: 5, format: 'json', failOnViolation: false })
    );

    // --format text must win over config's "json"
    const { stdout } = await execFileAsync(process.execPath, [cli, '--format', 'text'], { cwd: dir });
    expect(stdout).toMatch(/Found a \d+ token/);
    expect(() => JSON.parse(stdout)).toThrow();
});

test('positional CLI paths replace config paths', async () => {
    const dir = await makeFixture();
    await mkdir(path.join(dir, 'pkg'), { recursive: true });
    await writeFile(path.join(dir, 'pkg', 'a.ts'), DUP);
    await writeFile(path.join(dir, 'pkg', 'b.ts'), DUP.replace('duplicateOne', 'duplicateTwo'));
    // config points at an empty dir; CLI path "pkg" must take over and find the clone
    await mkdir(path.join(dir, 'empty'), { recursive: true });
    await writeFile(path.join(dir, 'clone-alert.config.json'), JSON.stringify({ paths: ['empty'], minimumTokens: 5 }));

    await expect(execFileAsync(process.execPath, [cli, 'pkg'], { cwd: dir })).rejects.toMatchObject({
        code: 4,
    });
});

test('config exclude and CLI --exclude are additive', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);
    await writeFile(path.join(dir, 'b.ts'), DUP.replace('duplicateOne', 'duplicateTwo'));
    await writeFile(path.join(dir, 'unique.ts'), 'export const lonely = 42;\n');
    await writeFile(
        path.join(dir, 'clone-alert.config.json'),
        JSON.stringify({ paths: ['.'], minimumTokens: 5, exclude: ['**/a.ts'] })
    );

    // config drops a.ts, CLI drops b.ts → no clone left → clean exit 0
    await expect(execFileAsync(process.execPath, [cli, '--exclude', '**/b.ts'], { cwd: dir })).resolves.toBeTruthy();
});

test('config extensions replace the default set', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);
    await writeFile(path.join(dir, 'clone-alert.config.json'), JSON.stringify({ paths: ['.'], extensions: ['js'] }));

    // only .js is scanned, but the dir holds .ts → nothing to scan
    await expect(execFileAsync(process.execPath, [cli], { cwd: dir })).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/no supported files found/),
    });
});

test('--no-config ignores clone-alert.config.json', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);
    await writeFile(path.join(dir, 'clone-alert.config.json'), JSON.stringify({ paths: ['.'], minimumTokens: 5 }));

    // without the config there are no paths → usage error
    await expect(execFileAsync(process.execPath, [cli, '--no-config'], { cwd: dir })).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/missing files or directories/),
    });
});

test('--config points at an explicit file', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);
    await writeFile(path.join(dir, 'b.ts'), DUP.replace('duplicateOne', 'duplicateTwo'));
    await writeFile(
        path.join(dir, 'custom.json'),
        JSON.stringify({ paths: ['.'], minimumTokens: 5, failOnViolation: false, format: 'json' })
    );

    const { stdout } = await execFileAsync(process.execPath, [cli, '--config', 'custom.json'], { cwd: dir });
    expect(JSON.parse(stdout).duplicates.length).toBeGreaterThan(0);
});

test('rejects an unknown config key', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ foo: 1 }));

    await expect(
        execFileAsync(process.execPath, [cli, '--config', 'bad.json', '.'], { cwd: dir })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/unknown config key: "foo"/),
    });
});

test('rejects a wrongly typed config value', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ minimumTokens: 'lots' }));

    await expect(
        execFileAsync(process.execPath, [cli, '--config', 'bad.json', '.'], { cwd: dir })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/"minimumTokens" must be a positive integer/),
    });
});

test('rejects invalid JSON in the config file', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'bad.json'), '{ not json');

    await expect(
        execFileAsync(process.execPath, [cli, '--config', 'bad.json', '.'], { cwd: dir })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/invalid JSON/),
    });
});

test('errors when an explicit --config file is missing', async () => {
    const dir = await makeFixture();
    await writeFile(path.join(dir, 'a.ts'), DUP);

    await expect(
        execFileAsync(process.execPath, [cli, '--config', 'nope.json', '.'], { cwd: dir })
    ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringMatching(/config file not readable/),
    });
});
