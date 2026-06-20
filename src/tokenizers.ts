// tokenizers.ts
import * as ts from 'typescript';
import {
    RawToken, TS_ID, TS_LIT, NG_TEXT, NG_INTERP
} from './core';

// ESM-пользователям: заменить require на createRequire(import.meta.url)
// или сделать функции async с dynamic import.
declare const require: (name: string) => any;

export interface TokenizeOptions {
    ignoreIdentifiers?: boolean;
    ignoreLiterals?: boolean;
}

const DEFAULTS: Required<TokenizeOptions> = {
    ignoreIdentifiers: true,
    ignoreLiterals: true,
};

function optional<T = any>(name: string): T | null {
    try { return require(name); } catch { return null; }
}

let warnedVue = false, warnedSvelte = false, warnedNg = false;

// --- Ремаппинг позиций встроенного блока в координаты файла ---
// Токены блока считаются от (0,0) внутри блока; baseLine/baseCol (1-based) дают
// абсолютную позицию начала блока. Сдвиг по столбцу только для первой строки блока.
function remap(tok: RawToken, baseLine: number, baseCol: number): RawToken {
    const firstLine = tok.line === 1;
    return {
        image: tok.image,
        line: baseLine + tok.line - 1,
        column: firstLine ? baseCol + tok.column - 1 : tok.column,
        barrier: tok.barrier,
    };
}

// --- TS / TSX / JSX через обход листьев AST ---
// Парсер сам разруливает regex, template literals и JSX, поэтому никакого
// ручного reScan*. Один парс вместо createScanner + createSourceFile.
export function tokenizeTypeScript(
    filePath: string,
    source: string,
    opts: TokenizeOptions = {},
    scriptKind: ts.ScriptKind = ts.ScriptKind.TS
): RawToken[] {
    const o = { ...DEFAULTS, ...opts };
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
    const out: RawToken[] = [];

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
                return o.ignoreLiterals ? TS_LIT : text;
            case ts.SyntaxKind.JsxText: {
                const t = text.trim();
                if (!t) return null; // пустой JSX-текст выкидываем
                return o.ignoreLiterals ? TS_LIT : t;
            }
            default:
                return text;
        }
    };

    const walk = (node: ts.Node) => {
        if (node.getChildCount(sf) === 0) {
            // лист = терминальный токен
            if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
            const text = node.getText(sf);
            const image = normalize(node.kind, text);
            if (image === null) return;
            const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            out.push({ image, line: line + 1, column: character + 1 });
            return;
        }
        node.forEachChild(walk);
    };
    walk(sf);

    return out;
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
    const sfc = optional('@vue/compiler-sfc');
    if (!sfc) {
        if (!warnedVue) { console.warn('[cpd] .vue пропущен: установите @vue/compiler-sfc'); warnedVue = true; }
        return [];
    }
    const { descriptor } = sfc.parse(source, { filename: filePath });
    const out: RawToken[] = [];
    for (const block of [descriptor.scriptSetup, descriptor.script]) {
        if (!block) continue;
        const lang = block.lang ?? 'js';
        const kind = lang === 'tsx' || lang === 'jsx' ? ts.ScriptKind.TSX
            : lang === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        const baseLine = block.loc.start.line;       // 1-based
        const baseCol = block.loc.start.column;       // 1-based
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
    const svelte = optional('svelte/compiler');
    if (!svelte) {
        if (!warnedSvelte) { console.warn('[cpd] .svelte пропущен: установите svelte'); warnedSvelte = true; }
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
    let line = 1, col = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source[i] === '\n') { line++; col = 1; } else { col++; }
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
    const ngc = optional('@angular/compiler');
    if (!ngc || typeof ngc.parseTemplate !== 'function') {
        if (!warnedNg) { console.warn('[cpd] Angular-шаблон пропущен: установите @angular/compiler'); warnedNg = true; }
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

        // Element (есть имя тега + дети)
        if (typeof node.name === 'string' && Array.isArray(node.children)) {
            emit('<' + node.name, node);
            for (const a of node.attributes ?? []) walk(a);
            for (const a of node.inputs ?? []) walk(a);
            for (const a of node.outputs ?? []) walk(a);
            for (const r of node.references ?? []) walk(r);
            for (const c of node.children) walk(c);
            return;
        }
        // Контейнеры: ng-template, control-flow блоки (@if/@for/@switch/@defer)
        if (Array.isArray(node.children) || Array.isArray(node.branches) || Array.isArray(node.cases)) {
            if (typeof node.tagName === 'string') emit('<' + node.tagName, node);
            for (const a of node.attributes ?? []) walk(a);
            for (const a of node.templateAttrs ?? []) walk(a);
            for (const c of node.children ?? []) walk(c);
            for (const b of node.branches ?? []) walk(b);
            for (const c of node.cases ?? []) walk(c);
            return;
        }
        // Атрибут / input / output / reference: имя структурно, значение нормализуем
        if (typeof node.name === 'string') {
            emit('@attr:' + node.name, node);
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

    return local.map(t => remap(t, base.line, base.col));
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
