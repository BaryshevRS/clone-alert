/**
 * Language-agnostic CPD core. Operates on a flat stream of tokens supplied by
 * the tokenizers (see tokenizers.ts) as `RawToken[]`.
 *
 * Token storage is struct-of-arrays over typed arrays (`Int32Array`): instead of
 * ~N `TokenEntry` objects we keep parallel numeric columns. Full `TokenEntry`
 * objects are materialized lazily, only for the marks that land in a match.
 *
 * @packageDocumentation
 */

/**
 * Normalization sentinel prefix, taken from the Unicode private-use area so it
 * is guaranteed never to collide with real source token images. Framework token
 * namespaces (Angular/Vue/Svelte) live in their own extension modules
 * (src/angular.ts, etc.) and are built on top of this shared sentinel.
 */
export const S = '\uE000';
/** Normalized identifier (TS). */
export const TS_ID = `${S}ID`;
/** Normalized literal (TS). */
export const TS_LIT = `${S}LIT`;

/** A raw token as emitted by a tokenizer, before it is interned into the core. */
export interface RawToken {
    image: string;
    /** 1-based. */
    line: number;
    /** 1-based. */
    column: number;
    /** 1-based, PMD-style token end position. */
    endLine?: number;
    /** 1-based, PMD-style exclusive end column. */
    endColumn?: number;
    /** Forced break; inserts an EOF token (id 0) so matches cannot span it. */
    barrier?: boolean;
}

/** A fully materialized token with its image, interned id, and source location. */
export class TokenEntry {
    constructor(
        public image: string,
        public identifier: number,
        public index: number,
        public file: string,
        public beginLine: number,
        public beginColumn: number,
        public endLine: number = beginLine,
        public endColumn: number = beginColumn
    ) {}
}

/** A single occurrence of a duplicated span, anchored at its starting token. */
export class Mark {
    constructor(public token: TokenEntry) {}
}

/** A set of marks that share an identical duplicated token span. */
export class Match {
    /** Dedupe by token index (PMD uses a TreeSet keyed by index, not by reference). */
    private markMap = new Map<number, Mark>();
    /**
     * Cache of sorted marks. The `marks` getter is hit millions of times in the
     * hot reportMatch path; without the cache every call did Array.from + sort.
     * Invalidated only in addMark, i.e. when the mark set actually changes.
     */
    private marksSorted: Mark[] | null = null;

    constructor(
        public tokenCount: number,
        first: Mark,
        second: Mark
    ) {
        this.markMap.set(first.token.index, first);
        this.markMap.set(second.token.index, second);
    }

    addMark(entry: TokenEntry) {
        if (!this.markMap.has(entry.index)) {
            this.markMap.set(entry.index, new Mark(entry));
            this.marksSorted = null;
        }
    }

    get markCount(): number {
        return this.markMap.size;
    }

    get marks(): Mark[] {
        if (this.marksSorted === null) {
            this.marksSorted = Array.from(this.markMap.values()).sort((a, b) => a.token.index - b.token.index);
        }
        return this.marksSorted;
    }
}

/** The duplicate-detection engine: ingests token streams and reports matches. */
export class CpdCore {
    // Token columns (struct-of-arrays). Grown geometrically in ensureCapacity().
    private ids = new Int32Array(0); // interned image; 0 == EOF/barrier
    private fileIds = new Int32Array(0);
    private beginLines = new Int32Array(0);
    private beginColumns = new Int32Array(0);
    private endLines = new Int32Array(0);
    private endColumns = new Int32Array(0);
    private size = 0;
    private capacity = 0;

    // Interning tables: id -> string. idImages[0] == '' (EOF).
    private imageToId = new Map<string, number>();
    private idImages: string[] = [''];
    private fileToId = new Map<string, number>();
    private fileNames: string[] = [];

    constructor(private minTileSize: number = 50) {}

    private intern(image: string): number {
        let id = this.imageToId.get(image);
        if (id === undefined) {
            id = this.idImages.length;
            this.imageToId.set(image, id);
            this.idImages.push(image);
        }
        return id;
    }

