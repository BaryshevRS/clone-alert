/**
 * The TypeScript/JavaScript tokenizer plus the shared helpers used by every
 * framework tokenizer extension (`optional`, `moduleResolveDirs`, `remap`).
 *
 * @packageDocumentation
 */
import * as ts from 'typescript';
import { type RawToken, TS_ID, TS_LIT } from './core';

// ESM users: replace require with createRequire(import.meta.url), or make the
// functions async and use dynamic import.
declare const require: {
    (name: string): any;
    resolve: (name: string, options?: { paths?: string[] }) => string;
};

export interface TokenizeOptions {
    ignoreIdentifiers?: boolean;
    ignoreLiterals?: boolean;
    /** Split TS-file tokens to match PMD typescript (templates, regexp). `.ts/.tsx` only. */
    pmdTypescriptCompatibility?: boolean;
    /**
     * Tokenize `.svelte` markup (ast.fragment), not just `<script>`. Markup and
     * script usually want different `--minimum-tokens` thresholds, so this is put
     * behind a toggle: turn it off to scan scripts on their own.
     */
    svelteTemplates?: boolean;
    /**
     * Tokenize `.vue` markup (descriptor.template.ast), not just `<script>`. Like
     * svelteTemplates, this layer sits behind a toggle so markup and code can run
     * at separate `--minimum-tokens` thresholds.
     */
    vueTemplates?: boolean;
}

export const DEFAULTS: Required<TokenizeOptions> = {
    ignoreIdentifiers: false,
    ignoreLiterals: false,
    pmdTypescriptCompatibility: true,
    svelteTemplates: true,
    vueTemplates: true,
};

/**
 * Load an optional compiler (`@angular/compiler`, `@vue/compiler-sfc`, `svelte`)
 * — a peerDependency. Resolution starts FROM the analyzed file and walks up the
 * tree (so we use the compiler version installed in the scanned project), and
 * only then falls back to clone-alert's own node_modules. `fromPaths` is usually
 * `[dirname(filePath)]`; Node climbs node_modules from there.
 */
export function optional<T = any>(name: string, fromPaths?: string[]): T | null {
    try {
        const id = require.resolve(name, fromPaths && fromPaths.length ? { paths: fromPaths } : undefined);
        return require(id);
    } catch {
        if (fromPaths && fromPaths.length) {
            try {
                return require(name);
            } catch {
                return null;
            }
        }
        return null;
    }
}

/**
 * Starting point for resolving a peer compiler: the directory of the analyzed
 * file. Node walks up node_modules from there to the project root.
 */
export function moduleResolveDirs(filePath: string): string[] {
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return slash > 0 ? [filePath.slice(0, slash)] : [];
}

/**
 * Remap an embedded block's positions into file coordinates. Block tokens are
 * counted from (0,0) within the block; baseLine/baseCol (1-based) give the
 * absolute start of the block. The column shift applies only to the block's
 * first line.
 */
export function remap(tok: RawToken, baseLine: number, baseCol: number): RawToken {
    const firstLine = tok.line === 1;
    const endFirstLine = (tok.endLine ?? tok.line) === 1;
    return {
        image: tok.image,
        line: baseLine + tok.line - 1,
        column: firstLine ? baseCol + tok.column - 1 : tok.column,
        endLine: baseLine + (tok.endLine ?? tok.line) - 1,
        endColumn: endFirstLine ? baseCol + (tok.endColumn ?? tok.column) - 1 : (tok.endColumn ?? tok.column),
        barrier: tok.barrier,
    };
}

/**
 * Tokenize TS / TSX / JSX via the TypeScript scanner. CPD counts the stream of
 * lexical tokens, including keywords and punctuation.
 */
