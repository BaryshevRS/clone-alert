// tokenizers.ts
import * as ts from 'typescript';
import { NG_INTERP, NG_TEXT, type RawToken, TS_ID, TS_LIT } from './core';

// ESM-пользователям: заменить require на createRequire(import.meta.url)
// или сделать функции async с dynamic import.
declare const require: {
    (name: string): any;
    resolve: (name: string, options?: { paths?: string[] }) => string;
};

export interface TokenizeOptions {
    ignoreIdentifiers?: boolean;
    ignoreLiterals?: boolean;
    /** Дробить токены TS-файлов под PMD typescript (шаблоны, regexp). Только .ts/.tsx. */
    pmdTypescriptCompatibility?: boolean;
}

const DEFAULTS: Required<TokenizeOptions> = {
    ignoreIdentifiers: false,
    ignoreLiterals: false,
    pmdTypescriptCompatibility: true,
};

// Опциональный компилятор (@angular/compiler, @vue/compiler-sfc, svelte) —
// peerDependency. Резолвим СНАЧАЛА от анализируемого файла вверх по дереву
// (берём компилятор той версии, что стоит в сканируемом проекте), и лишь
// потом падаем на собственные node_modules clone-alert. fromPaths обычно =
// [dirname(filePath)] — Node поднимается по node_modules от этой точки.
function optional<T = any>(name: string, fromPaths?: string[]): T | null {
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

// Стартовая точка для резолва peer-компилятора: каталог анализируемого файла.
// Node сам пройдёт node_modules вверх до корня проекта.
function moduleResolveDirs(filePath: string): string[] {
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return slash > 0 ? [filePath.slice(0, slash)] : [];
}

let warnedVue = false;
let warnedSvelte = false;
let warnedNg = false;

// --- Ремаппинг позиций встроенного блока в координаты файла ---
// Токены блока считаются от (0,0) внутри блока; baseLine/baseCol (1-based) дают
// абсолютную позицию начала блока. Сдвиг по столбцу только для первой строки блока.
function remap(tok: RawToken, baseLine: number, baseCol: number): RawToken {
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

// --- TS / TSX / JSX через scanner ---
// CPD считает поток лексических токенов, включая keywords и punctuation.
export function tokenizeTypeScript(
    filePath: string,
    source: string,
    opts: TokenizeOptions = {},
    scriptKind: ts.ScriptKind = ts.ScriptKind.TS
): RawToken[] {
    const o = { ...DEFAULTS, ...opts };
    // Раньше тут был полный ts.createSourceFile (парс в AST) только ради маппинга
    // позиций. AST не нужен — берём ту же line-map, что TS строит под капотом
    // getLineAndCharacterOfPosition, без парсинга. См. createLineMap.
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
                if (!t) return null; // пустой JSX-текст выкидываем
                return o.ignoreLiterals ? TS_LIT : t;
            }
            default:
                return text;
        }
    };

    // Режим совместимости с PMD typescript включается только для TS-файлов.
    // .ts/.tsx (флаг ВКЛ): шаблон дробится на PMD-typescript-атомы (backtick /
    // ${ / } / по символу текста — grammar TypeScriptLexer.g4 TemplateStringAtom:
    // ~[`\\]) и схлопывается regexp. .js/.jsx или флаг ВЫКЛ — нативный сканер
    // (шаблон = один токен, никакого pmd-причёсывания).
    const pmdTypeScript = o.pmdTypescriptCompatibility && isTypeScriptFile(filePath, scriptKind);
    const splitTemplates = pmdTypeScript;
    // Глубина фигурных скобок внутри каждой активной интерполяции ${…}. На нуле
    // очередная `}` закрывает интерполяцию -> пересканируем в TemplateMiddle/Tail.
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

        // Закрывающая `}` интерполяции: пересканируем её как продолжение шаблона.
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
            bumpTemplateDepth(kind); // держим стек в синхроне сквозь CPD-OFF
            continue;
        }

        if (pmdTypeScript && kind === ts.SyntaxKind.SlashToken && canStartPmdRegexpLiteral(previousTokenKind)) {
            kind = scanner.reScanSlashToken();
        }

        // typescript-режим: дробим часть шаблона на атомы PMD.
        if (splitTemplates && isTemplatePart(kind)) {
            bumpTemplateDepth(kind);
            for (const atom of expandTemplateSpan(source, sf, tokenStart, scanner.getTextPos(), o)) {
                out.push(atom);
            }
            previousTokenKind = kind;
            continue;
        }

        // нативный режим: весь шаблон с подстановками = один токен.
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

        bumpTemplateDepth(kind); // баланс { } внутри интерполяции

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

