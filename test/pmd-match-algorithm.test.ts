import { describe, expect, test } from 'vitest';
import { CpdCore, Mark, Match, type RawToken, TokenEntry } from '../src/core';
import { Cpd, type CpdOptions } from '../src/index';

function token(image: string, line: number, column = 1): RawToken {
    return { image, line, column };
}

function barrier(line: number): RawToken {
    return { image: '', line, column: 1, barrier: true };
}

function analyze(raw: RawToken[], minTileSize: number, file = 'sample.dummy') {
    const core = new CpdCore(minTileSize);
    core.addFile(file, raw);
    return core.analyze();
}

function detectClonesFromSources(sources: string[], options: CpdOptions) {
    const cpd = new Cpd(options);
    for (const [index, source] of sources.entries()) {
        cpd.addSource(`source-${index}.ts`, source);
    }
    return cpd.run();
}

function repeatedWindow(line: number, size: number): RawToken[] {
    return Array.from({ length: size }, (_, index) => token(`D${index}`, line, index + 1));
}

describe('PMD CPD model equivalents', () => {
    test('TokenEntry preserves token identity and start location', () => {
        const entry = new TokenEntry('public', 7, 0, 'Foo.java', 1, 2);

        expect(entry.image).toBe('public');
        expect(entry.identifier).toBe(7);
        expect(entry.index).toBe(0);
        expect(entry.file).toBe('Foo.java');
        expect(entry.beginLine).toBe(1);
        expect(entry.beginColumn).toBe(2);
    });

    test('Mark wraps a token start', () => {
        const entry = new TokenEntry('public', 7, 0, 'Foo.java', 1, 2);
        const mark = new Mark(entry);

        expect(mark.token).toBe(entry);
        expect(mark.token.file).toBe('Foo.java');
        expect(mark.token.beginLine).toBe(1);
        expect(mark.token.beginColumn).toBe(2);
    });

    test('Match deduplicates and sorts marks by token index', () => {
        const first = new TokenEntry('public', 1, 10, 'Foo.java', 1, 1);
        const second = new TokenEntry('public', 1, 20, 'Foo.java', 4, 1);
        const third = new TokenEntry('public', 1, 15, 'Foo.java', 2, 1);
        const match = new Match(5, new Mark(first), new Mark(second));

        match.addMark(third);
        match.addMark(third);

        expect(match.tokenCount).toBe(5);
        expect(match.markCount).toBe(3);
        expect(match.marks.map((mark) => mark.token.index)).toEqual([10, 15, 20]);
    });
});

