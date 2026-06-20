#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Match } from './core';
import { Cpd, type CpdOptions } from './index';

type ReportFormat = 'text' | 'xml' | 'json';

interface CliOptions extends CpdOptions {
    paths: string[];
    extensions: Set<string>;
    excludePatterns: string[];
    format: ReportFormat;
    failOnViolation: boolean;
}

const DEFAULT_EXTENSIONS = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mts',
    '.cts',
    '.mjs',
    '.cjs',
    '.vue',
    '.svelte',
    '.html',
    '.htm',
];

const HELP = `Usage: clone-alert [options] [<path>...]

PMD CPD-like copy-paste detector for TS/JS and common frontend templates.

Options:
  --files <path[,path...]>        Files or directories to scan. Can be repeated.
  --minimum-tokens <n>            Minimum duplicated token span. Default: 50.
  --minimum-tile-size <n>         Alias for --minimum-tokens.
  --format <text|xml|json>        Report format. Default: text.
  --extensions <ext[,ext...]>     Extensions to include. Default: ts,tsx,js,jsx,vue,svelte,html.
  --exclude <glob[,glob...]>      Exclude files or directories. Can be repeated.
  --ignore-identifiers            Normalize identifiers.
  --no-ignore-identifiers         Compare exact identifiers. Default.
  --ignore-literals               Normalize literals.
  --no-ignore-literals            Compare exact literals. Default.
  --angular-inline-templates      Also scan Angular @Component inline templates.
  --skip-angular-inline-templates Do not scan inline Angular templates. Default.
  --fail-on-violation             Exit with code 4 when duplications are found.
  -h, --help                      Show this help.
  -V, --version                   Show version.

Examples:
  clone-alert --minimum-tokens 50 --files src
  clone-alert --minimum-tokens 30 --format xml src test
`;

function main(argv: string[]): number {
    let options: CliOptions;
    try {
        options = parseArgs(argv);
    } catch (error) {
        console.error(`clone-alert: ${(error as Error).message}`);
        console.error("Try 'clone-alert --help' for more information.");
        return 2;
    }

    if (options.paths.length === 0) {
        console.error('clone-alert: missing files or directories to scan');
        console.error("Try 'clone-alert --help' for more information.");
        return 2;
    }

    let files: string[];
    try {
        files = collectFiles(options.paths, options.extensions, options.excludePatterns);
    } catch (error) {
        console.error(`clone-alert: ${(error as Error).message}`);
        return 2;
    }
    if (files.length === 0) {
        console.error('clone-alert: no supported files found');
        return 2;
    }

    const cpd = new Cpd(options);
    for (const file of files) {
        cpd.addPath(file);
    }

    const matches = cpd.run();
    process.stdout.write(formatReport(options.format, cpd, matches));
    return options.failOnViolation && matches.length > 0 ? 4 : 0;
}

function parseArgs(argv: string[]): CliOptions {
    const paths: string[] = [];
    const extensions = new Set(DEFAULT_EXTENSIONS);
    const excludePatterns: string[] = [];
    let minTileSize = 50;
    let ignoreIdentifiers = false;
    let ignoreLiterals = false;
    let angularInlineTemplates = false;
    let format: ReportFormat = 'text';
    let failOnViolation = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '-h' || arg === '--help') {
            console.log(HELP);
            process.exit(0);
        }
        if (arg === '-V' || arg === '--version') {
            console.log(readVersion());
            process.exit(0);
        }
        if (arg === '--files') {
            paths.push(...splitList(requireValue(argv, ++i, arg)));
            continue;
        }
        if (arg.startsWith('--files=')) {
            paths.push(...splitList(arg.slice('--files='.length)));
            continue;
        }
        if (arg === '--minimum-tokens' || arg === '--minimum-tile-size') {
            minTileSize = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
            continue;
        }
        if (arg.startsWith('--minimum-tokens=')) {
            minTileSize = parsePositiveInteger(arg.slice('--minimum-tokens='.length), '--minimum-tokens');
            continue;
        }
        if (arg.startsWith('--minimum-tile-size=')) {
            minTileSize = parsePositiveInteger(arg.slice('--minimum-tile-size='.length), '--minimum-tile-size');
            continue;
        }
        if (arg === '--format') {
            format = parseFormat(requireValue(argv, ++i, arg));
            continue;
        }
        if (arg.startsWith('--format=')) {
            format = parseFormat(arg.slice('--format='.length));
            continue;
        }
        if (arg === '--extensions') {
            replaceExtensions(extensions, requireValue(argv, ++i, arg));
            continue;
        }
        if (arg.startsWith('--extensions=')) {
            replaceExtensions(extensions, arg.slice('--extensions='.length));
            continue;
        }
        if (arg === '--exclude') {
            excludePatterns.push(...splitList(requireValue(argv, ++i, arg)));
            continue;
        }
        if (arg.startsWith('--exclude=')) {
            excludePatterns.push(...splitList(arg.slice('--exclude='.length)));
            continue;
        }
        if (arg === '--ignore-identifiers') {
            ignoreIdentifiers = true;
            continue;
        }
        if (arg === '--no-ignore-identifiers') {
            ignoreIdentifiers = false;
            continue;
        }
        if (arg === '--ignore-literals') {
            ignoreLiterals = true;
            continue;
        }
        if (arg === '--no-ignore-literals') {
            ignoreLiterals = false;
            continue;
        }
        if (arg === '--angular-inline-templates') {
            angularInlineTemplates = true;
            continue;
        }
        if (arg === '--skip-angular-inline-templates') {
            angularInlineTemplates = false;
            continue;
        }
        if (arg === '--fail-on-violation') {
            failOnViolation = true;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`unknown option: ${arg}`);
        }
        paths.push(arg);
    }

    return {
        paths,
        extensions,
        excludePatterns,
        minTileSize,
        ignoreIdentifiers,
        ignoreLiterals,
        angularInlineTemplates,
        format,
        failOnViolation,
    };
}