// PMD typescript-совместимость применяется только к TS-файлам; .js/.jsx идут
// нативным сканером без pmd-причёсывания.
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

// Маппинг offset -> {line, character}, идентичный sf.getLineAndCharacterOfPosition,
// но без парса AST: TS под капотом делает computeLineAndCharacterOfPosition(
// computeLineStarts(text), pos). Эти функции экспортируются в рантайме (но нет в
// публичных типах), поэтому зовём через узкий каст; на старых сборках TS, где их
// нет, откатываемся на полноценный SourceFile.
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

// Дробление куска шаблонного литерала на атомы PMD-typescript: backtick, `${`,
// `}`, escape `\X` — по одному токену; всё остальное (текст, пробелы, переводы
// строк) — по одному токену на символ (grammar: TemplateStringAtom: ~[`\\]).
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
            len = 2; // escape-атом
        } else if (char === '$' && source[i + 1] === '{') {
            len = 2; // начало интерполяции
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

// --- Vue SFC ---
export function tokenizeVue(filePath: string, source: string, opts: TokenizeOptions = {}): RawToken[] {
    const sfc = optional('@vue/compiler-sfc', moduleResolveDirs(filePath));
    if (!sfc) {
        if (!warnedVue) {
            console.warn('[cpd] .vue пропущен: установите @vue/compiler-sfc');
            warnedVue = true;
        }
        return [];
    }
    const { descriptor } = sfc.parse(source, { filename: filePath });
    const out: RawToken[] = [];
    for (const block of [descriptor.scriptSetup, descriptor.script]) {
        if (!block) continue;
        const lang = block.lang ?? 'js';
        const kind =
            lang === 'tsx' || lang === 'jsx' ? ts.ScriptKind.TSX : lang === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        const baseLine = block.loc.start.line; // 1-based
        const baseCol = block.loc.start.column; // 1-based
        const toks = tokenizeTypeScript(filePath, block.content, opts, kind);
        for (const t of toks) out.push(remap(t, baseLine, baseCol));
        out.push({ image: '', line: baseLine, column: baseCol, barrier: true });
    }
    // Vue-шаблон: descriptor.template.ast доступен, структуру можно добавить
    // по той же схеме, что Angular ниже. Оставлено как расширение.
    return out;
}

// --- Svelte ---
export function tokenizeSvelte(filePath: string, source: string, opts: TokenizeOptions = {}): RawToken[] {
    const svelte = optional('svelte/compiler', moduleResolveDirs(filePath));
    if (!svelte) {
        if (!warnedSvelte) {
            console.warn('[cpd] .svelte пропущен: установите svelte');
            warnedSvelte = true;
        }
        return [];
    }
    const ast = svelte.parse(source, { filename: filePath });
    const out: RawToken[] = [];
    for (const part of [ast.instance, ast.module]) {
        if (!part) continue;
        const start = part.content.start as number; // offset начала кода <script>
        const { line, col } = offsetToLineCol(source, start);
        const code = source.slice(part.content.start, part.content.end);
        const toks = tokenizeTypeScript(filePath, code, opts, ts.ScriptKind.TS);
        for (const t of toks) out.push(remap(t, line, col));
        out.push({ image: '', line, column: col, barrier: true });
    }
    return out;
}

function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source[i] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { line, col };
}

