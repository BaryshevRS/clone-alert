// svelte.ts
// Токенайзер .svelte: <script>/<script module> + разметка (ast.fragment).
// Стоит поверх общего слоя tokenizers.ts (optional/moduleResolveDirs/remap/
// tokenizeTypeScript) и сентинела S из core.ts. Ядро про Svelte не знает.
//
// Два слоя токенов:
//   1) структура разметки (теги, блоки, директивы, статик-текст) -> образы с
//      префиксом SV (через сентинел S) => НЕ матчатся со script-токенами;
//   2) выражения внутри {...}/биндингов -> это тот же TypeScript в той же области
//      видимости компонента, поэтому режем slice исходника и гоним через общий
//      tokenizeTypeScript БЕЗ префикса => дубль выражения шаблон<->script ловится.
import * as ts from 'typescript';
import { type RawToken, S } from './core';
import { moduleResolveDirs, optional, remap, type TokenizeOptions, tokenizeTypeScript } from './tokenizers';

const SV = `${S}SV:`; // структурный маркер разметки
const SV_TEXT = `${S}SVTEXT`; // непустой статический текст

let warnedSvelte = false;

// offset -> {line, col} (оба 1-based) по предрассчитанной карте начал строк.
function makeOffsetMapper(source: string): (offset: number) => { line: number; col: number } {
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
        if (source.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
    }
    return (offset: number) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
    };
}