function requireValue(argv: string[], index: number, option: string): string {
    const value = argv[index];
    if (!value || value.startsWith('-')) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function splitList(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parsePositiveInteger(value: string, option: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${option} must be a positive integer`);
    }
    return parsed;
}

function parseFormat(value: string): ReportFormat {
    if (value === 'text' || value === 'xml' || value === 'json') {
        return value;
    }
    throw new Error('--format must be one of: text, xml, json');
}

function replaceExtensions(target: Set<string>, value: string): void {
    target.clear();
    for (const ext of splitList(value)) {
        target.add(ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
    }
}

function collectFiles(paths: string[], extensions: Set<string>, excludePatterns: string[] = []): string[] {
    const files: string[] = [];
    const seen = new Set<string>();
    const excludeMatchers = excludePatterns.map((pattern) => globToRegExp(toPosix(pattern)));

    const visit = (entry: string) => {
        const full = path.resolve(entry);
        if (!fs.existsSync(full)) {
            throw new Error(`path does not exist: ${entry}`);
        }

        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (isExcluded(`${full}${path.sep}`, excludeMatchers)) return;
            for (const child of fs.readdirSync(full).sort()) {
                if (child === 'node_modules' || child === '.git' || child === 'dist') continue;
                visit(path.join(full, child));
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

    for (const entry of paths) visit(entry);
    return files;
}

function formatReport(format: ReportFormat, cpd: Cpd, matches: Match[]): string {
    if (format === 'json') {
        return `${JSON.stringify({ duplicates: matches.map((match) => matchToJson(match, cpd)) }, null, 2)}\n`;
    }
    if (format === 'xml') {
        return formatXml(matches, cpd);
    }
    return cpd.report(matches);
}

function matchToJson(match: Match, cpd: Cpd) {
    const files = match.marks.map((mark) => cpd.locationForMark(mark, match.tokenCount));
    return {
        lines: Math.max(0, ...files.map((file) => file.endLine - file.startLine + 1)),
        tokens: match.tokenCount,
        files,
    };
}

function formatXml(matches: Match[], cpd: Cpd): string {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<pmd-cpd>'];
    for (const match of matches) {
        const duplicate = matchToJson(match, cpd);
        lines.push(
            `  <duplication lines="${duplicate.lines}" tokens="${match.tokenCount}" occurrences="${match.markCount}">`
        );
        for (const mark of match.marks) {
            const location = cpd.locationForMark(mark, match.tokenCount);
            lines.push(
                `    <file path="${escapeXml(location.path)}" line="${location.startLine}" endline="${location.endLine}" column="${location.startColumn}" endcolumn="${location.endColumn}" />`
            );
        }
        lines.push('  </duplication>');
    }
    lines.push('</pmd-cpd>');
    return `${lines.join('\n')}\n`;
}

function isExcluded(filePath: string, matchers: RegExp[]): boolean {
    const normalized = toPosix(filePath);
    return matchers.some((matcher) => matcher.test(normalized));
}

function toPosix(value: string): string {
    return value.split(path.sep).join('/');
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

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readVersion(): string {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
        version?: string;
    };
    return pkg.version ?? '0.0.0';
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

export { collectFiles, main, parseArgs };
