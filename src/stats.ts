/**
 * Aggregate duplication statistics over a finished analysis — the `N clones`,
 * duplicated-line count and overall percentage that jscpd reports. This is a
 * reporting concern layered on top of {@link Cpd}; the match engine (`core.ts`)
 * knows nothing about it.
 *
 * @packageDocumentation
 */
import type { Match } from './core';
import type { Cpd } from './index';

export interface DuplicationStats {
    /** Number of detected duplications (matches). */
    clones: number;
    /** Physical lines across all analyzed files (the percentage denominator). */
    totalLines: number;
    /** Distinct lines covered by at least one clone (overlaps counted once). */
    duplicatedLines: number;
    /** `duplicatedLines / totalLines * 100`, or 0 when nothing was analyzed. */
    percentage: number;
}

/**
 * Compute duplication stats. Duplicated lines are the union of every match's
 * occurrence ranges per file, so overlapping clones in the same file are not
 * double-counted. Line-based (not byte-exact to jscpd, which is not our etalon).
 */
export function computeStats(matches: Match[], cpd: Cpd): DuplicationStats {
    const coveredByFile = new Map<string, Set<number>>();
    for (const match of matches) {
        for (const mark of match.marks) {
            const location = cpd.locationForMark(mark, match.tokenCount);
            let covered = coveredByFile.get(location.path);
            if (covered === undefined) {
                covered = new Set<number>();
                coveredByFile.set(location.path, covered);
            }
            for (let line = location.startLine; line <= location.endLine; line++) {
                covered.add(line);
            }
        }
    }

    let duplicatedLines = 0;
    for (const covered of coveredByFile.values()) {
        duplicatedLines += covered.size;
    }

    const totalLines = cpd.totalLines();
    const percentage = totalLines > 0 ? (duplicatedLines / totalLines) * 100 : 0;
    return { clones: matches.length, totalLines, duplicatedLines, percentage };
}

/** A one-line summary, e.g. `12 clones · 4.23% duplicated lines`. */
export function formatStatsLine(stats: DuplicationStats): string {
    const noun = stats.clones === 1 ? 'clone' : 'clones';
    return `${stats.clones} ${noun} · ${stats.percentage.toFixed(2)}% duplicated lines`;
}