export function tokenizeSvelte(filePath: string, source: string, options: TokenizeOptions = {}): RawToken[] {
    const svelte = optional<{ parse: (src: string, opts: any) => any }>('svelte/compiler', moduleResolveDirs(filePath));
    if (!svelte || typeof svelte.parse !== 'function') {
        if (!warnedSvelte) {
            console.warn('[cpd] .svelte пропущен: установите svelte');
            warnedSvelte = true;
        }
        return [];
    }

    let ast: any;
    try {
        // modern: true -> разметка в ast.fragment (станет дефолтом в Svelte 6).
        ast = svelte.parse(source, { filename: filePath, modern: true });
    } catch {
        return [];
    }

    const out: RawToken[] = [];
    const at = makeOffsetMapper(source);

    // --- Структурный токен разметки (координаты от offset узла) ---
    const emitStruct = (image: string, node: any) => {
        const off = typeof node?.start === 'number' ? node.start : 0;
        const { line, col } = at(off);
        out.push({ image, line, column: col });
    };

    // --- Выражение: slice исходника -> общий TS-токенайзер -> remap ---
    const emitExpr = (node: any) => {
        if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return;
        const code = source.slice(node.start, node.end);
        if (!code) return;
        const { line, col } = at(node.start);
        for (const t of tokenizeTypeScript(filePath, code, options, ts.ScriptKind.TS)) {
            out.push(remap(t, line, col));
        }
    };

    // --- <script> и <script module>: чистый TS, как у обычного .ts ---
    for (const part of [ast.instance, ast.module]) {
        if (!part?.content) continue;
        const start = part.content.start as number;
        const end = part.content.end as number;
        const { line, col } = at(start);
        for (const t of tokenizeTypeScript(filePath, source.slice(start, end), options, ts.ScriptKind.TS)) {
            out.push(remap(t, line, col));
        }
        out.push({ image: '', line, column: col, barrier: true });
    }

    // --- Разметка ---
    const walkAttr = (attr: any) => {
        if (!attr || typeof attr !== 'object') return;
        switch (attr.type) {
            case 'Attribute': {
                emitStruct(`${SV}@${attr.name}`, attr);
                const v = attr.value;
                if (v === true) return; // булев атрибут без значения
                if (Array.isArray(v))
                    v.forEach(walkNode); // (Text | ExpressionTag)[]
                else walkNode(v); // одиночный ExpressionTag
                return;
            }
            case 'SpreadAttribute':
                emitStruct(`${SV}{...}`, attr);
                emitExpr(attr.expression);
                return;
            case 'BindDirective':
                emitStruct(`${SV}bind:${attr.name}`, attr);
                emitExpr(attr.expression);
                return;
            case 'OnDirective':
                emitStruct(`${SV}on:${attr.name}`, attr);
                emitExpr(attr.expression);
                return;
            case 'ClassDirective':
                emitStruct(`${SV}class:${attr.name}`, attr);
                emitExpr(attr.expression);
                return;
            case 'StyleDirective': {
                emitStruct(`${SV}style:${attr.name}`, attr);
                const v = attr.value;
                if (v === true) return;
                if (Array.isArray(v)) v.forEach(walkNode);
                else walkNode(v);
                return;
            }
            case 'UseDirective':
                emitStruct(`${SV}use:${attr.name}`, attr);
                emitExpr(attr.expression);
                return;
            case 'TransitionDirective': {
                const kw = attr.intro && attr.outro ? 'transition' : attr.outro ? 'out' : 'in';
                emitStruct(`${SV}${kw}:${attr.name}`, attr);
                emitExpr(attr.expression);
                return;
            }
            case 'AnimateDirective':
                emitStruct(`${SV}animate:${attr.name}`, attr);
                emitExpr(attr.expression);
                return;
            case 'LetDirective':
                emitStruct(`${SV}let:${attr.name}`, attr);
                return;
            case 'AttachTag':
                emitStruct(`${SV}@attach`, attr);
                emitExpr(attr.expression);
                return;
            default:
                if (attr.expression) emitExpr(attr.expression);
                return;
        }
    };

    function walkNode(node: any) {
        if (!node || typeof node !== 'object') return;
        switch (node.type) {
            case 'Fragment':
                (node.nodes ?? []).forEach(walkNode);
                return;
            case 'Text':
                if (typeof node.data === 'string' && node.data.trim()) emitStruct(SV_TEXT, node);
                return;
            case 'Comment':
                return;
            case 'ExpressionTag':
            case 'HtmlTag':
            case 'RenderTag':
            case 'AttachTag':
                emitExpr(node.expression);
                return;
            case 'ConstTag':
                emitStruct(`${SV}@const`, node);
                emitExpr(node.declaration);
                return;
            case 'DebugTag':
                (node.identifiers ?? []).forEach(emitExpr);
                return;
            case 'IfBlock':
                emitStruct(`${SV}#if`, node);
                emitExpr(node.test);
                walkNode(node.consequent);
                if (node.alternate) walkNode(node.alternate);
                return;
            case 'EachBlock':
                emitStruct(`${SV}#each`, node);
                emitExpr(node.expression);
                if (node.key) emitExpr(node.key);
                walkNode(node.body);
                if (node.fallback) walkNode(node.fallback);
                return;
            case 'AwaitBlock':
                emitStruct(`${SV}#await`, node);
                emitExpr(node.expression);
                if (node.pending) walkNode(node.pending);
                if (node.then) walkNode(node.then);
                if (node.catch) walkNode(node.catch);
                return;
            case 'KeyBlock':
                emitStruct(`${SV}#key`, node);
                emitExpr(node.expression);
                walkNode(node.fragment);
                return;
            case 'SnippetBlock':
                emitStruct(`${SV}#snippet`, node);
                walkNode(node.body);
                return;
            default: {
                // Element-like: RegularElement / Component / SvelteElement /
                // SvelteComponent / SvelteSelf / SvelteFragment / SlotElement /
                // TitleElement / SvelteWindow|Body|Head|Document|Boundary.
                if (Array.isArray(node.attributes) || node.fragment) {
                    emitStruct(`${SV}<${node.name ?? node.type}`, node);
                    (node.attributes ?? []).forEach(walkAttr);
                    if (node.fragment) walkNode(node.fragment);
                    return;
                }
                // Неизвестный узел — попробуем общие поля, чтобы не терять выражения.
                if (node.expression) emitExpr(node.expression);
                if (node.fragment) walkNode(node.fragment);
                if (Array.isArray(node.nodes)) node.nodes.forEach(walkNode);
                return;
            }
        }
    }

    if (ast.fragment) walkNode(ast.fragment);

    return out;
}
