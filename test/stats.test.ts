import { expect, test } from 'vitest';
import { Cpd } from '../src/index';
import { computeStats, formatStatsLine } from '../src/stats';

const DUP = `function shared() {
    const alpha = 1;
    const beta = 2;
    const gamma = 3;
    return alpha + beta + gamma;
}
`;

test('computeStats reports clones, total/duplicated lines and a consistent percentage', () => {
    const cpd = new Cpd({ minTileSize: 5 });
    // a.ts is exactly the shared block; b.ts has two unique lines before it.
    cpd.addSource('a.ts', DUP);
    cpd.addSource('b.ts', `const onlyB = 0;\nconst alsoB = 1;\n${DUP}`);
    const matches = cpd.run();

    const stats = computeStats(matches, cpd);

    expect(stats.clones).toBe(matches.length);
    expect(stats.clones).toBeGreaterThanOrEqual(1);
    // 6 lines in a.ts + 8 in b.ts (two extra lines, then the 6-line block).
    expect(stats.totalLines).toBe(14);
    expect(stats.duplicatedLines).toBeGreaterThan(0);
    expect(stats.duplicatedLines).toBeLessThanOrEqual(stats.totalLines);
    expect(stats.percentage).toBeCloseTo((stats.duplicatedLines / stats.totalLines) * 100, 10);
});

test('computeStats is empty when nothing duplicates', () => {
    const cpd = new Cpd({ minTileSize: 5 });
    cpd.addSource('a.ts', 'export const x = 1;\n');
    cpd.addSource('b.ts', 'export const y = 2;\n');

    const stats = computeStats(cpd.run(), cpd);

    expect(stats.clones).toBe(0);
    expect(stats.duplicatedLines).toBe(0);
    expect(stats.percentage).toBe(0);
    expect(stats.totalLines).toBe(2);
});

test('formatStatsLine pluralizes and fixes the percentage to two decimals', () => {
    expect(formatStatsLine({ clones: 1, totalLines: 10, duplicatedLines: 5, percentage: 50 })).toBe(
        '1 clone · 50.00% duplicated lines'
    );
    expect(formatStatsLine({ clones: 3, totalLines: 100, duplicatedLines: 12, percentage: 12 })).toBe(
        '3 clones · 12.00% duplicated lines'
    );
});
