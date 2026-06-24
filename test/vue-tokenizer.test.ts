import { describe, expect, test } from 'vitest';
import { S, TS_ID, TS_LIT } from '../src/core';
import { Cpd } from '../src/index';
import { tokenizeVue } from '../src/vue';

// Structural markup images live in the S-prefixed namespace (see src/vue.ts):
// tags/directives/attributes do not match script tokens. Expressions inside
// {{…}} and bindings are intentionally UNPREFIXED — it is the same TS, so a
// template<->script duplicate is caught.
const VUE = `${S}VUE:`;
const VUE_TEXT = `${S}VUETEXT`;
const VUE_LIT = `${S}VUELIT`;

const img = (template: string, opts?: Parameters<typeof tokenizeVue>[2]) =>
    tokenizeVue('t.vue', `<template>${template}</template>`, opts).map((t) => t.image);

describe('Vue tokenizer — markup structure', () => {
    test('tags and static text', () => {
        // the first token is the barrier before the template (image '')
        expect(img('<div><span>hi</span></div>')).toEqual(['', `${VUE}<div`, `${VUE}<span`, VUE_TEXT]);
    });

    test('deep nesting preserves order', () => {
        expect(img('<div><section><p>x</p></section></div>')).toEqual([
            '',
            `${VUE}<div`,
            `${VUE}<section`,
            `${VUE}<p`,
            VUE_TEXT,
        ]);
    });

    test('static attribute: name is structural, value -> literal', () => {
        expect(img('<div role="alert">x</div>')).toEqual([
            '',
            `${VUE}<div`,
            `${VUE}@role`,
            `${VUE}lit:"alert"`,
            VUE_TEXT,
        ]);
    });
});

describe('Vue tokenizer — directives and expressions (expressions are unprefixed)', () => {
    test(':bind with an argument -> structural image + expression', () => {
        expect(img('<div :class="cls">x</div>')).toEqual(['', `${VUE}<div`, `${VUE}bind:class`, 'cls', VUE_TEXT]);
    });

    test('@on with modifiers is encoded into the directive image', () => {
        expect(img('<button @click.stop="go(x)" />')).toEqual([
            '',
            `${VUE}<button`,
            `${VUE}on:click.stop`,
            'go',
            '(',
            'x',
            ')',
        ]);
    });

    test('v-if -> structural image + condition expression', () => {
        expect(img('<p v-if="a && b">x</p>')).toEqual(['', `${VUE}<p`, `${VUE}if`, 'a', '&&', 'b', VUE_TEXT]);
    });

    test('interpolation {{ }} -> expression only', () => {
        expect(img('<p>{{ a + b }}</p>')).toEqual(['', `${VUE}<p`, 'a', '+', 'b']);
    });

    test('different expressions yield different tokens', () => {
        expect(img('<p>{{ a }}</p>')).not.toEqual(img('<p>{{ b }}</p>'));
    });

    test('dynamic arg :[key] -> bind image without arg + arg expression + value expression', () => {
        // arg.isStatic === false: the static arg does NOT go into the image; both
        // ([key] and value) go to emitExpr as TS (see src/vue.ts walkProp -> dynamic arg).
        expect(img('<div :[key]="val">x</div>')).toEqual([
            '',
            `${VUE}<div`,
            `${VUE}bind`,
            '[',
            'key',
            ']',
            'val',
            VUE_TEXT,
        ]);
    });

    test('dynamic event @[ev] -> on image without arg + arg expression + handler', () => {
        expect(img('<button @[ev]="go" />')).toEqual(['', `${VUE}<button`, `${VUE}on`, '[', 'ev', ']', 'go']);
    });
});