export function tokenizeTypeScript(
    filePath: string,
    source: string,
    opts: TokenizeOptions = {},
    scriptKind: ts.ScriptKind = ts.ScriptKind.TS
): RawToken[] {
    const o = { ...DEFAULTS, ...opts };
    // This used to call ts.createSourceFile (a full AST parse) only to map
    // positions. The AST is not needed — we use the same line map TS builds under
    // the hood for getLineAndCharacterOfPosition, without parsing. See createLineMap.
    const sf = createLineMap(source);
    const suppressedRanges = findCpdSuppressedRanges(source);
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        scriptKind === ts.ScriptKind.TSX || scriptKind === ts.ScriptKind.JSX
            ? ts.LanguageVariant.JSX
            : ts.LanguageVariant.Standard,
        source
    );
    const out: RawToken[] = [];
    let previousTokenKind: ts.SyntaxKind | null = null;

    const normalize = (kind: ts.SyntaxKind, text: string): string | null => {
        switch (kind) {
            case ts.SyntaxKind.Identifier:
            case ts.SyntaxKind.PrivateIdentifier:
                return o.ignoreIdentifiers ? TS_ID : text;
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.BigIntLiteral:
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
            case ts.SyntaxKind.RegularExpressionLiteral:
            case ts.SyntaxKind.TemplateHead:
            case ts.SyntaxKind.TemplateMiddle:
            case ts.SyntaxKind.TemplateTail:
                return o.ignoreLiterals ? TS_LIT : normalizeStringContinuation(text);
            case ts.SyntaxKind.JsxText: {
                const t = text.trim();
                if (!t) return null; // drop empty JSX text
                return o.ignoreLiterals ? TS_LIT : t;
            }
            default:
                return text;
        }
    };

    // PMD typescript compatibility is enabled only for TS files. .ts/.tsx (flag
    // ON): templates are split into PMD-typescript atoms (backtick / ${ / } / one
    // per text char — grammar TypeScriptLexer.g4 TemplateStringAtom: ~[`\\]) and
    // regexp is collapsed. .js/.jsx, or flag OFF: the native scanner (a template
    // is one token, no PMD massaging).
    const pmdTypeScript = o.pmdTypescriptCompatibility && isTypeScriptFile(filePath, scriptKind);
    const splitTemplates = pmdTypeScript;
    // Brace depth inside each active ${…} interpolation. At zero, the next `}`
    // closes the interpolation -> rescan it as TemplateMiddle/Tail.
    const templateBraceDepth: number[] = [];
    const bumpTemplateDepth = (kind: ts.SyntaxKind) => {
        if (!splitTemplates) return;
        const top = templateBraceDepth.length - 1;
        switch (kind) {
            case ts.SyntaxKind.TemplateHead:
                templateBraceDepth.push(0);
                break;
            case ts.SyntaxKind.TemplateTail:
                templateBraceDepth.pop();
                break;
            case ts.SyntaxKind.OpenBraceToken:
                if (top >= 0) templateBraceDepth[top]++;
                break;
            case ts.SyntaxKind.CloseBraceToken:
                if (top >= 0) templateBraceDepth[top]--;
                break;
            default:
                break;
        }
    };

    for (;;) {
        let kind = scanner.scan();
        if (kind === ts.SyntaxKind.EndOfFileToken) break;

        // Closing `}` of an interpolation: rescan it as a template continuation.
        if (
            splitTemplates &&
            kind === ts.SyntaxKind.CloseBraceToken &&
            templateBraceDepth.length > 0 &&
            templateBraceDepth[templateBraceDepth.length - 1] === 0
        ) {
            kind = scanner.reScanTemplateToken(false);
        }

        const tokenStart = scanner.getTokenPos();
        if (isSuppressed(tokenStart, suppressedRanges)) {
            bumpTemplateDepth(kind); // keep the stack in sync through CPD-OFF
            continue;
        }

        if (pmdTypeScript && kind === ts.SyntaxKind.SlashToken && canStartPmdRegexpLiteral(previousTokenKind)) {
            kind = scanner.reScanSlashToken();
        }

        // typescript mode: split part of the template into PMD atoms.
        if (splitTemplates && isTemplatePart(kind)) {
            bumpTemplateDepth(kind);
            for (const atom of expandTemplateSpan(source, sf, tokenStart, scanner.getTextPos(), o)) {
                out.push(atom);
            }
            previousTokenKind = kind;
            continue;
        }

        // native mode: the whole template with substitutions is one token.
        if (!splitTemplates && kind === ts.SyntaxKind.TemplateHead) {
            const templateEnd = findTemplateLiteralEnd(source, tokenStart);
            scanner.setTextPos(templateEnd);
            const { line, character } = sf.getLineAndCharacterOfPosition(tokenStart);
            const end = positionAtTokenEnd(sf, templateEnd);
            out.push({
                image: o.ignoreLiterals ? TS_LIT : source.slice(tokenStart, templateEnd),
                line: line + 1,
                column: character + 1,
                endLine: end.line,
                endColumn: end.column,
            });
            previousTokenKind = kind;
            continue;
        }

        bumpTemplateDepth(kind); // balance { } inside an interpolation

        const image = normalize(kind, normalizeStringContinuation(scanner.getTokenText()));
        if (image === null) continue;
        const { line, character } = sf.getLineAndCharacterOfPosition(tokenStart);
        const end = positionAtTokenEnd(sf, scanner.getTextPos());
        out.push({
            image,
            line: line + 1,
            column: character + 1,
            endLine: end.line,
            endColumn: end.column,
        });
        previousTokenKind = kind;
    }

    return out;
}

