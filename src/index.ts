// index.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CpdCore, type Mark, type Match, type RawToken } from './core';
import {
    extractAngularInlineTemplates,
    scriptKindFor,
    type TokenizeOptions,
    tokenizeAngularHtml,
    tokenizeSvelte,
    tokenizeTypeScript,
    tokenizeVue,
} from './tokenizers';

export { Mark, Match, TokenEntry } from './core';

export interface CpdOptions extends TokenizeOptions {
    minTileSize?: number;
    /** Извлекать inline-шаблоны из @Component для .ts (по умолчанию false). */
    angularInlineTemplates?: boolean;
}

export interface MatchLocation {
    path: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

const TS_EXT = new Set(['.ts', '.mts', '.cts']);
const JSX_EXT = new Set(['.tsx', '.jsx', '.js', '.mjs', '.cjs']);
const HTML_EXT = new Set(['.html', '.htm']);

export class Cpd {
    private core: CpdCore;
    private opts: Required<CpdOptions>;

    constructor(opts: CpdOptions = {}) {
        this.opts = {
            minTileSize: opts.minTileSize ?? 50,
            ignoreIdentifiers: opts.ignoreIdentifiers ?? false,
            ignoreLiterals: opts.ignoreLiterals ?? false,
            pmdEcmascriptCompatibility: opts.pmdEcmascriptCompatibility ?? true,
            angularInlineTemplates: opts.angularInlineTemplates ?? false,
        };
        this.core = new CpdCore(this.opts.minTileSize);
    }

    public addPath(filePath: string) {
        this.addSource(filePath, fs.readFileSync(filePath, 'utf-8'));
    }

    public addSource(filePath: string, source: string) {
        const ext = path.extname(filePath).toLowerCase();
        const tok: TokenizeOptions = {
            ignoreIdentifiers: this.opts.ignoreIdentifiers,
            ignoreLiterals: this.opts.ignoreLiterals,
            pmdEcmascriptCompatibility: this.opts.pmdEcmascriptCompatibility,
        };

        if (TS_EXT.has(ext)) {
            const script = tokenizeTypeScript(filePath, source, tok, scriptKindFor(ext));
            const all: RawToken[] = [...script];

            if (this.opts.angularInlineTemplates && source.includes('@Component')) {
                for (const tpl of extractAngularInlineTemplates(filePath, source)) {
                    const tplTokens = tokenizeAngularHtml(filePath, tpl.code, { line: tpl.line, col: tpl.col });
                    if (tplTokens.length) {
                        all.push({ image: '', line: tpl.line, column: tpl.col, barrier: true });
                        all.push(...tplTokens);
                    }
                }
            }
            this.core.addFile(filePath, all);
            return;
        }

        if (JSX_EXT.has(ext)) {
            this.core.addFile(filePath, tokenizeTypeScript(filePath, source, tok, scriptKindFor(ext)));
            return;
        }

        if (ext === '.vue') {
            this.core.addFile(filePath, tokenizeVue(filePath, source, tok));
            return;
        }

        if (ext === '.svelte') {
            this.core.addFile(filePath, tokenizeSvelte(filePath, source, tok));
            return;
        }

        if (HTML_EXT.has(ext)) {
            // Внешний Angular-шаблон (обычный HTML тоже парсится).
            this.core.addFile(filePath, tokenizeAngularHtml(filePath, source));
            return;
        }

        // неизвестное расширение игнорируем
    }

    public run(): Match[] {
        return this.core.analyze();
    }

    public locationForMark(mark: Mark, tokenCount: number): MatchLocation {
        const start = mark.token;
        const end = this.core.tokens[start.index + tokenCount - 1] ?? start;
        return {
            path: start.file,
            startLine: start.beginLine,
            startColumn: start.beginColumn,
            endLine: end.endLine,
            endColumn: end.endColumn,
        };
    }

    /** Простой текстовый отчёт для глазной проверки / дифф-теста. */
    public report(matches: Match[] = this.run()): string {
        const lines: string[] = [];
        for (const m of matches) {
            const marks = m.marks;
            lines.push(`Found a ${m.tokenCount} token (${m.markCount} occurrences) duplication:`);
            for (const mk of marks) {
                const t = mk.token;
                lines.push(`  ${t.file}:${t.beginLine}:${t.beginColumn}`);
            }
            lines.push('');
        }
        return lines.join('\n');
    }
}

// Пример:
//   const cpd = new Cpd({ minTileSize: 50 });
//   for (const f of files) cpd.addPath(f);
//   console.log(cpd.report());
