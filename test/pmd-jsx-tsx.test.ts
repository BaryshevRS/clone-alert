import * as ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { Cpd } from '../src/index';
import { tokenizeTypeScript } from '../src/tokenizers';

describe('JSX and TSX tokenization', () => {
    test('uses PMD ecmascript token granularity for JS by default', () => {
        const source = 'const copy = (value) => ({ ...value, nested: { ...value.data } });';
        const images = tokenizeTypeScript('sample.js', source, {}, ts.ScriptKind.JS).map((token) => token.image);

        expect(images).not.toContain('=>');
        expect(images).not.toContain('...');
        expect(images).toEqual([
            'const',
            'copy',
            '=',
            '(',
            'value',
            ')',
            '=',
            '>',
            '(',
            '{',
            '.',
            '.',
            '.',
            'value',
            ',',
            'nested',
            ':',
            '{',
            '.',
            '.',
            '.',
            'value',
            '.',
            'data',
            '}',
            '}',
            ')',
            ';',
        ]);
    });

    test('can keep native TypeScript scanner tokens when PMD ecmascript compatibility is disabled', () => {
        const source = 'const copy = (value) => ({ ...value });';
        const images = tokenizeTypeScript(
            'sample.js',
            source,
            { pmdEcmascriptCompatibility: false },
            ts.ScriptKind.JS
        ).map((token) => token.image);

        expect(images).toContain('=>');
        expect(images).toContain('...');
    });

    test('does not apply PMD ecmascript compatibility to TS tokenization', () => {
        const source = 'const copy = (value: Data) => ({ ...value });';
        const images = tokenizeTypeScript('sample.ts', source, {}, ts.ScriptKind.TS).map((token) => token.image);

        expect(images).toContain('=>');
        expect(images).toContain('...');
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
