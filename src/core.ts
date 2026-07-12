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
     * addMark appends in place when the new index is above the current maximum
     * (the common case: within a hash group marks arrive in ascending order);
     * otherwise it invalidates and the next `marks` call re-sorts.
     */
    private marksSorted: Mark[] | null = null;
    /** Smallest token index among the marks (PMD's lowest key of the clique). */
    public lowestMark: number;

    constructor(
        public tokenCount: number,
        first: Mark,
        second: Mark
    ) {
        this.markMap.set(first.token.index, first);
        this.markMap.set(second.token.index, second);
        this.lowestMark = Math.min(first.token.index, second.token.index);
    }

    addMark(entry: TokenEntry) {
        if (!this.markMap.has(entry.index)) {
            const mark = new Mark(entry);
            this.markMap.set(entry.index, mark);
            if (entry.index < this.lowestMark) this.lowestMark = entry.index;
            const sorted = this.marksSorted;
            if (sorted !== null) {
                if (sorted[sorted.length - 1].token.index < entry.index) {
                    sorted.push(mark);
                } else {
                    this.marksSorted = null;
                }
            }
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

    /** Interned image of the token at an absolute index. Caller guarantees range. */
    public imageAt(index: number): string {
        return this.idImages[this.ids[index]];
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

// Is there a mark with token index in [lo, hi], other than `excl`? `marks` is
// sorted by ascending index; lower-bound binary search, then at most two probes
// (only one mark can equal `excl`).
function hasMarkBetween(marks: Mark[], lo: number, hi: number, excl: number): boolean {
    let a = 0;
    let b = marks.length;
    while (a < b) {
        const mid = (a + b) >> 1;
        if (marks[mid].token.index < lo) a = mid + 1;
        else b = mid;
    }
    if (a >= marks.length || marks[a].token.index > hi) return false;
    if (marks[a].token.index !== excl) return true;
    return a + 1 < marks.length && marks[a + 1].token.index <= hi;
}

// Port of MatchCollector.java with no change to the algorithm (it is correct).
// Marks are represented by the absolute token index (number); positions and ids
// are read from the SoA columns.
//
// One deliberate divergence in DATA STRUCTURE (not in output): PMD's
// tokenMatchSets stores every reported pair explicitly — for a clone class of m
// occurrences that is O(m^2) Set entries (each new mark is registered against
// every existing mark). In normalize mode (--ignore-identifiers /
// --ignore-literals) classes reach tens of thousands of occurrences and the pair
// sets alone exhaust the heap. Here the same relation is stored as match
// MEMBERSHIP: a pair (a, b) is "registered" iff a and b share a Match (including
// matches later spliced out of the tree — PMD's ghost pairs survive the splice
// too; the memberships of the removed match keep referencing it, which preserves
// that), and the lowest key of a mark's partner set is the min over its matches'
// lowestMark. Both predicates are identical to PMD's pair-set semantics: all
// pairs within a match are always mutually registered (creation registers the
// first two marks; every extension registers the newcomer against all existing
// marks), and no other pairs ever are. Memory per class drops from O(m^2) to
// O(m) while the reported matches stay byte-identical.
//
// The membership store is scoped PER GROUP (per collect() call), keyed by the
// mark's position inside the group, in flat parallel arrays. That is sound
// because a mark occurs in exactly one hash group, every report (mark1, mark2)
// happens inside the group containing both, and a matchTree key can only ever be
// shared by reports of one group (the key is itself a mark of that group) — so a
// match never spans groups and memberships never need to outlive collect().
class MatchCollector {
    private matchTree = new Map<number, Match[]>();
    private ids: Int32Array;
    private tokenCount: number;
    // Per-group membership columns, indexed by group position. firstMatch holds
    // the (almost always single) match; extraMatches spills the rare positions
    // that belong to several matches of different lengths.
    private firstMatch: (Match | null)[] = [];
    private extraMatches = new Map<number, Match[]>();

    constructor(
        private ma: CpdCore,
        private minTileSize: number
    ) {
        this.ids = ma.idColumn;
        this.tokenCount = ma.tokenCount;
    }

    public collect(marks: Int32Array) {
        const k = marks.length;
        const firstMatch: (Match | null)[] = new Array(k).fill(null);
        this.firstMatch = firstMatch;
        this.extraMatches.clear();

        let skipped = 0;
        for (let i = 0; i < k - 1; i += skipped + 1) {
            skipped = 0;
            const mark1 = marks[i];
            for (let j = i + 1; j < k; j++) {
                const mark2 = marks[j];
                const diff = mark1 - mark2;

                if (-diff < this.minTileSize) {
                    skipped++;
                    continue;
                }
                if (this.hasPreviousDupe(mark1, mark2)) {
                    continue;
                }
                // Already-registered pairs would fall out of reportMatch as a
                // no-op anyway (countDuplicateTokens is deterministic, so the
                // guards between here and that early return decide the same way
                // they did on the first report). Checking before the O(len) token
                // scan turns the re-visits of a large clone class from
                // O(k^2 * len) into O(k^2) pointer compares.
                if (this.isPairRegistered(i, j)) {
                    continue;
                }

                const dupes = this.countDuplicateTokens(mark1, mark2);
                if (dupes < this.minTileSize) {
                    continue;
                }
                if (diff + dupes >= 1) {
                    continue; // self-overlap
                }
                this.reportMatch(mark1, mark2, dupes, i, j);
            }
        }
    }

    private reportMatch(mark1: number, mark2: number, dupes: number, pos1: number, pos2: number) {
        // PMD: lowestKey = min(mark1, partners of mark1). A mark's partners are
        // exactly the marks of the matches it belongs to, so the min over their
        // lowestMark is the same value.
        let lowestKey = mark1;
        const first = this.firstMatch[pos1];
        if (first !== null) {
            if (first.lowestMark < lowestKey) lowestKey = first.lowestMark;
            const extra = this.extraMatches.get(pos1);
            if (extra) {
                for (const m of extra) {
                    if (m.lowestMark < lowestKey) lowestKey = m.lowestMark;
                }
            }
        }

        let matches = this.matchTree.get(lowestKey);
        if (!matches) {
            matches = [];
            this.matchTree.set(lowestKey, matches);
        }

        // PMD scans every mark of every match here (three positional checks per
        // mark, first hit decides). The checks are interval tests over the sorted
        // mark indices and are mutually exclusive by match length, so each match
        // resolves with one binary search instead of an O(markCount) walk — same
        // outcome, and in normalize mode this loop went over 10^10 mark visits.
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const len = m.tokenCount;
            if (len === dupes) {
                // Nested/replace are unsatisfiable at equal length, so PMD's scan
                // always takes this branch at its first mark != mark1 (a match
                // has >= 2 distinct marks, so one exists). PMD registers mark2
                // against every existing mark here; with the membership encoding,
                // adding the match to mark2's memberships establishes all those
                // pairs at once.
                this.addMembership(pos2, m);
                m.addMark(this.entry(mark2));
                return;
            }
            if (len > dupes) {
                // Nested inside an existing match: some mark (other than mark1)
                // lies in [mark2 + dupes - len, mark2 - 1].
                if (hasMarkBetween(m.marks, mark2 + dupes - len, mark2 - 1, mark1)) {
                    return;
                }
            } else if (hasMarkBetween(m.marks, mark2 + 1, mark2 + dupes - len, -1)) {
                // The new span covers the existing match: replace it. (mark1 is
                // never in this interval — it is below mark2.)
                matches.splice(i, 1);
                i--;
            }
        }

        const match = new Match(dupes, new Mark(this.entry(mark1)), new Mark(this.entry(mark2)));
        matches.push(match);
        this.addMembership(pos1, match);
        this.addMembership(pos2, match);
    }

    // Materialize a TokenEntry for a mark. The index is guaranteed in range (marks
    // come from the token stream), so undefined is impossible here.
    private entry(index: number): TokenEntry {
        const entry = this.ma.entryAt(index);
        if (!entry) throw new Error(`token index out of range: ${index}`);
        return entry;
    }

    // "Pair is registered" == the marks share a match. Positions almost always
    // belong to at most one match, so this is one pointer compare in the hot loop.
    private isPairRegistered(pos1: number, pos2: number): boolean {
        const f1 = this.firstMatch[pos1];
        if (f1 === null) return false;
        const f2 = this.firstMatch[pos2];
        if (f2 === null) return false;
        if (f1 === f2) return true;
        if (this.extraMatches.size === 0) return false;
        const e1 = this.extraMatches.get(pos1);
        if (e1 && (e1.includes(f2) || e1.some((m) => this.extraMatches.get(pos2)?.includes(m)))) return true;
        const e2 = this.extraMatches.get(pos2);
        return e2 !== undefined && e2.includes(f1);
    }

    private addMembership(pos: number, match: Match) {
        const first = this.firstMatch[pos];
        if (first === null) {
            this.firstMatch[pos] = match;
        } else {
            const extra = this.extraMatches.get(pos);
            if (extra) {
                extra.push(match);
            } else {
                this.extraMatches.set(pos, [match]);
            }
        }
    }

    public getMatches(): Match[] {
        const result: Match[] = [];
        for (const matches of this.matchTree.values()) {
            result.push(...matches);
        }
        return result;
    }

    // Inlined matchEnded(mark1-1, mark2-1). Within a bucket mark2 > mark1, so when
    // mark1 > 0 both predecessors are valid indices in [0, tokenCount) — no bounds
    // check needed. !matchEnded reduces to "ids equal and not EOF".
    private hasPreviousDupe(mark1: number, mark2: number): boolean {
        if (mark1 === 0) return false;
        const id1 = this.ids[mark1 - 1];
        const id2 = this.ids[mark2 - 1];
        return id1 === id2 && id1 !== 0;
    }

    // Inlined matchEnded in the hot scan. Bounds checks are unnecessary: every file
    // ends with an EOF sentinel (id 0) that marks never sit on, so the larger index
    // (mark2) reads a 0 and breaks before running off the end. (An out-of-range
    // typed-array read yields undefined and also breaks, so the tail is safe.)
    // id2 === 0 needs no separate test: if id1 === id2 === 0 the id1 === 0 test fires.
    private countDuplicateTokens(mark1: number, mark2: number): number {
        const ids = this.ids;
        let index = 0;
        for (;;) {
            const id1 = ids[mark1 + index];
            const id2 = ids[mark2 + index];
            if (id1 !== id2 || id1 === 0) break;
            index++;
        }
        return index;
    }
}