describe('Vue tokenizer — <script setup> and normalization', () => {
    test('script setup is tokenized as TS (with a barrier at the end)', () => {
        const toks = tokenizeVue('t.vue', '<script setup lang="ts">let x = foo(1);</script>').map((t) => t.image);
        expect(toks).toEqual(['let', 'x', '=', 'foo', '(', '1', ')', ';', '']);
    });

    test('Options API <script> (no setup) is tokenized as block code', () => {
        // The loop in src/vue.ts runs BOTH blocks (scriptSetup and script). Options-API
        // data() is the most common source of duplicates in real .vue files (see the vuetify run).
        const toks = tokenizeVue('t.vue', '<script>export default { data () { return { x: foo(1) } } }</script>').map(
            (t) => t.image
        );
        expect(toks).toEqual([
            'export',
            'default',
            '{',
            'data',
            '(',
            ')',
            '{',
            'return',
            '{',
            'x',
            ':',
            'foo',
            '(',
            '1',
            ')',
            '}',
            '}',
            '}',
            '',
        ]);
    });

    test('ignoreIdentifiers collapses expression identifiers', () => {
        expect(img('<p>{{ a + b }}</p>', { ignoreIdentifiers: true })).toEqual(['', `${VUE}<p`, TS_ID, '+', TS_ID]);
    });

    test('ignoreLiterals collapses both an expression literal and a static attribute', () => {
        expect(img('<p :title="\'hi\'" role="x">{{ 1 }}</p>', { ignoreLiterals: true })).toEqual([
            '',
            `${VUE}<p`,
            `${VUE}bind:title`,
            TS_LIT,
            `${VUE}@role`,
            VUE_LIT,
            TS_LIT,
        ]);
    });
});

describe('Vue tokenizer — vueTemplates toggle', () => {
    const src = '<script setup>let x = foo(1)</script><template><div>{{ a + b }}</div></template>';

    test('markup is tokenized by default', () => {
        expect(tokenizeVue('t.vue', src).map((t) => t.image)).toContain(`${VUE}<div`);
    });

    test('vueTemplates:false -> <script> only, no markup', () => {
        const toks = tokenizeVue('t.vue', src, { vueTemplates: false }).map((t) => t.image);
        expect(toks.some((t) => t.startsWith(VUE))).toBe(false);
        expect(toks).toEqual(['let', 'x', '=', 'foo', '(', '1', ')', '']);
    });
});

describe('Vue tokenizer — robustness', () => {
    test('empty source -> []', () => {
        expect(tokenizeVue('t.vue', '')).toEqual([]);
    });

    test('a comment-only template -> barrier only', () => {
        expect(img('<!-- nothing -->')).toEqual(['']);
    });

    test('broken markup does not crash the tokenizer', () => {
        expect(() => img('<div><span>oops')).not.toThrow();
    });
});

describe('Cpd — clone detection in .vue (e2e)', () => {
    const sfc = (markup: string) => `<template>${markup}</template>`;
    const markup =
        '<div :class="wrap"><p>{{ user.name }}</p><span>{{ user.age }}</span><a :href="user.url">go</a></div>';

    test('identical markup is detected as a clone', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.vue', sfc(markup));
        cpd.addSource('b.vue', sfc(markup));
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].markCount).toBe(2);
    });

    test('structurally different markup does not match', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.vue', sfc(markup));
        cpd.addSource('b.vue', sfc('<ul><li>{{ x }}</li></ul>'));
        expect(cpd.run()).toHaveLength(0);
    });

    test('a template expression CROSS-matches the same code in .ts (same language, same scope)', () => {
        const expr = 'compute(order.items, user.profile.id, tax.rate)';
        const cpd = new Cpd({ minTileSize: 10 });
        cpd.addSource('logic.ts', `const r = ${expr};`);
        cpd.addSource('view.vue', sfc(`<p>{{ ${expr} }}</p>`));
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        const files = matches[0].marks.map((m) => m.token.file).sort();
        expect(files).toEqual(['logic.ts', 'view.vue']);
    });

    test('markup structure does NOT cross-match script', () => {
        const cpd = new Cpd({ minTileSize: 3 });
        cpd.addSource('a.ts', 'const div = span; const p = a;');
        cpd.addSource('b.vue', sfc('<div><span></span><p></p><a></a></div>'));
        expect(cpd.run()).toHaveLength(0);
    });
});
