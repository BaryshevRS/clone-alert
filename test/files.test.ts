import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { collectFiles } from '../src/files';

const TS = new Set(['.ts']);

// Build a tree from a { relativePath: contents } map and return its root. Any key
// is created with its parent directories; use it for .gitignore files too.
async function tree(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'clone-alert-files-'));
    for (const [rel, contents] of Object.entries(files)) {
        const full = path.join(root, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, contents);
    }
    return root;
}

// Results as root-relative posix paths, sorted, for stable assertions.
function rel(root: string, found: string[]): string[] {
    return found.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
}

test('recurses and keeps only the requested extensions', async () => {
    const root = await tree({
        'a.ts': '',
        'b.js': '',
        'sub/c.ts': '',
        'sub/d.md': '',
    });

    expect(rel(root, collectFiles([root], TS))).toEqual(['a.ts', 'sub/c.ts']);
});

test('always skips node_modules, .git and dist', async () => {
    const root = await tree({
        'a.ts': '',
        'node_modules/pkg/index.ts': '',
        'dist/a.ts': '',
        '.git/hooks/x.ts': '',
    });

    expect(rel(root, collectFiles([root], TS, [], false))).toEqual(['a.ts']);
});

test('--exclude globs prune the walk', async () => {
    const root = await tree({
        'src/a.ts': '',
        'src/generated/b.ts': '',
        'src/generated/deep/c.ts': '',
    });

    expect(rel(root, collectFiles([root], TS, ['**/generated/**']))).toEqual(['src/a.ts']);
});

test('a .gitignore in the scanned root is honored without a repo', async () => {
    const root = await tree({
        'a.ts': '',
        'b.ts': '',
        '.gitignore': 'b.ts\n',
    });

    expect(rel(root, collectFiles([root], TS))).toEqual(['a.ts']);
});

test('--no-gitignore scans files .gitignore would drop', async () => {
    const root = await tree({
        'a.ts': '',
        'b.ts': '',
        '.gitignore': 'b.ts\n',
    });

    expect(rel(root, collectFiles([root], TS, [], false))).toEqual(['a.ts', 'b.ts']);
});

test('directory-only patterns ignore the dir but not a same-named file', async () => {
    const root = await tree({
        'build/x.ts': '',
        'build.ts': '',
        '.gitignore': 'build/\n',
    });

    expect(rel(root, collectFiles([root], TS))).toEqual(['build.ts']);
});

test('floating patterns match at any depth, anchored ones only at the root', async () => {
    const root = await tree({
        'tmp.ts': '',
        'sub/tmp.ts': '',
        'root.ts': '',
        'sub/root.ts': '',
        '.gitignore': 'tmp.ts\n/root.ts\n',
    });

    // `tmp.ts` (no slash) matches at every level; `/root.ts` is anchored to the root.
    expect(rel(root, collectFiles([root], TS))).toEqual(['sub/root.ts']);
});

test('** spans directories', async () => {
    const root = await tree({
        'src/keep.ts': '',
        'src/gen/a.ts': '',
        'src/gen/deep/b.ts': '',
        '.gitignore': 'src/**/a.ts\nsrc/gen/deep/\n',
    });

    expect(rel(root, collectFiles([root], TS))).toEqual(['src/keep.ts']);
});

test('a negation re-includes a file ignored by a parent .gitignore', async () => {
    const root = await tree({
        'secret.ts': '',
        'sub/secret.ts': '',
        '.gitignore': 'secret.ts\n',
        'sub/.gitignore': '!secret.ts\n',
    });

    // Root ignores secret.ts everywhere; the nested file re-includes only sub/secret.ts.
    expect(rel(root, collectFiles([root], TS))).toEqual(['sub/secret.ts']);
});

test('a repo-root .gitignore applies when only a subdirectory is scanned', async () => {
    const root = await tree({
        '.git/HEAD': '',
        '.gitignore': 'src/vendor/\n',
        'src/a.ts': '',
        'src/vendor/b.ts': '',
    });

    const found = collectFiles([path.join(root, 'src')], TS);
    expect(rel(root, found)).toEqual(['src/a.ts']);
});

test('an explicitly passed ignored file is still scanned', async () => {
    const root = await tree({
        'a.ts': '',
        'b.ts': '',
        '.gitignore': 'b.ts\n',
    });

    // Naming the ignored file directly beats .gitignore (it only prunes the walk below a root).
    expect(rel(root, collectFiles([path.join(root, 'b.ts')], TS))).toEqual(['b.ts']);
});

test('--non-recursive scans a directory top level only', async () => {
    const root = await tree({
        'top.ts': '',
        'sub/deep.ts': '',
    });

    expect(rel(root, collectFiles([root], TS, [], false, true))).toEqual(['top.ts']);
    expect(rel(root, collectFiles([root], TS, [], false, false))).toEqual(['sub/deep.ts', 'top.ts']);
});

test('throws a clear error for a path that does not exist', async () => {
    const root = await tree({ 'a.ts': '' });
    expect(() => collectFiles([path.join(root, 'missing')], TS)).toThrow(/path does not exist/);
});
