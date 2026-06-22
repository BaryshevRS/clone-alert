import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const script = path.join(process.cwd(), 'scripts', 'compare-pmd-cpd.mjs');

test('prints PMD comparison harness help', async () => {
    const { stdout } = await execFileAsync(process.execPath, [script, '--help']);

    expect(stdout).toContain('Usage: npm run compare:pmd');
    expect(stdout).toContain('--minimum-tokens');
    expect(stdout).toContain('--extensions');
    expect(stdout).toContain('--jscpd');
    expect(stdout).toContain('--repo-name');
});

test('compares pair overlap without materializing PMD pair sets', async () => {
    const { compareReports } = (await import(pathToFileURL(script).href)) as {
        compareReports: (
            pmd: { duplicates: Array<{ lines: number; tokens: number; files: Array<{ path: string; line: number }> }> },
            clone: {
                duplicates: Array<{ lines: number; tokens: number; files: Array<{ path: string; line: number }> }>;
            },
            jscpd: {
                duplicates: Array<{ lines: number; tokens: number; files: Array<{ path: string; line: number }> }>;
                statistics: null;
            }
        ) => {
            pairOverlap: {
                cloneAlert: { pmdExactPairs: number; candidateExactPairs: number; exactPairOverlap: number };
            };
        };
    };
    const files = Array.from({ length: 1000 }, (_, index) => ({
        path: `/repo/file-${index}.ts`,
        line: index + 1,
    }));
    const candidate = {
        lines: 1,
        tokens: 50,
        files: [files[0], files[999]],
    };

    const summary = compareReports(
        { duplicates: [{ lines: 1, tokens: 50, files }] },
        { duplicates: [candidate] },
        { duplicates: [], statistics: null }
    );

    expect(summary.pairOverlap.cloneAlert.pmdExactPairs).toBe(499500);
    expect(summary.pairOverlap.cloneAlert.candidateExactPairs).toBe(1);
    expect(summary.pairOverlap.cloneAlert.exactPairOverlap).toBe(1);
});