// --- Angular HTML-шаблон (внешний .html или inline) ---
// Структурный токенайзер: теги, имена атрибутов, нормализованные текст/binding.
// Образы лежат в отдельном неймспейсе => кросс-матчей со script-токенами нет.
export function tokenizeAngularHtml(
    filePath: string,
    template: string,
    base: { line: number; col: number } = { line: 1, col: 1 }
): RawToken[] {
    const ngc = optional('@angular/compiler', moduleResolveDirs(filePath));
    if (!ngc || typeof ngc.parseTemplate !== 'function') {
        if (!warnedNg) {
            console.warn('[cpd] Angular-шаблон пропущен: установите @angular/compiler');
            warnedNg = true;
        }
        return [];
    }
    let parsed: any;
    try {
        parsed = ngc.parseTemplate(template, filePath, { preserveWhitespaces: false });
    } catch {
        return [];
    }
    if (!parsed || !Array.isArray(parsed.nodes)) return [];

    const local: RawToken[] = [];
    const emit = (image: string, node: any) => {
        const sp = node?.sourceSpan ?? node?.startSourceSpan;
        const loc = sp?.start;
        local.push({ image, line: (loc?.line ?? 0) + 1, column: (loc?.col ?? 0) + 1 });
    };

    const walk = (node: any) => {
        if (node == null) return;

        const walkAll = (items: unknown[] | undefined) => {
            for (const item of items ?? []) walk(item);
        };

        // Element (есть имя тега + дети)
        if (typeof node.name === 'string' && Array.isArray(node.children)) {
            emit(`<${node.name}`, node);
            walkAll(node.attributes);
            walkAll(node.inputs);
            walkAll(node.outputs);
            walkAll(node.references);
            walkAll(node.children);
            return;
        }
        // Контейнеры: ng-template, control-flow блоки (@if/@for/@switch/@defer)
        if (Array.isArray(node.children) || Array.isArray(node.branches) || Array.isArray(node.cases)) {
            if (typeof node.tagName === 'string') emit(`<${node.tagName}`, node);
            walkAll(node.attributes);
            walkAll(node.templateAttrs);
            walkAll(node.children);
            walkAll(node.branches);
            walkAll(node.cases);
            return;
        }
        // Атрибут / input / output / reference: имя структурно, значение нормализуем
        if (typeof node.name === 'string') {
            emit(`@attr:${node.name}`, node);
            return;
        }
        // BoundText / интерполяция (value это AST-выражение)
        if (node.value && typeof node.value === 'object') {
            emit(NG_INTERP, node);
            return;
        }
        // Text
        if (typeof node.value === 'string') {
            if (node.value.trim().length) emit(NG_TEXT, node);
            return;
        }
    };
    for (const n of parsed.nodes) walk(n);

    return local.map((t) => remap(t, base.line, base.col));
}

// --- Извлечение inline-шаблонов из @Component({ template: `...` }) ---
export function extractAngularInlineTemplates(
    filePath: string,
    source: string
): { code: string; line: number; col: number }[] {
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result: { code: string; line: number; col: number }[] = [];

    const visit = (node: ts.Node) => {
        if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
            const callee = node.expression.expression;
            const name = ts.isIdentifier(callee) ? callee.text : '';
            const arg = node.expression.arguments[0];
            if (name === 'Component' && arg && ts.isObjectLiteralExpression(arg)) {
                for (const p of arg.properties) {
                    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name)) continue;
                    if (p.name.text !== 'template') continue;
                    const init = p.initializer;
                    if (ts.isStringLiteralLike(init)) {
                        // позиция первого символа содержимого (после кавычки/бэктика)
                        const contentStart = init.getStart(sf) + 1;
                        const { line, character } = sf.getLineAndCharacterOfPosition(contentStart);
                        result.push({ code: init.text, line: line + 1, col: character + 1 });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return result;
}
