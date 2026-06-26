import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const actionYml = fs.readFileSync(path.resolve(__dirname, '..', 'action.yml'), 'utf-8');

function actionInputDefault(inputName: string): string | undefined {
    const lines = actionYml.split('\n');
    const inputStart = lines.findIndex((line) => line === `  ${inputName}:`);

    if (inputStart === -1) {
        return undefined;
    }

    for (const line of lines.slice(inputStart + 1)) {
        if (/^ {2}[a-z0-9-]+:$/i.test(line)) {
            return undefined;
        }

        const defaultMatch = /^ {4}default: ['"]([^'"]*)['"]$/.exec(line);
        if (defaultMatch) {
            return defaultMatch[1];
        }
    }

    return undefined;
}

describe('package metadata', () => {
    test('declares frontend parsers as optional peer dependencies', () => {
        const parserPackages = ['@angular/compiler', '@vue/compiler-sfc', 'svelte'];

        for (const name of parserPackages) {
            expect(pkg.peerDependencies?.[name]).toEqual(expect.any(String));
            expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true);
        }
    });

    test('defaults GitHub Action clone detection to a less noisy threshold', () => {
        expect(actionInputDefault('minimum-tokens')).toBe('100');
    });
});
