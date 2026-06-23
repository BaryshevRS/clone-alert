import { describe, expect, test } from 'vitest';
import { S, TS_ID, TS_LIT } from '../src/core';
import { Cpd } from '../src/index';
import { tokenizeVue } from '../src/vue';

// Структурные образы разметки лежат в S-префиксованном неймспейсе (см. src/vue.ts):
// теги/директивы/атрибуты не матчатся со script-токенами. Выражения внутри
// {{…}} и биндингов намеренно БЕЗ префикса — это тот же TS, дубль шаблон<->script ловится.
const VUE = `${S}VUE:`;
const VUE_TEXT = `${S}VUETEXT`;
const VUE_LIT = `${S}VUELIT`;

const img = (template: string, opts?: Parameters<typeof tokenizeVue>[2]) =>
    tokenizeVue('t.vue', `<template>${template}</template>`, opts).map((t) => t.image);

describe('Vue tokenizer — структура разметки', () => {
    test('теги и статический текст', () => {
        // первый токен — барьер перед шаблоном (image '')
        expect(img('<div><span>hi</span></div>')).toEqual(['', `${VUE}<div`, `${VUE}<span`, VUE_TEXT]);
    });

    test('глубокая вложенность сохраняет порядок', () => {
        expect(img('<div><section><p>x</p></section></div>')).toEqual([
            '',
            `${VUE}<div`,
            `${VUE}<section`,
            `${VUE}<p`,
            VUE_TEXT,
        ]);
    });

    test('статический атрибут: имя структурно, значение -> литерал', () => {
        expect(img('<div role="alert">x</div>')).toEqual([
            '',
            `${VUE}<div`,
            `${VUE}@role`,
            `${VUE}lit:"alert"`,
            VUE_TEXT,
        ]);
    });
});

describe('Vue tokenizer — директивы и выражения (выражения не префиксованы)', () => {
    test(':bind с аргументом -> структурный образ + выражение', () => {
        expect(img('<div :class="cls">x</div>')).toEqual(['', `${VUE}<div`, `${VUE}bind:class`, 'cls', VUE_TEXT]);
    });

    test('@on с модификаторами кодируется в образ директивы', () => {
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

    test('v-if -> структурный образ + выражение-условие', () => {
        expect(img('<p v-if="a && b">x</p>')).toEqual(['', `${VUE}<p`, `${VUE}if`, 'a', '&&', 'b', VUE_TEXT]);
    });

    test('интерполяция {{ }} -> только выражение', () => {
        expect(img('<p>{{ a + b }}</p>')).toEqual(['', `${VUE}<p`, 'a', '+', 'b']);
    });

    test('разные выражения дают разные токены', () => {
        expect(img('<p>{{ a }}</p>')).not.toEqual(img('<p>{{ b }}</p>'));
    });

    test('динамический arg :[key] -> образ bind без arg + выражение arg + выражение значения', () => {
        // arg.isStatic === false: статический arg НЕ попадает в образ, оба ([key] и value)
        // уходят в emitExpr как TS (см. src/vue.ts walkProp -> dynamic arg).
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

    test('динамический event @[ev] -> образ on без arg + выражение arg + обработчик', () => {
        expect(img('<button @[ev]="go" />')).toEqual(['', `${VUE}<button`, `${VUE}on`, '[', 'ev', ']', 'go']);
    });
});

describe('Vue tokenizer — <script setup> и нормализация', () => {
    test('script setup токенизируется как TS (с барьером в конце)', () => {
        const toks = tokenizeVue('t.vue', '<script setup lang="ts">let x = foo(1);</script>').map((t) => t.image);
        expect(toks).toEqual(['let', 'x', '=', 'foo', '(', '1', ')', ';', '']);
    });

    test('Options API <script> (без setup) токенизируется как код блока', () => {
        // Петля в src/vue.ts гоняет ОБА блока (scriptSetup и script). Options-API data()
        // — самый частый источник дублей в боевых .vue (см. прогон vuetify).
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

    test('ignoreIdentifiers схлопывает идентификаторы выражений', () => {
        expect(img('<p>{{ a + b }}</p>', { ignoreIdentifiers: true })).toEqual(['', `${VUE}<p`, TS_ID, '+', TS_ID]);
    });

    test('ignoreLiterals схлопывает литерал выражения и статического атрибута', () => {
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

describe('Vue tokenizer — тумблер vueTemplates', () => {
    const src = '<script setup>let x = foo(1)</script><template><div>{{ a + b }}</div></template>';

    test('по умолчанию разметка токенизируется', () => {
        expect(tokenizeVue('t.vue', src).map((t) => t.image)).toContain(`${VUE}<div`);
    });

    test('vueTemplates:false -> только <script>, разметки нет', () => {
        const toks = tokenizeVue('t.vue', src, { vueTemplates: false }).map((t) => t.image);
        expect(toks.some((t) => t.startsWith(VUE))).toBe(false);
        expect(toks).toEqual(['let', 'x', '=', 'foo', '(', '1', ')', '']);
    });
});

describe('Vue tokenizer — устойчивость', () => {
    test('пустой источник -> []', () => {
        expect(tokenizeVue('t.vue', '')).toEqual([]);
    });

    test('только комментарий в шаблоне -> только барьер', () => {
        expect(img('<!-- nothing -->')).toEqual(['']);
    });

    test('битая разметка не роняет токенайзер', () => {
        expect(() => img('<div><span>oops')).not.toThrow();
    });
});

describe('Cpd — обнаружение клонов в .vue (e2e)', () => {
    const sfc = (markup: string) => `<template>${markup}</template>`;
    const markup =
        '<div :class="wrap"><p>{{ user.name }}</p><span>{{ user.age }}</span><a :href="user.url">go</a></div>';

    test('одинаковая разметка находится как клон', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.vue', sfc(markup));
        cpd.addSource('b.vue', sfc(markup));
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].markCount).toBe(2);
    });

    test('структурно разная разметка не матчится', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.vue', sfc(markup));
        cpd.addSource('b.vue', sfc('<ul><li>{{ x }}</li></ul>'));
        expect(cpd.run()).toHaveLength(0);
    });

    test('выражение шаблона КРОСС-матчится с тем же кодом в .ts (один язык, один скоуп)', () => {
        const expr = 'compute(order.items, user.profile.id, tax.rate)';
        const cpd = new Cpd({ minTileSize: 10 });
        cpd.addSource('logic.ts', `const r = ${expr};`);
        cpd.addSource('view.vue', sfc(`<p>{{ ${expr} }}</p>`));
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        const files = matches[0].marks.map((m) => m.token.file).sort();
        expect(files).toEqual(['logic.ts', 'view.vue']);
    });

    test('структура разметки НЕ кросс-матчится со script', () => {
        const cpd = new Cpd({ minTileSize: 3 });
        cpd.addSource('a.ts', 'const div = span; const p = a;');
        cpd.addSource('b.vue', sfc('<div><span></span><p></p><a></a></div>'));
        expect(cpd.run()).toHaveLength(0);
    });
});
