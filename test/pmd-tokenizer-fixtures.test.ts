import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { scriptKindFor, tokenizeTypeScript } from '../src/tokenizers';
import {
    discoverPmdFixtureCases,
    type PmdFixtureCase,
    readPmdExpectedTokens,
} from './helpers/pmd-fixtures';

interface ActualToken {
    image: string;
    line: number;
    beginColumn: number;
}

const fixtureCases = discoverPmdFixtureCases();
const supportedCases = fixtureCases.filter((fixture) => fixture.supported);
const unsupportedCases = fixtureCases.filter((fixture) => !fixture.supported);

describe('PMD JavaScript/TypeScript tokenizer fixtures', () => {
    test.each(supportedCases)('$name matches PMD token images and positions', (fixture) => {
        const actual = tokenizeFixture(fixture);
        const expected = readPmdExpectedTokens(fixture.expectedPath);

        expect(actual).toHaveLength(expected.length);
        for (let index = 0; index < expected.length; index++) {
            const expectedToken = expected[index];
            const actualToken = actual[index];

            if (expectedToken.truncated) {
                expect(actualToken.image.startsWith(expectedToken.image)).toBe(true);
            } else {
                expect(actualToken.image).toBe(expectedToken.image);
            }
            expect(actualToken.line).toBe(expectedToken.line);
            expect(actualToken.beginColumn).toBe(expectedToken.beginColumn);
        }
    });

    test('documents every unsupported PMD fixture explicitly', () => {
        expect(unsupportedCases).toEqual(
            unsupportedCases.map((fixture) =>
                expect.objectContaining({
                    name: expect.any(String),
                    reason: expect.stringMatching(/\S/),
                })
            )
        );
    });
});

function tokenizeFixture(fixture: PmdFixtureCase): ActualToken[] {
    const source = fs.readFileSync(fixture.sourcePath, 'utf-8');
    return tokenizeTypeScript(
        fixture.sourcePath,
        source,
        {
            ignoreIdentifiers: false,
            ignoreLiterals: false,
        },
        scriptKindFor(path.extname(fixture.sourcePath).toLowerCase())
    ).map((token) => ({
        image: token.image,
        line: token.line,
        beginColumn: token.column,
    }));
}
