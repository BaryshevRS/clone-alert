#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CloneRecord, fingerprint, readBaseline, writeBaseline } from './baseline';
import type { Match } from './core';
import { collectFiles, toPosix } from './files';
import { Cpd, type CpdOptions, type MatchLocation } from './index';

type ReportFormat = 'text' | 'xml' | 'json' | 'sarif';

interface CliOptions extends CpdOptions {
    paths: string[];
    extensions: Set<string>;
    excludePatterns: string[];
    respectGitignore: boolean;
    format: ReportFormat;
    failOnViolation: boolean;
    baselinePath?: string;
    updateBaseline: boolean;
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
  --format <text|xml|json|sarif>  Report format. Default: text. sarif targets
                                  GitHub Code Scanning.
  --extensions <ext[,ext...]>     Extensions to include. Default: ts,tsx,js,jsx,vue,svelte,html.
  --exclude <glob[,glob...]>      Exclude files or directories. Can be repeated.
  --gitignore                     Skip files ignored by .gitignore (nested files
                                  honored, within the git repo). Default.
  --no-gitignore                  Scan files even if .gitignore would ignore them.
  --ignore-identifiers            Normalize identifiers.
  --no-ignore-identifiers         Compare exact identifiers. Default.
  --ignore-literals               Normalize literals.
  --no-ignore-literals            Compare exact literals. Default.
  --pmd-typescript-compatibility  Match PMD typescript granularity for .ts/.tsx:
                                  split template literals into per-atom tokens
                                  (backtick, \${, }, one per text char) and
                                  collapse regexp. .js/.jsx stay native. Default.
  --no-pmd-typescript-compatibility
                                  Tokenize .ts/.tsx with the native TypeScript
                                  scanner (a template literal stays one token).
  --svelte-templates              Tokenize .svelte markup (ast.fragment), not
                                  just <script>. Default.
  --no-svelte-templates           Tokenize only <script> in .svelte files.
                                  Use to run markup and code at different
                                  --minimum-tokens thresholds.
  --vue-templates                 Tokenize .vue markup (descriptor.template.ast),
                                  not just <script>. Default.
  --no-vue-templates              Skip .vue markup; scan the <script> block
                                  alone (handy for a code-only threshold pass).
  --angular-inline-templates      Also scan Angular @Component inline templates.
  --skip-angular-inline-templates Do not scan inline Angular templates. Default.
  --fail-on-violation             Exit with code 4 when duplications are found.
  --baseline <path>               Ignore duplications recorded in this baseline
                                  file; report and fail only on new ones. Match is
                                  by content fingerprint, so accepted clones stay
                                  suppressed even after the code moves.
  --update-baseline               Write/regenerate the baseline file at --baseline
                                  with all current duplications, then exit 0. Run
                                  this once to adopt the existing debt.
  -h, --help                      Show this help.
  -V, --version                   Show version.

Examples:
  clone-alert --minimum-tokens 50 --files src
  clone-alert --minimum-tokens 30 --format xml src test
  clone-alert src --baseline .clone-alert-baseline.json --update-baseline
  clone-alert src --baseline .clone-alert-baseline.json --fail-on-violation
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

    if (options.updateBaseline && !options.baselinePath) {
        console.error('clone-alert: --update-baseline requires --baseline <path>');
        return 2;
    }

