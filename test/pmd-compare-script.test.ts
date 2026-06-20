import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const script = path.join(process.cwd(), 'scripts', 'compare-pmd-cpd.mjs');

test('prints PMD comparison harness help', async () => {
    const { stdout } = await execFileAsync(process.execPath, [script, '--help']);

    expect(stdout).toContain('Usage: npm run compare:pmd');
    expect(stdout).toContain('--minimum-tokens');
    expect(stdout).toContain('--extensions');
});
