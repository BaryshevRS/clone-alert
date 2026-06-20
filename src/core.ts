// core.ts
// Ядро CPD, language-agnostic. Работает с плоским потоком токенов.
// Токены поставляют токенайзеры (см. tokenizers.ts) в виде RawToken[].

// Сентинелы нормализации. Префикс из private-use области Unicode,
// чтобы гарантированно не пересекаться с реальными образами исходника.
export const S = '\uE000';
export const TS_ID = `${S}ID`; // нормализованный идентификатор (TS)
export const TS_LIT = `${S}LIT`; // нормализованный литерал (TS)
export const NG_TEXT = `${S}NGTEXT`; // статический текст шаблона
export const NG_INTERP = `${S}NGINTERP`; // интерполяция/binding шаблона

export interface RawToken {
    image: string;
    line: number; // 1-based
    column: number; // 1-based
    barrier?: boolean; // принудительный разрыв (вставит EOF-токен с id 0)
}

export class TokenEntry {
    constructor(
        public image: string,
        public identifier: number,
        public index: number,
        public file: string,
        public beginLine: number,
        public beginColumn: number
    ) {}
}

export class Mark {
    constructor(public token: TokenEntry) {}
}

export class Match {
    // Дедуп по индексу токена (PMD использует TreeSet по index, а не по ссылке).
    private markMap = new Map<number, Mark>();

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
        }
    }

    get markCount(): number {
        return this.markMap.size;
    }

    get marks(): Mark[] {
        return Array.from(this.markMap.values()).sort((a, b) => a.token.index - b.token.index);
    }
}

export class CpdCore {
    public tokens: TokenEntry[] = [];
    private imageToId = new Map<string, number>();
    private currentImageId = 1; // 0 зарезервирован под EOF/барьер

    constructor(private minTileSize: number = 50) {}

    private intern(image: string): number {
        let id = this.imageToId.get(image);
        if (id === undefined) {
            id = this.currentImageId++;
            this.imageToId.set(image, id);
        }
        return id;
    }

    private pushEof(file: string, line: number, column: number) {
        this.tokens.push(new TokenEntry('', 0, this.tokens.length, file, line, column));
    }

    /** Добавить поток токенов одного файла. В конце всегда вставляется EOF-барьер. */
    public addFile(file: string, raw: RawToken[]) {
        for (const r of raw) {
            if (r.barrier) {
                this.pushEof(file, r.line, r.column);
                continue;
            }
            this.tokens.push(new TokenEntry(r.image, this.intern(r.image), this.tokens.length, file, r.line, r.column));
        }
        this.pushEof(file, 0, 0);
    }

    public tokenAt(offset: number, m: TokenEntry): TokenEntry | undefined {
        return this.tokens[offset + m.index];
    }

    public analyze(): Match[] {
        if (this.tokens.length < this.minTileSize) return [];

        const markGroups = this.hash();

        const collector = new MatchCollector(this, this.minTileSize);
        for (const group of markGroups.values()) {
            if (group.length > 1) {
                group.reverse(); // Collections.reverse(l): приводим к возрастанию index
                collector.collect(group);
            }
        }

        const matches = collector.getMatches();

        // Детерминированный порядок отчёта. На детекцию не влияет.
        // Для построчного дифф-теста с PMD лучше сортировать обе выгрузки по (file,line).
        matches.sort((a, b) => {
            const byLen = b.tokenCount - a.tokenCount;
            if (byLen !== 0) return byLen;
            const byMarks = b.markCount - a.markCount;
            if (byMarks !== 0) return byMarks;
            return a.marks[0].token.index - b.marks[0].token.index;
        });

        return matches;
    }

