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

function unescapePmdImage(image: string): string {
    return image
        .replace(/\\r\\n/g, '\r\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\[/g, '[')
        .replace(/\\\]/g, ']')
        .replace(/\\\\/g, '\\');
}