function canStartPmdRegexpLiteral(previousKind: ts.SyntaxKind | null): boolean {
    if (previousKind === null) {
        return true;
    }

    switch (previousKind) {
        case ts.SyntaxKind.Identifier:
        case ts.SyntaxKind.PrivateIdentifier:
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.BigIntLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        case ts.SyntaxKind.RegularExpressionLiteral:
        case ts.SyntaxKind.ThisKeyword:
        case ts.SyntaxKind.SuperKeyword:
        case ts.SyntaxKind.TrueKeyword:
        case ts.SyntaxKind.FalseKeyword:
        case ts.SyntaxKind.NullKeyword:
        case ts.SyntaxKind.CloseParenToken:
        case ts.SyntaxKind.CloseBracketToken:
        case ts.SyntaxKind.CloseBraceToken:
        case ts.SyntaxKind.PlusPlusToken:
        case ts.SyntaxKind.MinusMinusToken:
            return false;
        default:
            return true;
    }
}

// PMD typescript compatibility applies only to TS files; .js/.jsx go through the
// native scanner with no PMD massaging.
function isTypeScriptFile(filePath: string, scriptKind: ts.ScriptKind): boolean {
    const ext = pathExt(filePath);
    if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return true;
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return false;
    return scriptKind === ts.ScriptKind.TS || scriptKind === ts.ScriptKind.TSX;
}

function pathExt(filePath: string): string {
    const dot = filePath.lastIndexOf('.');
    return dot === -1 ? '' : filePath.slice(dot).toLowerCase();
}

// offset -> {line, character} mapping, identical to sf.getLineAndCharacterOfPosition
// but without an AST parse: under the hood TS does computeLineAndCharacterOfPosition(
// computeLineStarts(text), pos). Those functions are exported at runtime (but not
// in the public types), so we call them through a narrow cast; on older TS builds
// that lack them we fall back to a full SourceFile.
interface LineMap {
    getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}

