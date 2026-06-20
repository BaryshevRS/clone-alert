import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PmdExpectedToken {
    image: string;
    line: number;
    beginColumn: number;
    endColumn: number;
    truncated: boolean;
}

export interface PmdFixture {
    name: string;
    sourcePath: string;
    expectedPath: string;
}

export interface PmdFixtureCase {
    name: string;
    sourcePath: string;
    expectedPath: string;
    supported: boolean;
    reason?: string;
}

export const UNSUPPORTED_PMD_FIXTURES: Record<string, string> = {};

export const PMD_JAVASCRIPT_ROOT = `${process.cwd()}/test/fixtures/pmd/pmd-javascript/src/test/resources/net/sourceforge/pmd/lang`;

export function fixturesIn(directory: string, extension: '.js' | '.ts'): PmdFixture[] {
    return fs
        .readdirSync(directory)
        .filter((file) => file.endsWith(extension))
        .sort()
        .map((file) => {
            const sourcePath = path.join(directory, file);
            return {
                name: file,
                sourcePath,
                expectedPath: sourcePath.replace(/\.(js|ts)$/, '.txt'),
            };
        })
        .filter((fixture) => fs.existsSync(fixture.expectedPath));
}

export function discoverPmdTokenFixtures(): PmdFixture[] {
    return walk(PMD_JAVASCRIPT_ROOT)
        .filter((file) => /\.(js|ts)$/.test(file))
        .filter((file) => file.includes(`${path.sep}cpd${path.sep}testdata${path.sep}`))
        .sort()
        .map((sourcePath) => ({
            name: path.relative(PMD_JAVASCRIPT_ROOT, sourcePath),
            sourcePath,
            expectedPath: sourcePath.replace(/\.(js|ts)$/, '.txt'),
        }))
        .filter((fixture) => fs.existsSync(fixture.expectedPath));
}

export function discoverPmdFixtureCases(): PmdFixtureCase[] {
    return discoverPmdTokenFixtures().map((fixture) => {
        const reason = UNSUPPORTED_PMD_FIXTURES[fixture.name];
        return {
            name: fixture.name,
            sourcePath: fixture.sourcePath,
            expectedPath: fixture.expectedPath,
            supported: reason === undefined,
            reason,
        };
    });
}

export function readPmdExpectedTokens(expectedPath: string): PmdExpectedToken[] {
    const tokens: PmdExpectedToken[] = [];
    let currentLine = 0;

    for (const row of fs.readFileSync(expectedPath, 'utf-8').split(/\r?\n/)) {
        if (row === 'EOF') break;

        const lineMatch = row.match(/^L(\d+)$/);
        if (lineMatch) {
            currentLine = Number(lineMatch[1]);
            continue;
        }

        if (row.includes('[Image]')) continue;

        const tokenMatch = row.match(/^ {4}(.+?)\s+(\d+)\s+(\d+)$/);
        if (!tokenMatch) continue;

        const field = tokenMatch[1];
        const truncated = field.endsWith('[');
        tokens.push({
            image: unescapePmdImage(field.slice(1, -1)),
            line: currentLine,
            beginColumn: Number(tokenMatch[2]),
            endColumn: Number(tokenMatch[3]),
            truncated,
        });
    }

    return tokens;
}

function walk(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

function unescapePmdImage(image: string): string {
    return image
        .replace(/\\r\\n/g, '\r\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']')
        .replace(/\\\\/g, '\\');
}
