import * as fs from 'node:fs';
import * as path from 'node:path';

// File discovery for the CLI: recursive walk with --exclude globs and .gitignore
// pruning. Kept out of cli.ts so the arg parser/reporters stay readable. Both the
// exclude matchers and the .gitignore rules prune *during* the walk — an ignored
// directory is never read, never a post-filter over a fully materialized list.

export function collectFiles(
    paths: string[],
    extensions: Set<string>,
    excludePatterns: string[] = [],
    respectGitignore = true,
    nonRecursive = false
): string[] {
    const files: string[] = [];
    const seen = new Set<string>();
    const excludeMatchers = excludePatterns.map((pattern) => globToRegExp(toPosix(pattern)));

    const visit = (entry: string, layers: GitignoreLayer[], isTopLevel: boolean) => {
        const full = path.resolve(entry);
        if (!fs.existsSync(full)) {
            throw new Error(`path does not exist: ${entry}`);
        }

        const stat = fs.statSync(full);
        // Explicitly passed paths are always scanned; .gitignore only prunes below them.
        if (!isTopLevel && respectGitignore && isGitIgnored(layers, full, stat.isDirectory())) return;

        if (stat.isDirectory()) {
            // --non-recursive: scan a directory's direct children, never descend into subdirs.
            if (!isTopLevel && nonRecursive) return;
            if (isExcluded(`${full}${path.sep}`, excludeMatchers)) return;
            // The directory's own .gitignore governs its children, not itself.
            const childLayers = respectGitignore ? withGitignore(layers, full) : layers;
            for (const child of fs.readdirSync(full).sort()) {
                if (child === 'node_modules' || child === '.git' || child === 'dist') continue;
                visit(path.join(full, child), childLayers, false);
            }
            return;
        }

        if (!stat.isFile()) return;
        if (isExcluded(full, excludeMatchers)) return;
        if (!extensions.has(path.extname(full).toLowerCase())) return;
        if (seen.has(full)) return;
        seen.add(full);
        files.push(full);
    };

    // Seed each root with the .gitignore files of its repo ancestors so a repo-root
    // file applies even when only a subdirectory is scanned.
    for (const entry of paths) {
        const full = path.resolve(entry);
        const seed = respectGitignore && fs.existsSync(full) ? seedGitignoreLayers(full) : [];
        visit(entry, seed, true);
    }
    return files;
}

export function toPosix(value: string): string {
    return value.split(path.sep).join('/');
}

function isExcluded(filePath: string, matchers: RegExp[]): boolean {
    const normalized = toPosix(filePath);
    return matchers.some((matcher) => matcher.test(normalized));
}

function globToRegExp(pattern: string): RegExp {
    let source = '';
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === '*') {
            if (pattern[index + 1] === '*') {
                source += '.*';
                index++;
            } else {
                source += '[^/]*';
            }
            continue;
        }
        source += escapeRegExp(char);
    }
    return new RegExp(`^${source}$`);
}

function escapeRegExp(char: string): string {
    return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

interface GitignoreRule {
    negated: boolean;
    dirOnly: boolean;
    regex: RegExp;
}

interface GitignoreLayer {
    base: string;
    rules: GitignoreRule[];
}

function loadGitignore(dir: string): GitignoreLayer | null {
    const file = path.join(dir, '.gitignore');
    if (!fs.existsSync(file)) return null;
    const rules = parseGitignore(fs.readFileSync(file, 'utf-8'));
    return rules.length ? { base: dir, rules } : null;
}

function withGitignore(layers: GitignoreLayer[], dir: string): GitignoreLayer[] {
    const layer = loadGitignore(dir);
    return layer ? [...layers, layer] : layers;
}

// Walk up to the git repo root, gathering the .gitignore files of the directories
// above startPath. .gitignore is only meaningful inside a repo, so bail out (no
// rules) when there is no .git ancestor.
function seedGitignoreLayers(startPath: string): GitignoreLayer[] {
    const startDir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    const ancestors: string[] = [];
    let dir = startDir;
    let repoRootFound = fs.existsSync(path.join(dir, '.git'));
    while (!repoRootFound) {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        ancestors.push(parent);
        dir = parent;
        repoRootFound = fs.existsSync(path.join(dir, '.git'));
    }
    if (!repoRootFound) return [];
    ancestors.reverse(); // shallow-first, so deeper files win on later matches
    const layers: GitignoreLayer[] = [];
    for (const ancestor of ancestors) {
        const layer = loadGitignore(ancestor);
        if (layer) layers.push(layer);
    }
    return layers;
}

function isGitIgnored(layers: GitignoreLayer[], fullPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const layer of layers) {
        const rel = toPosix(path.relative(layer.base, fullPath));
        if (rel === '' || rel.startsWith('../')) continue;
        // Last matching rule wins (negations re-include); shallow layers first.
        for (const rule of layer.rules) {
            if (rule.dirOnly && !isDir) continue;
            if (rule.regex.test(rel)) ignored = !rule.negated;
        }
    }
    return ignored;
}

function parseGitignore(content: string): GitignoreRule[] {
    const rules: GitignoreRule[] = [];
    for (const raw of content.split('\n')) {
        // Strip CR and trailing unescaped whitespace; skip blanks and comments.
        let line = raw.replace(/\r$/, '').replace(/(?<!\\)\s+$/, '');
        if (line === '' || line.startsWith('#')) continue;
        let negated = false;
        if (line.startsWith('!')) {
            negated = true;
            line = line.slice(1);
        }
        if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);
        let dirOnly = false;
        if (line.endsWith('/')) {
            dirOnly = true;
            line = line.slice(0, -1);
        }
        if (line === '') continue;
        // A slash anywhere (other than a trailing one, already stripped) anchors the
        // pattern to the .gitignore's directory; otherwise it matches at any depth.
        const anchored = line.includes('/');
        if (line.startsWith('/')) line = line.slice(1);
        rules.push({ negated, dirOnly, regex: gitignoreToRegExp(line, anchored) });
    }
    return rules;
}

function gitignoreToRegExp(pattern: string, anchored: boolean): RegExp {
    let source = '';
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index];
        if (char === '*') {
            if (pattern[index + 1] === '*') {
                const atStart = index === 0 || pattern[index - 1] === '/';
                const slashAfter = pattern[index + 2] === '/';
                if (atStart && slashAfter) {
                    source += '(?:.*/)?'; // `**/` — zero or more leading dirs
                    index += 2;
                } else {
                    source += '.*'; // `**` spanning segments
                    index += 1;
                }
            } else {
                source += '[^/]*';
            }
            continue;
        }
        if (char === '?') {
            source += '[^/]';
            continue;
        }
        source += escapeRegExp(char);
    }
    // Non-anchored patterns match at any directory boundary; the trailing group lets
    // a matched directory also cover everything beneath it.
    const prefix = anchored ? '^' : '(?:^|/)';
    return new RegExp(`${prefix}${source}(?:/.*)?$`);
}
