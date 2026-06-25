import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const cli = path.join(root, 'dist', 'cli.js');

async function fixtureDir(prefix: string): Promise<string> {
    const directory = path.join(
        tmpdir(),
        `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    await mkdir(directory, { recursive: true });
    return directory;
}

async function writeDuplicatePair(directory: string): Promise<void> {
    const duplicate = `
function copied() {
    const one = 1;
    const two = 2;
    const three = 3;
    return one + two + three;
}
`;
    await writeFile(path.join(directory, 'dup2.ts'), duplicate);
    await writeFile(path.join(directory, 'dup1.ts'), duplicate);
}

async function writeDeterministicDuplicatePair(directory: string): Promise<{ firstFile: string; secondFile: string }> {
    const duplicateBody = `export function repeated(value: number) {
  const next = value + 1;
  const label = String(next);
  return label.toUpperCase();
}
`;
    const firstFile = path.join(directory, 'first "quoted".ts');
    const secondFile = path.join(directory, 'second.ts');

    await writeFile(firstFile, duplicateBody);
    await writeFile(secondFile, duplicateBody);

    return { firstFile, secondFile };
}

describe('PMD CPD CLI duplicate-search compatibility', () => {
    test('directory scan reports duplicate files alphabetically regardless of creation order', async () => {
        const directory = await fixtureDir('clone-alert-pmd-order');
        await writeDuplicatePair(directory);

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '5',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);

        const first = stdout.indexOf('dup1.ts');
        const second = stdout.indexOf('dup2.ts');
        expect(first).toBeGreaterThanOrEqual(0);
        expect(second).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(second);
    });

    test('minimum token threshold controls whether a duplicate is reported', async () => {
        const directory = await fixtureDir('clone-alert-pmd-threshold');
        await writeDuplicatePair(directory);

        const detected = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '5',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);
        const ignored = await execFileAsync(process.execPath, [cli, '--minimum-tokens', '500', '--files', directory]);

        expect(detected.stdout).toMatch(/Found a \d+ token \(2 occurrences\) duplication:/);
        expect(ignored.stdout).toBe('');
    });

    test('json format exposes duplicate token count and occurrence locations', async () => {
        const directory = await fixtureDir('clone-alert-pmd-json');
        await writeDuplicatePair(directory);

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '5',
            '--format',
            'json',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);
        const report = JSON.parse(stdout) as {
            duplicates: Array<{
                tokens: number;
                files: Array<{ path: string; startLine: number; startColumn: number }>;
            }>;
        };

        expect(report.duplicates.length).toBeGreaterThanOrEqual(1);
        expect(report.duplicates[0].tokens).toBeGreaterThanOrEqual(5);
        expect(report.duplicates[0].files).toHaveLength(2);
        expect(report.duplicates[0].files.map((occurrence) => path.basename(occurrence.path))).toEqual([
            'dup1.ts',
            'dup2.ts',
        ]);
    });

    test('xml format escapes file paths and reports occurrence attributes', async () => {
        const directory = await fixtureDir('clone-alert-pmd-xml-&');
        await writeDuplicatePair(directory);

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '5',
            '--format',
            'xml',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);

        expect(stdout).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(stdout).toContain('<pmd-cpd>');
        expect(stdout).toContain('<duplication ');
        expect(stdout).toContain('tokens="');
        expect(stdout).toContain('&amp;');
        expect(stdout).toContain('line="');
        expect(stdout).toContain('column="');
    });

    test('json report preserves duplicate ordering, line ranges, and token counts', async () => {
        const directory = await fixtureDir('clone-alert-pmd-report-json');
        const { firstFile, secondFile } = await writeDeterministicDuplicatePair(directory);

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '10',
            '--format',
            'json',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);
        const report = JSON.parse(stdout) as {
            duplicates: Array<{
                lines: number;
                tokens: number;
                files: Array<{ path: string; startLine: number; endLine: number }>;
            }>;
        };

        expect(report.duplicates[0]).toEqual(
            expect.objectContaining({
                lines: 5,
                tokens: expect.any(Number),
                files: [
                    expect.objectContaining({ path: firstFile, startLine: 1, endLine: 5 }),
                    expect.objectContaining({ path: secondFile, startLine: 1, endLine: 5 }),
                ],
            })
        );
        expect(report.duplicates[0].tokens).toBeGreaterThanOrEqual(10);
    });

    test('xml report escapes paths and exposes duplicate attributes', async () => {
        const directory = await fixtureDir('clone-alert-pmd-report-xml');
        await writeDeterministicDuplicatePair(directory);

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '10',
            '--format',
            'xml',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);

        expect(stdout).toContain('<duplication ');
        expect(stdout).toContain('lines="5"');
        expect(stdout).toContain('tokens="');
        expect(stdout).toContain('<file ');
        expect(stdout).toContain('line="1"');
        expect(stdout).toContain('endline="5"');
        expect(stdout).toContain('column="1"');
        expect(stdout).toContain('endcolumn="2"');
        expect(stdout).toContain('&quot;');
    });

    test('text report preserves first occurrence order', async () => {
        const directory = await fixtureDir('clone-alert-pmd-report-text');
        const { firstFile, secondFile } = await writeDeterministicDuplicatePair(directory);

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '10',
            '--format',
            'text',
            '--files',
            directory,
            '--no-fail-on-violation',
        ]);

        const firstIndex = stdout.indexOf(firstFile);
        const secondIndex = stdout.indexOf(secondFile);
        expect(firstIndex).toBeGreaterThanOrEqual(0);
        expect(secondIndex).toBeGreaterThan(firstIndex);
    });

    test('missing input path fails with usage exit code', async () => {
        await expect(
            execFileAsync(process.execPath, [cli, '--files', '/definitely/not/here'], { cwd: root })
        ).rejects.toMatchObject({
            code: 2,
            stderr: expect.stringContaining('path does not exist'),
        });
    });
});