    let files: string[];
    try {
        files = collectFiles(options.paths, options.extensions, options.excludePatterns, options.respectGitignore);
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

    if (options.baselinePath) {
        try {
            return runWithBaseline(options, cpd, matches);
        } catch (error) {
            console.error(`clone-alert: ${(error as Error).message}`);
            return 2;
        }
    }

    process.stdout.write(formatReport(options.format, cpd, matches));
    return options.failOnViolation && matches.length > 0 ? 4 : 0;
}

// Baseline handling. Detection is already done; this only writes (update) or
// filters (read) the match set by content fingerprint, so it never touches the
// hot path — cost is O(matches), not O(tokens).
function runWithBaseline(options: CliOptions, cpd: Cpd, matches: Match[]): number {
    const baselinePath = options.baselinePath as string;

    if (options.updateBaseline) {
        writeBaseline(
            baselinePath,
            matches.map((match) => toCloneRecord(match, cpd))
        );
        console.error(`clone-alert: wrote baseline with ${matches.length} duplication(s) to ${baselinePath}`);
        return 0;
    }

    const known = readBaseline(baselinePath);
    const fresh = matches.filter((match) => !known.has(fingerprint(cpd, match)));
    const suppressed = matches.length - fresh.length;
    if (suppressed > 0) {
        console.error(`clone-alert: ${suppressed} known duplication(s) suppressed by baseline`);
    }

    process.stdout.write(formatReport(options.format, cpd, fresh));
    return options.failOnViolation && fresh.length > 0 ? 4 : 0;
}

// Informational context for a baseline entry: token count plus the involved file
// paths relative to cwd (so the file is portable across machines/CI). Line/column
// are intentionally left out — the fingerprint already pins the content, and
// omitting them keeps the baseline diff stable when code moves.
function toCloneRecord(match: Match, cpd: Cpd): CloneRecord {
    const files = Array.from(
        new Set(match.marks.map((mark) => toPosix(path.relative(process.cwd(), mark.token.file))))
    ).sort();
    return { fingerprint: fingerprint(cpd, match), tokens: match.tokenCount, files };
}

function parseArgs(argv: string[]): CliOptions {
    const paths: string[] = [];
    const extensions = new Set(DEFAULT_EXTENSIONS);
    const excludePatterns: string[] = [];
    let respectGitignore = true;
    let minTileSize = 50;
    let ignoreIdentifiers = false;
    let ignoreLiterals = false;
    let pmdTypescriptCompatibility = true;
    let svelteTemplates = true;
    let vueTemplates = true;
    let angularInlineTemplates = false;
    let format: ReportFormat = 'text';
    let failOnViolation = false;
    let baselinePath: string | undefined;
    let updateBaseline = false;

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
        if (arg === '--gitignore') {
            respectGitignore = true;
            continue;
        }
        if (arg === '--no-gitignore') {
            respectGitignore = false;
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
        if (arg === '--pmd-typescript-compatibility') {
            pmdTypescriptCompatibility = true;
            continue;
        }
        if (arg === '--no-pmd-typescript-compatibility') {
            pmdTypescriptCompatibility = false;
            continue;
        }
        if (arg === '--svelte-templates') {
            svelteTemplates = true;
            continue;
        }
        if (arg === '--no-svelte-templates') {
            svelteTemplates = false;
            continue;
        }
        if (arg === '--vue-templates') {
            vueTemplates = true;
            continue;
        }
        if (arg === '--no-vue-templates') {
            vueTemplates = false;
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
        if (arg === '--baseline') {
            baselinePath = requireValue(argv, ++i, arg);
            continue;
        }
        if (arg.startsWith('--baseline=')) {
            baselinePath = arg.slice('--baseline='.length);
            continue;
        }
        if (arg === '--update-baseline') {
            updateBaseline = true;
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
        respectGitignore,
        minTileSize,
        ignoreIdentifiers,
        ignoreLiterals,
        pmdTypescriptCompatibility,
        svelteTemplates,
        vueTemplates,
        angularInlineTemplates,
        format,
        failOnViolation,
        baselinePath,
        updateBaseline,
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
    if (value === 'text' || value === 'xml' || value === 'json' || value === 'sarif') {
        return value;
    }
    throw new Error('--format must be one of: text, xml, json, sarif');
}

function replaceExtensions(target: Set<string>, value: string): void {
    target.clear();
    for (const ext of splitList(value)) {
        target.add(ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
    }
}

function formatReport(format: ReportFormat, cpd: Cpd, matches: Match[]): string {
    if (format === 'json') {
        return `${JSON.stringify({ duplicates: matches.map((match) => matchToJson(match, cpd)) }, null, 2)}\n`;
    }
    if (format === 'xml') {
        return formatXml(matches, cpd);
    }
    if (format === 'sarif') {
        return formatSarif(matches, cpd);
    }
    return cpd.report(matches);
}

// SARIF 2.1.0 for GitHub Code Scanning (`github/codeql-action/upload-sarif`).
// One result per duplication, anchored at its first occurrence; the other
// occurrences are relatedLocations. URIs are relative to cwd so GitHub maps them
// to the checked-out tree. The content fingerprint goes into partialFingerprints,
// so GitHub tracks an alert across commits even when the clone moves.
function formatSarif(matches: Match[], cpd: Cpd): string {
    const cwd = process.cwd();
    const physicalLocation = (location: MatchLocation) => ({
        physicalLocation: {
            artifactLocation: { uri: toPosix(path.relative(cwd, location.path)) },
            region: {
                startLine: location.startLine,
                startColumn: location.startColumn,
                endLine: location.endLine,
                endColumn: location.endColumn,
            },
        },
    });

    const results = matches.map((match) => {
        const [primary, ...others] = match.marks.map((mark) => cpd.locationForMark(mark, match.tokenCount));
        const elsewhere = others
            .map((location) => `${toPosix(path.relative(cwd, location.path))}:${location.startLine}`)
            .join(', ');
        return {
            ruleId: 'duplication',
            ruleIndex: 0,
            level: 'warning',
            message: {
                text: `Found a ${match.tokenCount} token (${match.markCount} occurrences) duplication${
                    elsewhere ? `; also at ${elsewhere}` : ''
                }.`,
            },
            locations: [physicalLocation(primary)],
            relatedLocations: others.map((location, index) => ({ id: index, ...physicalLocation(location) })),
            partialFingerprints: { 'cloneAlert/contentV1': fingerprint(cpd, match) },
        };
    });

    const log = {
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: 'clone-alert',
                        informationUri: 'https://github.com/BaryshevRS/clone-alert',
                        version: readVersion(),
                        rules: [
                            {
                                id: 'duplication',
                                name: 'Duplication',
                                shortDescription: { text: 'Duplicated code' },
                                fullDescription: { text: 'A span of duplicated tokens detected by clone-alert.' },
                                helpUri: 'https://github.com/BaryshevRS/clone-alert#readme',
                                defaultConfiguration: { level: 'warning' },
                            },
                        ],
                    },
                },
                results,
            },
        ],
    };
    return `${JSON.stringify(log, null, 2)}\n`;
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
