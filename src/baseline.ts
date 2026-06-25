/**
 * Baseline support for the CLI: the content-fingerprint hash plus reading and
 * writing the baseline JSON file. This is purely an adoption/CI concern, kept out
 * of the core engine (a faithful PMD port) and the tokenizers.
 *
 * @packageDocumentation
 */
import * as fs from 'node:fs';
import type { Cpd, Match } from './index';

/** One accepted clone, as persisted in the baseline file. */
export interface CloneRecord {
    fingerprint: string;
    tokens: number;
    files: string[];
}

/**
 * Stable content fingerprint of a match: see {@link hashImages}. Both occurrences
 * of a match share identical span content, so the choice of mark does not matter.
 */
export function fingerprint(cpd: Cpd, match: Match): string {
    return hashImages(cpd.spanImages(match));
}

/**
 * 64-bit hash (16 hex chars) over the token *images* only — no file path, no
 * line/column — so it is unchanged when the duplicated code moves within or
 * between files. Deterministic across runs and machines (a pure function of the
 * image strings). A boundary byte between tokens keeps `["ab","c"]` distinct from
 * `["a","bc"]`.
 */
function hashImages(images: string[]): string {
    let a = 0x811c9dc5 | 0; // FNV-1a basis
    let b = 0x85ebca6b | 0; // second lane, distinct multiplier
    for (const image of images) {
        for (let c = 0; c < image.length; c++) {
            const ch = image.charCodeAt(c);
            a = Math.imul(a ^ ch, 0x01000193);
            b = Math.imul(b ^ ch, 0xc2b2ae35);
        }
        a = Math.imul(a ^ 0xff, 0x01000193);
        b = Math.imul(b ^ 0xff, 0xc2b2ae35);
    }
    return toHex8(a) + toHex8(b);
}

function toHex8(h: number): string {
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprints of every clone recorded in the baseline file. */
export function readBaseline(baselinePath: string): Set<string> {
    if (!fs.existsSync(baselinePath)) {
        throw new Error(`baseline file not found: ${baselinePath} (run with --update-baseline to create it)`);
    }
    let parsed: { clones?: { fingerprint?: string }[] };
    try {
        parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    } catch {
        throw new Error(`baseline file is not valid JSON: ${baselinePath}`);
    }
    const fingerprints = new Set<string>();
    for (const clone of parsed.clones ?? []) {
        if (clone.fingerprint) fingerprints.add(clone.fingerprint);
    }
    return fingerprints;
}

/**
 * Serialize the accepted clones to the baseline file. Entries are sorted by
 * fingerprint and carry no line/column, so the file stays a stable, reviewable,
 * churn-free diff as long as the duplicated content itself does not change.
 */
export function writeBaseline(baselinePath: string, clones: CloneRecord[]): void {
    const sorted = [...clones].sort((x, y) =>
        x.fingerprint < y.fingerprint ? -1 : x.fingerprint > y.fingerprint ? 1 : 0
    );
    fs.writeFileSync(baselinePath, `${JSON.stringify({ version: 1, clones: sorted }, null, 2)}\n`);
}