function createLineMap(source: string): LineMap {
    const api = ts as unknown as {
        computeLineStarts?: (text: string) => readonly number[];
        computeLineAndCharacterOfPosition?: (
            lineStarts: readonly number[],
            position: number
        ) => { line: number; character: number };
    };
    const compute = api.computeLineStarts;
    const lineAndChar = api.computeLineAndCharacterOfPosition;
    if (compute && lineAndChar) {
        const lineStarts = compute(source);
        return { getLineAndCharacterOfPosition: (pos) => lineAndChar(lineStarts, pos) };
    }
    const sf = ts.createSourceFile('_.ts', source, ts.ScriptTarget.Latest, false);
    return { getLineAndCharacterOfPosition: (pos) => sf.getLineAndCharacterOfPosition(pos) };
}

function positionAtTokenEnd(sf: LineMap, offset: number): { line: number; column: number } {
    const { line, character } = sf.getLineAndCharacterOfPosition(offset);
    return { line: line + 1, column: character + 1 };
}

function normalizeStringContinuation(text: string): string {
    return text.replace(/\\\r?\n\s*/g, '');
}

function findTemplateLiteralEnd(source: string, start: number): number {
    let expressionDepth = 0;

    for (let i = start + 1; i < source.length; i++) {
        const char = source[i];
        if (char === '\\') {
            i++;
            continue;
        }
        if (char === '`' && expressionDepth === 0) {
            return i + 1;
        }
        if (char === '$' && source[i + 1] === '{') {
            expressionDepth++;
            i++;
            continue;
        }
        if (char === '}' && expressionDepth > 0) {
            expressionDepth--;
        }
    }

    return source.length;
}

function isTemplatePart(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        kind === ts.SyntaxKind.TemplateHead ||
        kind === ts.SyntaxKind.TemplateMiddle ||
        kind === ts.SyntaxKind.TemplateTail
    );
}

// Split a chunk of a template literal into PMD-typescript atoms: backtick, `${`,
// `}`, and an escape `\X` are one token each; everything else (text, spaces,
// newlines) is one token per character (grammar: TemplateStringAtom: ~[`\\]).
function expandTemplateSpan(
    source: string,
    sf: LineMap,
    start: number,
    end: number,
    opts: Required<TokenizeOptions>
): RawToken[] {
    const atoms: RawToken[] = [];
    let i = start;
    while (i < end) {
        let len = 1;
        const char = source[i];
        if (char === '\\' && i + 1 < end) {
            len = 2; // escape atom
        } else if (char === '$' && source[i + 1] === '{') {
            len = 2; // start of an interpolation
        }
        const raw = source.slice(i, i + len);
        const structural = raw === '`' || raw === '${' || raw === '}';
        const s = sf.getLineAndCharacterOfPosition(i);
        const e = sf.getLineAndCharacterOfPosition(i + len);
        atoms.push({
            image: !structural && opts.ignoreLiterals ? TS_LIT : raw,
            line: s.line + 1,
            column: s.character + 1,
            endLine: e.line + 1,
            endColumn: e.character + 1,
        });
        i += len;
    }
    return atoms;
}

function isSuppressed(offset: number, ranges: { start: number; end: number }[]): boolean {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

function findCpdSuppressedRanges(source: string): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    const comments = source.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g);
    let start: number | null = null;

    for (const comment of comments) {
        const image = comment[0];
        const index = comment.index;
        if (image.includes('CPD-OFF') && start === null) {
            start = index;
        }
        if (image.includes('CPD-ON') && start !== null) {
            ranges.push({ start, end: index + image.length });
            start = null;
        }
    }

    if (start !== null) {
        ranges.push({ start, end: source.length });
    }

    return ranges;
}

const TSX_EXT = new Set(['.tsx', '.jsx']);
const JS_EXT = new Set(['.js', '.mjs', '.cjs']);
export function scriptKindFor(ext: string): ts.ScriptKind {
    if (TSX_EXT.has(ext)) return ts.ScriptKind.TSX;
    if (JS_EXT.has(ext)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}

// Vue (.vue) and Svelte (.svelte) live in their own extension modules src/vue.ts
// and src/svelte.ts, modeled on src/angular.ts — each tokenizes both <script> and
// markup (descriptor.template.ast / ast.fragment).