    private fileId(file: string): number {
        let id = this.fileToId.get(file);
        if (id === undefined) {
            id = this.fileNames.length;
            this.fileToId.set(file, id);
            this.fileNames.push(file);
        }
        return id;
    }

    private ensureCapacity(extra: number) {
        const need = this.size + extra;
        if (need <= this.capacity) return;
        let cap = this.capacity === 0 ? 1024 : this.capacity;
        while (cap < need) cap *= 2;
        this.ids = growInt32(this.ids, cap);
        this.fileIds = growInt32(this.fileIds, cap);
        this.beginLines = growInt32(this.beginLines, cap);
        this.beginColumns = growInt32(this.beginColumns, cap);
        this.endLines = growInt32(this.endLines, cap);
        this.endColumns = growInt32(this.endColumns, cap);
        this.capacity = cap;
    }

    private pushToken(id: number, fileId: number, bl: number, bc: number, el: number, ec: number) {
        const i = this.size++;
        this.ids[i] = id;
        this.fileIds[i] = fileId;
        this.beginLines[i] = bl;
        this.beginColumns[i] = bc;
        this.endLines[i] = el;
        this.endColumns[i] = ec;
    }

    /** Add one file's token stream. An EOF barrier is always appended at the end. */
    public addFile(file: string, raw: RawToken[]) {
        const fileId = this.fileId(file);
        this.ensureCapacity(raw.length + 1);
        for (const r of raw) {
            if (r.barrier) {
                this.pushToken(0, fileId, r.line, r.column, r.line, r.column);
                continue;
            }
            this.pushToken(
                this.intern(r.image),
                fileId,
                r.line,
                r.column,
                r.endLine ?? r.line,
                r.endColumn ?? r.column
            );
        }
        this.pushToken(0, fileId, 0, 0, 0, 0); // EOF
    }

    public get tokenCount(): number {
        return this.size;
    }

    /** Raw access to the id column for the collector's hot loops (module-internal). */
    public get idColumn(): Int32Array {
        return this.ids;
    }

    /** Materialize a TokenEntry by absolute index. Returns undefined when out of range. */
    public entryAt(index: number): TokenEntry | undefined {
        if (index < 0 || index >= this.size) return undefined;
        const id = this.ids[index];
        return new TokenEntry(
            this.idImages[id],
            id,
            index,
            this.fileNames[this.fileIds[index]],
            this.beginLines[index],
            this.beginColumns[index],
            this.endLines[index],
            this.endColumns[index]
        );
    }

    public analyze(): Match[] {
        if (this.size < this.minTileSize) return [];

        const { markIndices, markHashes, markCount } = this.hash();
        if (markCount === 0) return [];

        // Group by equal hash. This used to be a comparator sort over a boxed
        // number[] — the most expensive part of the core (O(n log n) with a
        // megamorphic closure over 3.4M items). Now it is a stable LSD radix sort
        // by the 32-bit hash on a Uint32Array: O(n) linear passes, no closures, no
        // boxing. markIndices is strictly decreasing (hash() walks right-to-left),
        // so the initial permutation by ascending index is a reversal; radix
        // stability preserves ascending index within an equal hash (required by
        // MatchCollector.collect).
        const order = radixSortByHash(markHashes, markCount);

        const collector = new MatchCollector(this, this.minTileSize);
        let start = 0;
        while (start < markCount) {
            const h = markHashes[order[start]];
            let end = start + 1;
            while (end < markCount && markHashes[order[end]] === h) end++;
            if (end - start > 1) {
                // The run is already sorted by ascending index (the sort tie-break).
                const group = new Int32Array(end - start);
                for (let k = start; k < end; k++) group[k - start] = markIndices[order[k]];
                collector.collect(group);
            }
            start = end;
        }

        const matches = collector.getMatches();

        // Deterministic report order. Does not affect detection. For a line-by-line
        // diff against PMD, sort both dumps by (file, line) instead.
        matches.sort((a, b) => {
            const byLen = b.tokenCount - a.tokenCount;
            if (byLen !== 0) return byLen;
            const byMarks = b.markCount - a.markCount;
            if (byMarks !== 0) return byMarks;
            return a.marks[0].token.index - b.marks[0].token.index;
        });

        return matches;
    }

