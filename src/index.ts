/**
 * Public entry point. The {@link Cpd} facade dispatches each source by extension
 * to the right tokenizer, feeds the tokens to {@link CpdCore}, and materializes
 * match locations for reporting.
 *
 * @packageDocumentation
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractAngularInlineTemplates, tokenizeAngularHtml } from './angular';
import { CpdCore, type Mark, type Match, type RawToken } from './core';
import { tokenizeSvelte } from './svelte';
import { scriptKindFor, type TokenizeOptions, tokenizeTypeScript } from './tokenizers';
import { tokenizeVue } from './vue';

export { Mark, Match, TokenEntry } from './core';

export interface CpdOptions extends TokenizeOptions {
    minTileSize?: number;
    /** Extract inline templates from `@Component` for `.ts` files (default: false). */
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

/** High-level copy-paste detector: add sources, then {@link run} to get matches. */
export class Cpd {
    private core: CpdCore;
    private opts: Required<CpdOptions>;
    /** Original source per file, retained so reporters can emit the duplicated code. */
    private sources = new Map<string, string>();

    constructor(opts: CpdOptions = {}) {
        this.opts = {
            minTileSize: opts.minTileSize ?? 50,
            ignoreIdentifiers: opts.ignoreIdentifiers ?? false,
            ignoreLiterals: opts.ignoreLiterals ?? false,
            pmdTypescriptCompatibility: opts.pmdTypescriptCompatibility ?? true,
            svelteTemplates: opts.svelteTemplates ?? true,
            vueTemplates: opts.vueTemplates ?? true,
            angularInlineTemplates: opts.angularInlineTemplates ?? false,
        };
        this.core = new CpdCore(this.opts.minTileSize);
    }

    public addPath(filePath: string) {
        this.addSource(filePath, fs.readFileSync(filePath, 'utf-8'));
    }

    public addSource(filePath: string, source: string) {
        this.sources.set(filePath, source);
        const ext = path.extname(filePath).toLowerCase();
        const tok: TokenizeOptions = {
            ignoreIdentifiers: this.opts.ignoreIdentifiers,
            ignoreLiterals: this.opts.ignoreLiterals,
            pmdTypescriptCompatibility: this.opts.pmdTypescriptCompatibility,
            svelteTemplates: this.opts.svelteTemplates,
            vueTemplates: this.opts.vueTemplates,
        };

        if (TS_EXT.has(ext)) {
            const script = tokenizeTypeScript(filePath, source, tok, scriptKindFor(ext));
            const all: RawToken[] = [...script];

            if (this.opts.angularInlineTemplates && source.includes('@Component')) {
                for (const tpl of extractAngularInlineTemplates(filePath, source)) {
                    const tplTokens = tokenizeAngularHtml(filePath, tpl.code, { line: tpl.line, col: tpl.col }, tok);
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
            // External Angular template (plain HTML parses too).
            this.core.addFile(filePath, tokenizeAngularHtml(filePath, source, { line: 1, col: 1 }, tok));
            return;
        }

        // Unknown extension: ignore.
    }

    public run(): Match[] {
        return this.core.analyze();
    }

    /**
     * The token images of a match's span (any occurrence — all share the same
     * content). Lets the baseline layer fingerprint a match without reaching into
     * the engine's storage.
     */
    public spanImages(match: Match): string[] {
        const start = match.marks[0].token.index;
        const images = new Array<string>(match.tokenCount);
        for (let k = 0; k < match.tokenCount; k++) {
            images[k] = this.core.imageAt(start + k);
        }
        return images;
    }

    public locationForMark(mark: Mark, tokenCount: number): MatchLocation {
        const start = mark.token;
        const end = this.core.entryAt(start.index + tokenCount - 1) ?? start;
        return {
            path: start.file,
            startLine: start.beginLine,
            startColumn: start.beginColumn,
            endLine: end.endLine,
            endColumn: end.endColumn,
        };
    }

    /**
     * The duplicated source for a match: the full lines [startLine, endLine] of its
     * first occurrence, like PMD's `getSourceCodeSlice`. Empty string if the file's
     * source was not retained (e.g. a baseline-only match). Used by the xml/json/
     * markdown reporters to embed the code fragment.
     */
    public codeFragment(match: Match): string {
        const location = this.locationForMark(match.marks[0], match.tokenCount);
        const source = this.sources.get(location.path);
        if (source === undefined) {
            return '';
        }
        return source
            .split('\n')
            .slice(location.startLine - 1, location.endLine)
            .join('\n');
    }

    /**
     * Total physical line count across all added sources — the denominator for
     * the duplication percentage (see `stats.ts`). A trailing newline is not
     * counted as an extra line.
     */
    public totalLines(): number {
        let total = 0;
        for (const source of this.sources.values()) {
            if (source.length === 0) {
                continue;
            }
            const lines = source.split('\n').length;
            total += source.endsWith('\n') ? lines - 1 : lines;
        }
        return total;
    }

    /** Plain text report for eyeballing / diff tests. */
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

// Example:
//   const cpd = new Cpd({ minTileSize: 50 });
//   for (const f of files) cpd.addPath(f);
//   console.log(cpd.report());
