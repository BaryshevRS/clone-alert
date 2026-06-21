import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe('package metadata', () => {
    test('declares frontend parsers as optional peer dependencies', () => {
        const parserPackages = ['@angular/compiler', '@vue/compiler-sfc', 'svelte'];

        for (const name of parserPackages) {
            expect(pkg.peerDependencies?.[name]).toEqual(expect.any(String));
            expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true);
        }
    });
});
