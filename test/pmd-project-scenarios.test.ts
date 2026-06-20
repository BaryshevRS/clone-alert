import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), 'dist', 'cli.js');

interface JsonReport {
    duplicates: Array<{
        files: Array<{ path: string }>;
    }>;
}

async function makeProject(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'clone-alert-project-'));
}

describe('real npm project CPD scenarios', () => {
    test('scans duplicate TypeScript across monorepo packages', async () => {
        const root = await makeProject();
        await mkdir(join(root, 'packages/a/src'), { recursive: true });
        await mkdir(join(root, 'packages/b/src'), { recursive: true });
        await writeFile(
            join(root, 'packages/a/src/index.ts'),
            'export function alpha(x: number) { const y = x + 1; return y * y; }'
        );
        await writeFile(
            join(root, 'packages/b/src/index.ts'),
            'export function beta(x: number) { const y = x + 1; return y * y; }'
        );

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '10',
            '--files',
            join(root, 'packages'),
            '--extensions',
            'ts',
            '--format',
            'json',
        ]);

        const report = JSON.parse(stdout) as JsonReport;
        expect(report.duplicates).toHaveLength(1);
        expect(report.duplicates[0].files.map((file) => file.path).sort()).toEqual([
            join(root, 'packages/a/src/index.ts'),
            join(root, 'packages/b/src/index.ts'),
        ]);
    });

    test('scans duplicate TSX inside src trees', async () => {
        const root = await makeProject();
        await mkdir(join(root, 'src/features/a'), { recursive: true });
        await mkdir(join(root, 'src/features/b'), { recursive: true });
        await writeFile(
            join(root, 'src/features/a/Card.tsx'),
            'export function A({title}: {title: string}) { return <Card><h2>{title}</h2><Button /></Card>; }'
        );
        await writeFile(
            join(root, 'src/features/b/Card.tsx'),
            'export function B({label}: {label: string}) { return <Card><h2>{label}</h2><Button /></Card>; }'
        );

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
            '--minimum-tokens',
            '10',
            '--files',
            join(root, 'src'),
            '--extensions',
            'tsx',
            '--format',
            'json',
        ]);

        const report = JSON.parse(stdout) as JsonReport;
        expect(report.duplicates).toHaveLength(1);
        expect(report.duplicates[0].files.map((file) => file.path).sort()).toEqual([
            join(root, 'src/features/a/Card.tsx'),
            join(root, 'src/features/b/Card.tsx'),
        ]);
    });

    test('excludes generated files from duplicate detection', async () => {
        const root = await makeProject();
        await mkdir(join(root, 'src/generated'), { recursive: true });
        await mkdir(join(root, 'src/manual'), { recursive: true });
        await writeFile(
            join(root, 'src/generated/client.ts'),
            'export function generated() { const first = "same"; const second = "same"; return first + second; }'
        );
        await writeFile(
            join(root, 'src/manual/client.ts'),
            'export function manual() { const first = "same"; const second = "same"; return first + second; }'
        );

        const { stdout } = await execFileAsync(process.execPath, [
            cli,
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

        const report = JSON.parse(stdout) as JsonReport;
        expect(report.duplicates).toHaveLength(0);
    });
});
