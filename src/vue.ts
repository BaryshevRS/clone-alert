/**
 * `.vue` tokenizer: `<script>`/`<script setup>` + markup (descriptor.template.ast).
 * Built on top of the shared layer in tokenizers.ts (optional/moduleResolveDirs/
 * remap/tokenizeTypeScript) and the sentinel `S` from core.ts. The core knows
 * nothing about Vue. Modeled on src/svelte.ts and src/angular.ts.
 *
 * Two token layers:
 *   1. markup structure (tags, directives, attribute names/values, static text)
 *      -> images with the VUE prefix (via the sentinel S), so they do NOT match
 *      script tokens;
 *   2. binding/interpolation expressions (`{{ … }}`, `:prop`, `v-if`, `@event`)
 *      -> the same TypeScript in the same component scope, so we slice the source
 *      and run it through the shared tokenizeTypeScript WITHOUT a prefix, so a
 *      duplicated expression across template<->script is caught.
 *
 * @packageDocumentation
 */
import * as ts from 'typescript';
import { type RawToken, S } from './core';
import { DEFAULTS, moduleResolveDirs, optional, remap, type TokenizeOptions, tokenizeTypeScript } from './tokenizers';

const VUE = `${S}VUE:`; // structural markup marker
const VUE_TEXT = `${S}VUETEXT`; // non-empty static text
const VUE_LIT = `${S}VUELIT`; // normalized static attribute value (ignoreLiterals)

// Numeric NodeTypes from @vue/compiler-core; stable across all of Vue 3.
const N_ELEMENT = 1;
const N_TEXT = 2;
const N_COMMENT = 3;
const N_INTERPOLATION = 5;
const N_ATTRIBUTE = 6;
const N_DIRECTIVE = 7;

let warnedVue = false;

/** Tokenize a `.vue` single-file component (`<script>` blocks + markup). */
export function tokenizeVue(filePath: string, source: string, options: TokenizeOptions = {}): RawToken[] {
    const o = { ...DEFAULTS, ...options };
    const sfc = optional<{ parse: (src: string, opts: any) => any }>('@vue/compiler-sfc', moduleResolveDirs(filePath));
    if (!sfc || typeof sfc.parse !== 'function') {
        if (!warnedVue) {
            console.warn('[cpd] .vue skipped: install @vue/compiler-sfc');
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

    // --- <script setup> and <script>: plain TS/JS, like a regular file ---
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

    // --- Markup ---
    // Tokenized only when the toggle is on (default yes). Markup and script are
    // usually run at different --minimum-tokens thresholds.
    const tmpl = descriptor.template;
    if ((o.vueTemplates ?? true) && tmpl?.ast) {
        // Vue node coordinates (loc.start.{line,column}) are already absolute to the
        // file and 1-based — no offset->line/col map is needed (unlike svelte.ts).
        const emitStruct = (image: string, node: any) => {
            const loc = node?.loc?.start;
            out.push({ image, line: loc?.line ?? 1, column: loc?.column ?? 1 });
        };

        // SIMPLE_EXPRESSION -> slice the source -> shared TS tokenizer -> remap.
        // id/literal normalization is done by tokenizeTypeScript itself (it is real TS).
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

        // Canonical directive image: name + static arg + modifiers.
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
                // Dynamic arg (:[key]) is an expression; the static arg is already in the image.
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
                    // ROOT and other containers — descend into children.
                    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
            }
        };

        out.push({ image: '', line: tmpl.loc?.start?.line ?? 1, column: tmpl.loc?.start?.column ?? 1, barrier: true });
        walk(tmpl.ast);
    }

    return out;
}