describe('PMD MatchAlgorithm equivalents and edge cases', () => {
    test('detects a duplicate whose length equals the minimum tile size', () => {
        const matches = analyze(
            [
                token('A', 1),
                token('B', 1, 2),
                token('C', 1, 3),
                token('x', 1, 4),
                token('A', 2),
                token('B', 2, 2),
                token('C', 2, 3),
            ],
            3
        );

        expect(matches).toHaveLength(1);
        expect(matches[0].tokenCount).toBe(3);
        expect(matches[0].marks.map((mark) => mark.token.beginLine)).toEqual([1, 2]);
    });

    test('ignores duplicate spans shorter than the minimum tile size', () => {
        const matches = analyze(
            [
                token('A', 1),
                token('B', 1, 2),
                token('C', 1, 3),
                token('x', 1, 4),
                token('A', 2),
                token('B', 2, 2),
                token('C', 2, 3),
            ],
            4
        );

        expect(matches).toEqual([]);
    });

    test('does not match a window that would cross an explicit barrier', () => {
        const core = new CpdCore(4);
        core.addFile('with-barrier.dummy', [
            token('A', 1),
            token('B', 1, 2),
            barrier(1),
            token('C', 2),
            token('D', 2, 2),
        ]);
        core.addFile('contiguous.dummy', [token('A', 10), token('B', 10, 2), token('C', 10, 3), token('D', 10, 4)]);

        expect(core.analyze()).toEqual([]);
    });

    test('does not match a window that would cross a file EOF barrier', () => {
        const core = new CpdCore(4);
        core.addFile('first.dummy', [token('A', 1), token('B', 1, 2)]);
        core.addFile('second.dummy', [token('C', 1), token('D', 1, 2)]);
        core.addFile('contiguous.dummy', [token('A', 10), token('B', 10, 2), token('C', 10, 3), token('D', 10, 4)]);

        expect(core.analyze()).toEqual([]);
    });

    test('ignores overlapping self matches in a repeated run', () => {
        expect(analyze([token('A', 1), token('A', 1, 2), token('A', 1, 3), token('A', 1, 4)], 3)).toEqual([]);
    });

    test('merges three equal duplicate spans into one match with three marks', () => {
        const matches = analyze(
            [...repeatedWindow(2, 15), barrier(2), ...repeatedWindow(4, 15), barrier(4), ...repeatedWindow(6, 15)],
            15
        );

        expect(matches).toHaveLength(1);
        expect(matches[0].tokenCount).toBe(15);
        expect(matches[0].markCount).toBe(3);
        expect(matches[0].marks.map((mark) => mark.token.beginLine)).toEqual([2, 4, 6]);
    });

    test('reports the longest duplicate instead of nested shorter duplicates', () => {
        const matches = analyze(
            [
                token('A', 1),
                token('B', 1, 2),
                token('C', 1, 3),
                token('D', 1, 4),
                token('E', 1, 5),
                token('x', 1, 6),
                token('A', 2),
                token('B', 2, 2),
                token('C', 2, 3),
                token('D', 2, 4),
                token('E', 2, 5),
            ],
            3
        );

        expect(matches).toHaveLength(1);
        expect(matches[0].tokenCount).toBe(5);
    });

    test('sorts matches deterministically by length before shorter duplicates', () => {
        const matches = analyze(
            [
                token('A', 1),
                token('B', 1, 2),
                token('C', 1, 3),
                token('D', 1, 4),
                token('E', 1, 5),
                token('x', 1, 6),
                token('A', 2),
                token('B', 2, 2),
                token('C', 2, 3),
                token('D', 2, 4),
                token('E', 2, 5),
                token('y', 3),
                token('Q', 4),
                token('R', 4, 2),
                token('S', 4, 3),
                token('z', 4, 4),
                token('Q', 5),
                token('R', 5, 2),
                token('S', 5, 3),
            ],
            3
        );

        expect(matches.map((match) => match.tokenCount)).toEqual([5, 3]);
    });

    test('matches renamed code only when ignoreIdentifiers is enabled', () => {
        const left = 'function alpha(value: number) { return value + 1; }';
        const right = 'function beta(input: number) { return input + 1; }';

        const normalized = detectClonesFromSources([left, right], {
            minTileSize: 8,
            ignoreIdentifiers: true,
            ignoreLiterals: false,
        });
        const strict = detectClonesFromSources([left, right], {
            minTileSize: 8,
            ignoreIdentifiers: false,
            ignoreLiterals: false,
        });

        expect(normalized).toHaveLength(1);
        expect(strict).toHaveLength(0);
    });

    test('matches changed literals only when ignoreLiterals is enabled', () => {
        const left = 'const config = { retries: 2, url: "https://one.example" };';
        const right = 'const config = { retries: 5, url: "https://two.example" };';

        const normalized = detectClonesFromSources([left, right], {
            minTileSize: 10,
            ignoreIdentifiers: false,
            ignoreLiterals: true,
        });
        const strict = detectClonesFromSources([left, right], {
            minTileSize: 10,
            ignoreIdentifiers: false,
            ignoreLiterals: false,
        });

        expect(normalized).toHaveLength(1);
        expect(strict).toHaveLength(0);
    });

    test('does not report duplicates inside CPD-OFF and CPD-ON regions', () => {
        const source = `
            // CPD-OFF
            export function repeatedOne() { return 1 + 2 + 3 + 4; }
            export function repeatedTwo() { return 1 + 2 + 3 + 4; }
            // CPD-ON
            export function unique() { return 9; }
        `;

        const matches = detectClonesFromSources([source], {
            minTileSize: 8,
            ignoreIdentifiers: true,
            ignoreLiterals: true,
        });

        expect(matches).toHaveLength(0);
    });
});
