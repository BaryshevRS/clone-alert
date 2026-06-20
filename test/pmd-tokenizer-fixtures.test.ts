import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { scriptKindFor, tokenizeTypeScript } from '../src/tokenizers';
import { fixturesIn, PMD_JAVASCRIPT_ROOT, type PmdFixture, readPmdExpectedTokens } from './helpers/pmd-fixtures';

interface ActualToken {
    image: string;
    line: number;
    beginColumn: number;
}

const typescriptFixtures = fixturesIn(path.join(PMD_JAVASCRIPT_ROOT, 'typescript/cpd/testdata'), '.ts');
const ecmascriptFixtures = fixturesIn(path.join(PMD_JAVASCRIPT_ROOT, 'ecmascript/cpd/testdata'), '.js');
const legacyTypescriptFixtures = fixturesIn(path.join(PMD_JAVASCRIPT_ROOT, 'ecmascript/cpd/testdata/ts'), '.ts');

describe('PMD JavaScript/TypeScript CPD tokenizer golden fixtures', () => {
    for (const fixture of [...typescriptFixtures, ...legacyTypescriptFixtures, ...ecmascriptFixtures]) {
        test(`${fixture.name} matches PMD token images and positions`, () => {
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
    }
});

function tokenizeFixture(fixture: PmdFixture): ActualToken[] {
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
