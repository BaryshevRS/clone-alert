// vue.ts
// Токенайзер .vue: <script>/<script setup> + разметка (descriptor.template.ast).
// Стоит поверх общего слоя tokenizers.ts (optional/moduleResolveDirs/remap/
// tokenizeTypeScript) и сентинела S из core.ts. Ядро про Vue не знает.
// Построен по образцу src/svelte.ts и src/angular.ts.
//
// Два слоя токенов:
//   1) структура разметки (теги, директивы, имена/значения атрибутов, статик-
//      текст) -> образы с префиксом VUE (через сентинел S) => НЕ матчатся со
//      script-токенами;
//   2) выражения биндингов/интерполяций ({{ … }}, :prop, v-if, @event) -> это
//      тот же TypeScript в той же области видимости компонента, поэтому режем
//      slice исходника и гоним через общий tokenizeTypeScript БЕЗ префикса =>
//      дубль выражения шаблон<->script ловится.
import * as ts from 'typescript';
import { type RawToken, S } from './core';
import { DEFAULTS, moduleResolveDirs, optional, remap, type TokenizeOptions, tokenizeTypeScript } from './tokenizers';

const VUE = `${S}VUE:`; // структурный маркер разметки
const VUE_TEXT = `${S}VUETEXT`; // непустой статический текст
const VUE_LIT = `${S}VUELIT`; // нормализованное значение статического атрибута (ignoreLiterals)

// Числовые NodeTypes из @vue/compiler-core стабильны на весь Vue 3.
const N_ELEMENT = 1;
const N_TEXT = 2;
const N_COMMENT = 3;
const N_INTERPOLATION = 5;
const N_ATTRIBUTE = 6;
const N_DIRECTIVE = 7;

let warnedVue = false;

export function tokenizeVue(filePath: string, source: string, options: TokenizeOptions = {}): RawToken[] {
    const o = { ...DEFAULTS, ...options };
    const sfc = optional<{ parse: (src: string, opts: any) => any }>('@vue/compiler-sfc', moduleResolveDirs(filePath));
    if (!sfc || typeof sfc.parse !== 'function') {
        if (!warnedVue) {
            console.warn('[cpd] .vue пропущен: установите @vue/compiler-sfc');
            warnedVue = true;
        }
        return [];
    }

    let descriptor: any;
    try {
        ({ descriptor } = sfc.parse(source, { filename: filePath }));
    } catch {
        return [];
    }

    const out: RawToken[] = [];

    // --- <script setup> и <script>: чистый TS/JS, как у обычного файла ---
    for (const block of [descriptor.scriptSetup, descriptor.script]) {
        if (!block) continue;
        const lang = block.lang ?? 'js';
        const kind =
            lang === 'tsx' || lang === 'jsx' ? ts.ScriptKind.TSX : lang === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        const baseLine = block.loc.start.line; // 1-based
        const baseCol = block.loc.start.column; // 1-based
        for (const t of tokenizeTypeScript(filePath, block.content, o, kind)) out.push(remap(t, baseLine, baseCol));
        out.push({ image: '', line: baseLine, column: baseCol, barrier: true });
    }

    // --- Разметка ---
    // Токенизируем только если включён тумблер (по умолчанию да). Шаблон и скрипт
    // обычно гоняют разными порогами --minimum-tokens.
    const tmpl = descriptor.template;
    if ((o.vueTemplates ?? true) && tmpl?.ast) {
        // Координаты узлов Vue (loc.start.{line,column}) уже абсолютны по файлу и
        // 1-based — карта offset->line/col не нужна (в отличие от svelte.ts).
        const emitStruct = (image: string, node: any) => {
            const loc = node?.loc?.start;
            out.push({ image, line: loc?.line ?? 1, column: loc?.column ?? 1 });
        };

        // SIMPLE_EXPRESSION -> slice исходника -> общий TS-токенайзер -> remap.
        // Нормализацию id/литералов делает сам tokenizeTypeScript (это настоящий TS).
        const emitExpr = (exp: any) => {
            const start = exp?.loc?.start;
            const end = exp?.loc?.end;
            if (!start || !end || typeof start.offset !== 'number' || typeof end.offset !== 'number') return;
            const code = source.slice(start.offset, end.offset);
            if (!code.trim()) return;
            for (const t of tokenizeTypeScript(filePath, code, o, ts.ScriptKind.TS)) {
                out.push(remap(t, start.line, start.column));
            }
        };

        const emitLit = (value: unknown, host: any) =>
            emitStruct(o.ignoreLiterals ? VUE_LIT : `${VUE}lit:${JSON.stringify(value)}`, host);

        // Каноничный образ директивы: имя + статический arg + модификаторы.
        // :class -> VUE:bind:class ; @click.stop -> VUE:on:click.stop ; v-if -> VUE:if
        const directiveImage = (dir: any): string => {
            let image = `${VUE}${dir.name}`;
            if (dir.arg && dir.arg.isStatic !== false && typeof dir.arg.content === 'string') {
                image += `:${dir.arg.content}`;
            }
            for (const m of dir.modifiers ?? []) {
                const content = typeof m === 'string' ? m : m?.content;
                if (content) image += `.${content}`;
            }
            return image;
        };

        const walkProp = (prop: any) => {
            if (!prop) return;
            if (prop.type === N_ATTRIBUTE) {
                emitStruct(`${VUE}@${prop.name}`, prop);
                const value = prop.value;
                if (value && typeof value.content === 'string' && value.content.length) emitLit(value.content, value);
                return;
            }
            if (prop.type === N_DIRECTIVE) {
                emitStruct(directiveImage(prop), prop);
                // Динамический arg (:[key]) — это выражение, статический уже в образе.
                if (prop.arg && prop.arg.isStatic === false) emitExpr(prop.arg);
                if (prop.exp) emitExpr(prop.exp);
            }
        };

        const walk = (node: any) => {
            if (!node) return;
            switch (node.type) {
                case N_ELEMENT:
                    emitStruct(`${VUE}<${node.tag}`, node);
                    for (const p of node.props ?? []) walkProp(p);
                    for (const c of node.children ?? []) walk(c);
                    return;
                case N_TEXT:
                    if (typeof node.content === 'string' && node.content.trim()) emitStruct(VUE_TEXT, node);
                    return;
                case N_COMMENT:
                    return;
                case N_INTERPOLATION:
                    emitExpr(node.content);
                    return;
                default:
                    // ROOT и прочие контейнеры — спускаемся по детям.
                    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
            }
        };

        out.push({ image: '', line: tmpl.loc?.start?.line ?? 1, column: tmpl.loc?.start?.column ?? 1, barrier: true });
        walk(tmpl.ast);
    }

    return out;
}