    // Karp-Rabin, скользящее окно справа налево. Вся арифметика 32-bit (| 0 / Math.imul),
    // иначе float64 даст хеши, отличные от Java-оригинала.
    private hash(): Map<number, TokenEntry[]> {
        const MOD = 37;
        let lastMod = 1;
        for (let i = 0; i < this.minTileSize; i++) {
            lastMod = Math.imul(lastMod, MOD);
        }

        let lastHash = 0;
        const markGroups = new Map<number, TokenEntry[]>();

        for (let i = this.tokens.length - 1; i >= 0; i--) {
            let token = this.tokens[i];

            if (token.identifier !== 0) {
                const ahead = this.tokenAt(this.minTileSize, token);
                const last = ahead ? ahead.identifier : 0;

                lastHash = (Math.imul(MOD, lastHash) + token.identifier - Math.imul(lastMod, last)) | 0;

                let bucket = markGroups.get(lastHash);
                if (!bucket) {
                    bucket = [];
                    markGroups.set(lastHash, bucket);
                }
                bucket.push(token);
            } else {
                // EOF/барьер: сбрасываем хеш и пропускаем minTileSize-1 позиций перед ним
                // (их окна пересекали бы границу). Прогрев двигает ВНЕШНИЙ i.
                lastHash = 0;
                const end = Math.max(0, i - this.minTileSize + 1);
                for (; i > end; i--) {
                    token = this.tokens[i - 1];
                    lastHash = (Math.imul(MOD, lastHash) + token.identifier) | 0;
                    if (token.identifier === 0) break;
                }
            }
        }
        return markGroups;
    }
}

// Перенос MatchCollector.java без изменений в алгоритме (он корректен).
class MatchCollector {
    private matchTree = new Map<number, Match[]>();
    private tokenMatchSets = new Map<number, Set<number>>();

    constructor(
        private ma: CpdCore,
        private minTileSize: number
    ) {}

    public collect(marks: TokenEntry[]) {
        let skipped = 0;
        for (let i = 0; i < marks.length - 1; i += skipped + 1) {
            skipped = 0;
            const mark1 = marks[i];
            for (let j = i + 1; j < marks.length; j++) {
                const mark2 = marks[j];
                const diff = mark1.index - mark2.index;

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
                    continue; // самоперекрытие
                }
                this.reportMatch(mark1, mark2, dupes);
            }
        }
    }

    private reportMatch(mark1: TokenEntry, mark2: TokenEntry, dupes: number) {
        if (this.tokenMatchSets.get(mark1.index)?.has(mark2.index)) {
            return;
        }

        let lowestKey = mark1.index;
        const set1 = this.tokenMatchSets.get(mark1.index);
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
                const otherEnd = otherMark.token;
                if (otherEnd.index === mark1.index) continue;

                if (otherEnd.index < mark2.index && otherEnd.index + m.tokenCount >= mark2.index + dupes) {
                    return; // вложен в существующий
                } else if (mark2.index < otherEnd.index && mark2.index + dupes >= otherEnd.index + m.tokenCount) {
                    matches.splice(i, 1); // заменяем
                    i--;
                    break;
                } else if (dupes === m.tokenCount) {
                    for (const other of m.marks) {
                        this.registerTokenMatch(other.token, mark2);
                    }
                    m.addMark(mark2);
                    return;
                }
            }
        }

        matches.push(new Match(dupes, new Mark(mark1), new Mark(mark2)));
        this.registerTokenMatch(mark1, mark2);
    }

    private registerTokenMatch(mark1: TokenEntry, mark2: TokenEntry) {
        let s1 = this.tokenMatchSets.get(mark1.index);
        if (!s1) {
            s1 = new Set();
            this.tokenMatchSets.set(mark1.index, s1);
        }
        let s2 = this.tokenMatchSets.get(mark2.index);
        if (!s2) {
            s2 = new Set();
            this.tokenMatchSets.set(mark2.index, s2);
        }
        s1.add(mark2.index);
        s2.add(mark1.index);
    }

    public getMatches(): Match[] {
        const result: Match[] = [];
        for (const matches of this.matchTree.values()) {
            result.push(...matches);
        }
        return result;
    }

    private hasPreviousDupe(mark1: TokenEntry, mark2: TokenEntry): boolean {
        if (mark1.index === 0) return false;
        const t1 = this.ma.tokenAt(-1, mark1);
        const t2 = this.ma.tokenAt(-1, mark2);
        return t1 && t2 ? !this.matchEnded(t1, t2) : false;
    }

    private countDuplicateTokens(mark1: TokenEntry, mark2: TokenEntry): number {
        let index = 0;
        for (;;) {
            const t1 = this.ma.tokenAt(index, mark1);
            const t2 = this.ma.tokenAt(index, mark2);
            if (!t1 || !t2 || this.matchEnded(t1, t2)) break;
            index++;
        }
        return index;
    }

    private matchEnded(token1: TokenEntry, token2: TokenEntry): boolean {
        return token1.identifier !== token2.identifier || token1.identifier === 0 || token2.identifier === 0;
    }
}