    // Karp-Rabin sliding window, right-to-left. All arithmetic is 32-bit (| 0 /
    // Math.imul); float64 would produce hashes different from the Java original.
    //
    // Returns parallel columns (token index, its hash) ordered by descending index
    // — the same mark set the Java original distributed across buckets.
    private hash(): { markIndices: Int32Array; markHashes: Int32Array; markCount: number } {
        const ids = this.ids;
        const n = this.size;
        const MOD = 37;
        let lastMod = 1;
        for (let i = 0; i < this.minTileSize; i++) {
            lastMod = Math.imul(lastMod, MOD);
        }

        let lastHash = 0;
        const markIndices = new Int32Array(n);
        const markHashes = new Int32Array(n);
        let m = 0;

        for (let i = n - 1; i >= 0; i--) {
            if (ids[i] !== 0) {
                const aheadIndex = i + this.minTileSize;
                const last = aheadIndex < n ? ids[aheadIndex] : 0;

                lastHash = (Math.imul(MOD, lastHash) + ids[i] - Math.imul(lastMod, last)) | 0;

                markIndices[m] = i;
                markHashes[m] = lastHash;
                m++;
            } else {
                // EOF/barrier: reset the hash and skip the minTileSize-1 positions
                // before it (their windows would cross the boundary). The warm-up
                // advances the OUTER i.
                lastHash = 0;
                const end = Math.max(0, i - this.minTileSize + 1);
                for (; i > end; i--) {
                    const id = ids[i - 1];
                    lastHash = (Math.imul(MOD, lastHash) + id) | 0;
                    if (id === 0) break;
                }
            }
        }
        return { markIndices, markHashes, markCount: m };
    }
}

function growInt32(src: Int32Array, capacity: number): Int32Array<ArrayBuffer> {
    const dst = new Int32Array(capacity);
    dst.set(src);
    return dst;
}

// Stable LSD radix sort of the permutation [0..count) by key markHashes[pos].
// Order is by ascending signed hash; on equal hashes stability preserves the
// order of the starting permutation. We start from positions in descending order
// (count-1..0): because markHashes/markIndices run by descending token index,
// this yields ascending index within every equal-hash group. 4 byte passes
// instead of an O(n log n) comparator over a boxed number[].
function radixSortByHash(markHashes: Int32Array, count: number): Uint32Array {
    // Signed int32 -> monotonic uint32 (flip the top bit) so the byte-wise radix
    // produces a correct signed order.
    const keys = new Uint32Array(count);
    for (let i = 0; i < count; i++) keys[i] = (markHashes[i] ^ 0x80000000) >>> 0;

    let src = new Uint32Array(count);
    for (let i = 0; i < count; i++) src[i] = count - 1 - i;
    let dst = new Uint32Array(count);
    const counts = new Int32Array(257);

    for (let shift = 0; shift < 32; shift += 8) {
        counts.fill(0);
        for (let i = 0; i < count; i++) counts[((keys[src[i]] >>> shift) & 0xff) + 1]++;
        for (let b = 0; b < 256; b++) counts[b + 1] += counts[b];
        for (let i = 0; i < count; i++) {
            const p = src[i];
            dst[counts[(keys[p] >>> shift) & 0xff]++] = p;
        }
        const tmp = src;
        src = dst;
        dst = tmp;
    }
    return src;
}

// Port of MatchCollector.java with no change to the algorithm (it is correct).
// Marks are represented by the absolute token index (number); positions and ids
// are read from the SoA columns.
class MatchCollector {
    private matchTree = new Map<number, Match[]>();
    private tokenMatchSets = new Map<number, Set<number>>();
    private ids: Int32Array;
    private tokenCount: number;

    constructor(
        private ma: CpdCore,
        private minTileSize: number
    ) {
        this.ids = ma.idColumn;
        this.tokenCount = ma.tokenCount;
    }

