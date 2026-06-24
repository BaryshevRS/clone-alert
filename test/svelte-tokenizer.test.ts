import { describe, expect, test } from 'vitest';
import { S, TS_ID, TS_LIT } from '../src/core';
import { Cpd } from '../src/index';
import { tokenizeSvelte } from '../src/svelte';

// Structural markup images live in the S-prefixed namespace (see src/svelte.ts):
// tags/blocks/directives do not match script tokens. Expressions inside {...} are
// intentionally UNPREFIXED — it is the same TS, so a template<->script duplicate is caught.
const SV = `${S}SV:`;
const SV_TEXT = `${S}SVTEXT`;

const img = (src: string, opts?: Parameters<typeof tokenizeSvelte>[2]) =>
    tokenizeSvelte('t.svelte', src, opts).map((t) => t.image);

describe('Svelte tokenizer — markup structure', () => {
    test('tags and static text', () => {
        expect(img('<div><span>hi</span></div>')).toEqual([`${SV}<div`, `${SV}<span`, SV_TEXT]);
    });

    test('deep nesting preserves order', () => {
        expect(img('<div><section><p>x</p></section></div>')).toEqual([
            `${SV}<div`,
            `${SV}<section`,
            `${SV}<p`,
            SV_TEXT,
        ]);
    });

    test('static attribute: name is structural, value -> text', () => {
        expect(img('<div class="box">x</div>')).toEqual([`${SV}<div`, `${SV}@class`, SV_TEXT, SV_TEXT]);
    });

    test('void element with a binding and a handler', () => {
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

describe('Svelte tokenizer — {...} expressions (unprefixed)', () => {
    test('attribute expression', () => {
        expect(img('<div class={cls}>x</div>')).toEqual([`${SV}<div`, `${SV}@class`, 'cls', SV_TEXT]);
    });

    test('binary operator', () => {
        expect(img('<p>{a + b}</p>')).toEqual([`${SV}<p`, 'a', '+', 'b']);
    });

    test('{@render} expands the call', () => {
        expect(img('{@render children?.()}')).toEqual(['children', '?.', '(', ')']);
    });

    test('different expressions yield different tokens', () => {
        expect(img('<p>{a}</p>')).not.toEqual(img('<p>{b}</p>'));
    });
});

describe('Svelte tokenizer — blocks', () => {
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

    test('{#each} with a key', () => {
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
    test('script is tokenized as TS (with a barrier at the end)', () => {
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

describe('Svelte tokenizer — normalization', () => {
    test('ignoreIdentifiers collapses expression identifiers only', () => {
        expect(img('<p>{a + b}</p>', { ignoreIdentifiers: true })).toEqual([`${SV}<p`, TS_ID, '+', TS_ID]);
    });

    test('ignoreLiterals collapses an expression literal', () => {
        expect(img('<p>{"hi"}</p>', { ignoreLiterals: true })).toEqual([`${SV}<p`, TS_LIT]);
    });
});

describe('Svelte tokenizer — svelteTemplates toggle', () => {
    const src = '<script>let x = foo(1);</script><div>{a + b}</div>';

    test('markup is tokenized by default', () => {
        expect(img(src)).toContain(`${SV}<div`);
    });

    test('svelteTemplates:false -> <script> only, no markup', () => {
        const toks = img(src, { svelteTemplates: false });
        expect(toks.some((t) => t.startsWith(SV))).toBe(false);
        expect(toks).toEqual(['let', 'x', '=', 'foo', '(', '1', ')', ';', '']);
    });
});

describe('Svelte tokenizer — robustness', () => {
    test('empty source and whitespace -> []', () => {
        expect(img('')).toEqual([]);
        expect(img('   \n  ')).toEqual([]);
    });

    test('comment only -> []', () => {
        expect(img('<!-- nothing -->')).toEqual([]);
    });

    test('broken markup does not crash the tokenizer', () => {
        expect(() => img('<div><span>oops')).not.toThrow();
    });
});

describe('Cpd — clone detection in .svelte (e2e)', () => {
    const markup = '<div class={wrap}><p>{user.name}</p><span>{user.age}</span><a href={user.url}>go</a></div>';

    test('identical markup is detected as a clone', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.svelte', markup);
        cpd.addSource('b.svelte', markup);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].markCount).toBe(2);
    });

    test('structurally different markup does not match', () => {
        const cpd = new Cpd({ minTileSize: 8 });
        cpd.addSource('a.svelte', markup);
        cpd.addSource('b.svelte', '<ul><li>{x}</li></ul>');
        expect(cpd.run()).toHaveLength(0);
    });

    test('a template expression CROSS-matches the same code in .ts (same language, same scope)', () => {
        const expr = 'compute(order.items, user.profile.id, tax.rate)';
        const cpd = new Cpd({ minTileSize: 10 });
        cpd.addSource('logic.ts', `const r = ${expr};`);
        cpd.addSource('view.svelte', `<p>{${expr}}</p>`);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        const files = matches[0].marks.map((m) => m.token.file).sort();
        expect(files).toEqual(['logic.ts', 'view.svelte']);
    });

    test('markup structure does NOT cross-match script', () => {
        const cpd = new Cpd({ minTileSize: 3 });
        cpd.addSource('a.ts', 'const div = span; const p = a;');
        cpd.addSource('b.svelte', '<div><span></span><p></p><a></a></div>');
        expect(cpd.run()).toHaveLength(0);
    });
});
