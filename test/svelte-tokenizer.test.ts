import { describe, expect, test } from 'vitest';
import { S, TS_ID, TS_LIT } from '../src/core';
import { Cpd } from '../src/index';
import { tokenizeSvelte } from '../src/svelte';

// Структурные образы разметки лежат в S-префиксованном неймспейсе (см. src/svelte.ts):
// теги/блоки/директивы не матчатся со script-токенами. Выражения внутри {...}
// намеренно БЕЗ префикса — это тот же TS, дубль шаблон<->script ловится.
const SV = `${S}SV:`;
const SV_TEXT = `${S}SVTEXT`;

const img = (src: string, opts?: Parameters<typeof tokenizeSvelte>[2]) =>
    tokenizeSvelte('t.svelte', src, opts).map((t) => t.image);

describe('Svelte tokenizer — структура разметки', () => {
    test('теги и статический текст', () => {
        expect(img('<div><span>hi</span></div>')).toEqual([`${SV}<div`, `${SV}<span`, SV_TEXT]);
    });

    test('глубокая вложенность сохраняет порядок', () => {
        expect(img('<div><section><p>x</p></section></div>')).toEqual([
            `${SV}<div`,
            `${SV}<section`,
            `${SV}<p`,
            SV_TEXT,
        ]);
    });

    test('статический атрибут: имя структурно, значение -> текст', () => {
        expect(img('<div class="box">x</div>')).toEqual([`${SV}<div`, `${SV}@class`, SV_TEXT, SV_TEXT]);
    });

    test('void-элемент с биндингом и обработчиком', () => {
        expect(img('<input bind:value={q} onclick={() => go(q)} />')).toEqual([
            `${SV}<input`,
            `${SV}bind:value`,
            'q',
            `${SV}@onclick`,
            '(',
            ')',
            '=>',
            'go',
            '(',
            'q',
            ')',
        ]);
    });
});

describe('Svelte tokenizer — выражения {...} (не префиксованы)', () => {
    test('атрибут-выражение', () => {
        expect(img('<div class={cls}>x</div>')).toEqual([`${SV}<div`, `${SV}@class`, 'cls', SV_TEXT]);
    });

    test('бинарный оператор', () => {
        expect(img('<p>{a + b}</p>')).toEqual([`${SV}<p`, 'a', '+', 'b']);
    });

    test('{@render} разворачивает вызов', () => {
        expect(img('{@render children?.()}')).toEqual(['children', '?.', '(', ')']);
    });

    test('разные выражения дают разные токены', () => {
        expect(img('<p>{a}</p>')).not.toEqual(img('<p>{b}</p>'));
    });
});

describe('Svelte tokenizer — блоки', () => {
    test('{#if}/{:else}', () => {
        expect(img('{#if cond}<p>x</p>{:else}<b>y</b>{/if}')).toEqual([
            `${SV}#if`,
            'cond',
            `${SV}<p`,
            SV_TEXT,
            `${SV}<b`,
            SV_TEXT,
        ]);
    });

    test('{#each} с ключом', () => {
        expect(img('{#each items as item, i (item.id)}<li>{item}</li>{/each}')).toEqual([
            `${SV}#each`,
            'items',
            'item',
            '.',
            'id',
            `${SV}<li`,
            'item',
        ]);
    });

    test('{#snippet}', () => {
        expect(img('{#snippet row(x)}<td>{x}</td>{/snippet}')).toEqual([`${SV}#snippet`, `${SV}<td`, 'x']);
    });
});

describe('Svelte tokenizer — <script>', () => {
    test('script токенизируется как TS (с барьером в конце)', () => {
        expect(img('<script>let x = foo(1);</script>')).toEqual([
            'let',
            'x',
            '=',
            'foo',
            '(',
            '1',
            ')',
            ';',
            '', // barrier
        ]);
    });
});

describe('Svelte tokenizer — нормализация', () => {
    test('ignoreIdentifiers схлопывает только идентификаторы выражений', () => {
        expect(img('<p>{a + b}</p>', { ignoreIdentifiers: true })).toEqual([`${SV}<p`, TS_ID, '+', TS_ID]);
    });

    test('ignoreLiterals схлопывает литерал выражения', () => {
        expect(img('<p>{"hi"}</p>', { ignoreLiterals: true })).toEqual([`${SV}<p`, TS_LIT]);
    });
});

describe('Svelte tokenizer — тумблер svelteTemplates', () => {
    const src = '<script>let x = foo(1);</script><div>{a + b}</div>';

    test('по умолчанию разметка токенизируется', () => {
        expect(img(src)).toContain(`${SV}<div`);
    });

    test('svelteTemplates:false -> только <script>, разметки нет', () => {
        const toks = img(src, { svelteTemplates: false });
        expect(toks.some((t) => t.startsWith(SV))).toBe(false);
        expect(toks).toEqual(['let', 'x', '=', 'foo', '(', '1', ')', ';', '']);
    });
});

describe('Svelte tokenizer — устойчивость', () => {
    test('пустой источник и пробелы -> []', () => {
        expect(img('')).toEqual([]);
        expect(img('   \n  ')).toEqual([]);
    });

    test('только комментарий -> []', () => {
        expect(img('<!-- nothing -->')).toEqual([]);
    });

    test('битая разметка не роняет токенайзер', () => {
        expect(() => img('<div><span>oops')).not.toThrow();
    });
});

describe('Cpd — обнаружение клонов в .svelte (e2e)', () => {
    const markup = '<div class={wrap}><p>{user.name}</p><span>{user.age}</span><a href={user.url}>go</a></div>';

    test('одинаковая разметка находится как клон', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.svelte', markup);
        cpd.addSource('b.svelte', markup);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].markCount).toBe(2);
    });

    test('структурно разная разметка не матчится', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.svelte', markup);
        cpd.addSource('b.svelte', '<ul><li>{x}</li></ul>');
        expect(cpd.run()).toHaveLength(0);
    });

    test('выражение шаблона КРОСС-матчится с тем же кодом в .ts (один язык, один скоуп)', () => {
        const expr = 'compute(order.items, user.profile.id, tax.rate)';
        const cpd = new Cpd({ minTileSize: 10 });
        cpd.addSource('logic.ts', `const r = ${expr};`);
        cpd.addSource('view.svelte', `<p>{${expr}}</p>`);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        const files = matches[0].marks.map((m) => m.token.file).sort();
        expect(files).toEqual(['logic.ts', 'view.svelte']);
    });

    test('структура разметки НЕ кросс-матчится со script', () => {
        const cpd = new Cpd({ minTileSize: 3 });
        cpd.addSource('a.ts', 'const div = span; const p = a;');
        cpd.addSource('b.svelte', '<div><span></span><p></p><a></a></div>');
        expect(cpd.run()).toHaveLength(0);
    });
});
