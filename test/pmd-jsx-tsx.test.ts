import * as ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { Cpd } from '../src/index';
import { tokenizeTypeScript } from '../src/tokenizers';

describe('JSX and TSX tokenization', () => {
    test('tokenizes JavaScript natively without PMD typescript massaging', () => {
        const source = 'const copy = (value) => ({ ...value });';
        const images = tokenizeTypeScript('sample.js', source, {}, ts.ScriptKind.JS).map((token) => token.image);

        // PMD typescript compatibility is .ts-only: .js arrow/spread stay single tokens.
        expect(images).toContain('=>');
        expect(images).toContain('...');
    });

    test('keeps .js native regardless of the PMD typescript flag', () => {
        const source = 'const copy = (value) => ({ ...value });';
        const on = tokenizeTypeScript('sample.js', source, { pmdTypescriptCompatibility: true }, ts.ScriptKind.JS).map(
            (token) => token.image
        );
        const off = tokenizeTypeScript(
            'sample.js',
            source,
            { pmdTypescriptCompatibility: false },
            ts.ScriptKind.JS
        ).map((token) => token.image);

        expect(on).toEqual(off);
        expect(on).toContain('=>');
    });

    test('keeps arrow and spread intact for TypeScript', () => {
        const source = 'const copy = (value: Data) => ({ ...value });';
        const images = tokenizeTypeScript('sample.ts', source, {}, ts.ScriptKind.TS).map((token) => token.image);

        expect(images).toContain('=>');
        expect(images).toContain('...');
    });

    test('collapses regexp literals for TS in PMD typescript mode by default', () => {
        const source = 'const pattern = /^foo[0-9]+$/i;';
        const images = tokenizeTypeScript('sample.ts', source, {}, ts.ScriptKind.TS).map((token) => token.image);

        expect(images).toEqual(['const', 'pattern', '=', '/^foo[0-9]+$/i', ';']);
    });

    test('keeps native scanner regexp tokens when PMD typescript compatibility is disabled', () => {
        const source = 'const pattern = /^foo[0-9]+$/i;';
        const images = tokenizeTypeScript(
            'sample.ts',
            source,
            { pmdTypescriptCompatibility: false },
            ts.ScriptKind.TS
        ).map((token) => token.image);

        expect(images).not.toContain('/^foo[0-9]+$/i');
        expect(images).toContain('/');
        expect(images).toContain('^');
    });

    test('tokenizes JSX text and expressions without dropping structural tokens', () => {
        const source = 'export const View = () => <section><h1>{title}</h1><p>Hello</p></section>;';
        const images = tokenizeTypeScript(
            'View.jsx',
            source,
            { ignoreIdentifiers: false, ignoreLiterals: false },
            ts.ScriptKind.JSX
        ).map((token) => token.image);

        expect(images).toContain('<');
        expect(images).toContain('section');
        expect(images).toContain('title');
        expect(images).toContain('Hello');
    });

    test('detects duplicate TSX component structure', () => {
        const cpd = new Cpd({
            minTileSize: 10,
            ignoreIdentifiers: true,
            ignoreLiterals: true,
        });
        cpd.addSource(
            'A.tsx',
            'export function A({title}: {title: string}) { return <Card><h2>{title}</h2><Button /></Card>; }'
        );
        cpd.addSource(
            'B.tsx',
            'export function B({label}: {label: string}) { return <Card><h2>{label}</h2><Button /></Card>; }'
        );

        const matches = cpd.run();

        expect(matches).toHaveLength(1);
        expect(matches[0].marks.map((mark) => mark.token.file)).toEqual(['A.tsx', 'B.tsx']);
    });
});

describe('Template literal granularity (--pmd-typescript-compatibility)', () => {
    const src = `const msg = \`hi \${alpha} mid \${beta}\`;`;

    test('TS default splits a template into PMD typescript per-atom tokens', () => {
        const images = tokenizeTypeScript('x.ts', src, {}, ts.ScriptKind.TS).map((token) => token.image);

        // grammar TypeScriptLexer.g4: backtick / ${ / } and one token per text char.
        expect(images).toEqual([
            'const',
            'msg',
            '=',
            '`',
            'h',
            'i',
            ' ',
            '${',
            'alpha',
            '}',
            ' ',
            'm',
            'i',
            'd',
            ' ',
            '${',
            'beta',
            '}',
            '`',
            ';',
        ]);
    });

    test('TS with the flag disabled keeps the template as one native token', () => {
        const images = tokenizeTypeScript('x.ts', src, { pmdTypescriptCompatibility: false }, ts.ScriptKind.TS).map(
            (token) => token.image
        );

        expect(images).toEqual(['const', 'msg', '=', `\`hi \${alpha} mid \${beta}\``, ';']);
    });

    test('JavaScript keeps a template as one token (compat is TS-only)', () => {
        const images = tokenizeTypeScript('x.js', src, {}, ts.ScriptKind.JS).map((token) => token.image);

        expect(images).toEqual(['const', 'msg', '=', `\`hi \${alpha} mid \${beta}\``, ';']);
    });

    test('TS keeps interpolation braces balanced against object literals', () => {
        const images = tokenizeTypeScript('x.ts', `const a = \`p\${ {k:1} }q\`;`, {}, ts.ScriptKind.TS).map(
            (token) => token.image
        );

        expect(images).toEqual(['const', 'a', '=', '`', 'p', '${', '{', 'k', ':', '1', '}', '}', 'q', '`', ';']);
    });

    test('TS splits nested template literals', () => {
        const images = tokenizeTypeScript('x.ts', `const a = \`x\${ \`y\${z}\` }w\`;`, {}, ts.ScriptKind.TS).map(
            (token) => token.image
        );

        expect(images).toEqual(['const', 'a', '=', '`', 'x', '${', '`', 'y', '${', 'z', '}', '`', '}', 'w', '`', ';']);
    });
});