    public collect(marks: Int32Array) {
        let skipped = 0;
        for (let i = 0; i < marks.length - 1; i += skipped + 1) {
            skipped = 0;
            const mark1 = marks[i];
            for (let j = i + 1; j < marks.length; j++) {
                const mark2 = marks[j];
                const diff = mark1 - mark2;

                if (-diff < this.minTileSize) {
                    skipped++;
                    continue;
                }
                if (this.hasPreviousDupe(mark1, mark2)) {
                    continue;
                }

                const dupes = this.countDuplicateTokens(mark1, mark2);
                if (dupes < this.minTileSize) {
                    continue;
                }
                if (diff + dupes >= 1) {
                    continue; // self-overlap
                }
                this.reportMatch(mark1, mark2, dupes);
            }
        }
    }

    private reportMatch(mark1: number, mark2: number, dupes: number) {
        if (this.tokenMatchSets.get(mark1)?.has(mark2)) {
            return;
        }

        let lowestKey = mark1;
        const set1 = this.tokenMatchSets.get(mark1);
        if (set1) {
            for (const key of set1) {
                if (key < lowestKey) lowestKey = key;
            }
        }

        let matches = this.matchTree.get(lowestKey);
        if (!matches) {
            matches = [];
            this.matchTree.set(lowestKey, matches);
        }

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            for (const otherMark of m.marks) {
                const otherEnd = otherMark.token.index;
                if (otherEnd === mark1) continue;

                if (otherEnd < mark2 && otherEnd + m.tokenCount >= mark2 + dupes) {
                    return; // nested inside an existing match
                } else if (mark2 < otherEnd && mark2 + dupes >= otherEnd + m.tokenCount) {
                    matches.splice(i, 1); // replace it
                    i--;
                    break;
                } else if (dupes === m.tokenCount) {
                    for (const other of m.marks) {
                        this.registerTokenMatch(other.token.index, mark2);
                    }
                    m.addMark(this.entry(mark2));
                    return;
                }
            }
        }

        matches.push(new Match(dupes, new Mark(this.entry(mark1)), new Mark(this.entry(mark2))));
        this.registerTokenMatch(mark1, mark2);
    }

    // Materialize a TokenEntry for a mark. The index is guaranteed in range (marks
    // come from the token stream), so undefined is impossible here.
    private entry(index: number): TokenEntry {
        const entry = this.ma.entryAt(index);
        if (!entry) throw new Error(`token index out of range: ${index}`);
        return entry;
    }

    private registerTokenMatch(mark1: number, mark2: number) {
        let s1 = this.tokenMatchSets.get(mark1);
        if (!s1) {
            s1 = new Set();
            this.tokenMatchSets.set(mark1, s1);
        }
        let s2 = this.tokenMatchSets.get(mark2);
        if (!s2) {
            s2 = new Set();
            this.tokenMatchSets.set(mark2, s2);
        }
        s1.add(mark2);
        s2.add(mark1);
    }

    public getMatches(): Match[] {
        const result: Match[] = [];
        for (const matches of this.matchTree.values()) {
            result.push(...matches);
        }
        return result;
    }

    private hasPreviousDupe(mark1: number, mark2: number): boolean {
        if (mark1 === 0) return false;
        return !this.matchEnded(mark1 - 1, mark2 - 1);
    }

    private countDuplicateTokens(mark1: number, mark2: number): number {
        let index = 0;
        for (;;) {
            if (this.matchEnded(mark1 + index, mark2 + index)) break;
            index++;
        }
        return index;
    }

    // True once the windows diverge: one of the indices is out of range, the ids
    // differ, or it is EOF (id === 0). Equivalent to matchEnded(token1, token2) on
    // TokenEntry.
    private matchEnded(a: number, b: number): boolean {
        if (a < 0 || b < 0 || a >= this.tokenCount || b >= this.tokenCount) return true;
        const id1 = this.ids[a];
        const id2 = this.ids[b];
        return id1 !== id2 || id1 === 0 || id2 === 0;
    }
}
