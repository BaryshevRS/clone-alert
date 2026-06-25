#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: npm run compare:pmd -- <path> [options]

Compare PMD CPD and clone-alert on the same source tree.

PMD CPD parses a single language per run, so all three tools are kept on the
same pure file set: extensions/formats default from --language, and any
non-parseable extensions (tsx, jsx, vue, ...) are dropped for a fair compare.

Options:
  --minimum-tokens <n>        Minimum duplicated token span. Default: 50.
  --extensions <ext[,ext...]> Extensions for clone-alert scan. Default: derived
                              from --language (ts for typescript, js for
                              ecmascript). Non-parseable extensions are dropped.
  --language <name>           PMD CPD language. Default: typescript.
  --jscpd-formats <names>      jscpd formats. Default: derived from --language.
  --repo-name <name>           Repository label; stores reports under bench/results/<name>/<timestamp>.
  --bench-dir <path>           Benchmark root used with --repo-name. Default: bench.
  --out-dir <path>             Directory for reports. Default: OS temp dir, or bench/results/<repo>/<timestamp>.
  --pmd <command>             PMD executable. Default: pmd.
  --jscpd <command>           jscpd v5/Rust executable. Default: jscpd from PATH.
  -h, --help                  Show this help.
`;

function main(argv) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    if (!options.inputPath) {
        process.stderr.write('compare-pmd-cpd: missing input path\n');
        process.stderr.write(HELP);
        return 2;
    }
    if (!existsSync(options.inputPath)) {
        process.stderr.write(`compare-pmd-cpd: path does not exist: ${options.inputPath}\n`);
        return 2;
    }

    mkdirSync(options.outDir, { recursive: true });
    const pmdReport = path.join(options.outDir, 'pmd-cpd.xml');
    const cloneReport = path.join(options.outDir, 'clone-alert.xml');
    const jscpdOutDir = path.join(options.outDir, 'jscpd');
    mkdirSync(jscpdOutDir, { recursive: true });

    const ignoreFlags = [];
    if (options.ignoreIdentifiers) ignoreFlags.push('--ignore-identifiers');
    if (options.ignoreLiterals) ignoreFlags.push('--ignore-literals');

    const performance = {};
    performance.pmd = runMeasured(
        'pmd',
        options.pmd,
        [
            'cpd',
            '--language',
            options.language,
            '--minimum-tokens',
            String(options.minimumTokens),
            '--dir',
            options.inputPath,
            '--exclude',
            '**/node_modules/**',
            '--exclude',
            '**/dist/**',
            '--exclude',
            '**/.git/**',
            ...ignoreFlags,
            '--format',
            'xml',
            '--report-file',
            pmdReport,
            '--no-fail-on-violation',
            '--no-fail-on-error',
        ]
    );

    performance.cloneAlert = runMeasured(
        'clone-alert',
        process.execPath,
        [
            path.join(process.cwd(), 'dist', 'cli.js'),
            '--minimum-tokens',
            String(options.minimumTokens),
            '--files',
            options.inputPath,
            '--extensions',
            options.extensions,
            '--exclude',
            '**/node_modules/**',
            '--exclude',
            '**/dist/**',
            '--exclude',
            '**/.git/**',
            ...ignoreFlags,
            '--format',
            'xml',
            '--no-fail-on-violation',
        ],
        { stdoutFile: cloneReport }
    );

    performance.jscpd = runMeasured(
        'jscpd',
        options.jscpd,
        [
            '--min-tokens',
            String(options.minimumTokens),
            '--min-lines',
            '1',
            '--max-lines',
            '1000000',
            '--max-size',
            '100mb',
            '--format',
            options.jscpdFormats,
            '--reporters',
            'json',
            '--output',
            jscpdOutDir,
            '--ignore',
            '**/node_modules/**,**/dist/**,**/.git/**',
            '--absolute',
            '--silent',
            options.inputPath,
        ]
    );

    const pmd = parseReport(pmdReport);
    const clone = parseReport(cloneReport);
    const jscpdReport = findJscpdReport(jscpdOutDir);
    const jscpd = parseJscpdReport(jscpdReport);
    const summary = compareReports(pmd, clone, jscpd);
    const output = {
        repoName: options.repoName || null,
        inputPath: options.inputPath,
        reports: { pmd: pmdReport, cloneAlert: cloneReport, jscpd: jscpdReport },
        performance,
        ...summary,
    };
    const summaryReport = path.join(options.outDir, 'summary.json');
    writeFileSync(summaryReport, `${JSON.stringify({ ...output, reports: { ...output.reports, summary: summaryReport } }, null, 2)}\n`);

    process.stdout.write(`${JSON.stringify({ ...output, reports: { ...output.reports, summary: summaryReport } }, null, 2)}\n`);
    return 0;
}

// PMD CPD runs one --language per pass. Each profile pins the matching pure
// file extension for clone-alert and the jscpd format so all three tools scan
// an identical corpus. Framework variants (.tsx/.jsx/...) are out of scope:
// PMD's typescript/ecmascript lexers cannot parse them.
const LANGUAGE_PROFILES = {
    typescript: { extensions: 'ts', jscpdFormats: 'typescript', pure: ['ts'] },
    ecmascript: { extensions: 'js', jscpdFormats: 'javascript', pure: ['js'] },
};

function parseArgs(argv) {
    const options = {
        inputPath: '',
        minimumTokens: 50,
        extensions: '',
        language: 'typescript',
        jscpdFormats: '',
        repoName: '',
        benchDir: path.resolve('bench'),
        outDir: '',
        pmd: 'pmd',
        jscpd: 'jscpd',
        ignoreIdentifiers: false,
        ignoreLiterals: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '-h' || arg === '--help') {
            options.help = true;
            continue;
        }
        if (arg === '--minimum-tokens') {
            options.minimumTokens = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
            continue;
        }
        if (arg === '--extensions') {
            options.extensions = requireValue(argv, ++index, arg);
            continue;
        }
        if (arg === '--language') {
            options.language = requireValue(argv, ++index, arg);
            continue;
        }
        if (arg === '--jscpd-formats') {
            options.jscpdFormats = requireValue(argv, ++index, arg);
            continue;
        }
        if (arg === '--repo-name') {
            options.repoName = sanitizeRepoName(requireValue(argv, ++index, arg));
            continue;
        }
        if (arg === '--bench-dir') {
            options.benchDir = path.resolve(requireValue(argv, ++index, arg));
            continue;
        }
        if (arg === '--out-dir') {
            options.outDir = path.resolve(requireValue(argv, ++index, arg));
            continue;
        }
        if (arg === '--pmd') {
            options.pmd = requireValue(argv, ++index, arg);
            continue;
        }
        if (arg === '--jscpd') {
            options.jscpd = requireValue(argv, ++index, arg);
            continue;
        }
        if (arg === '--ignore-identifiers') {
            options.ignoreIdentifiers = true;
            continue;
        }
        if (arg === '--ignore-literals') {
            options.ignoreLiterals = true;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`unknown option: ${arg}`);
        }
        options.inputPath = path.resolve(arg);
    }

    const profile = LANGUAGE_PROFILES[options.language];
    if (!options.extensions) {
        options.extensions = profile ? profile.extensions : 'ts';
    }
    if (!options.jscpdFormats) {
        options.jscpdFormats = profile ? profile.jscpdFormats : 'typescript';
    }
    if (profile) {
        options.extensions = keepPureExtensions(options.extensions, profile.pure, options.language);
    }

    if (!options.outDir) {
        options.outDir = options.repoName
            ? path.join(options.benchDir, 'results', options.repoName, timestampForPath())
            : path.join(tmpdir(), `clone-alert-pmd-compare-${process.pid}`);
    }

    return options;
}

// Keep only the extensions PMD's chosen language can actually lex, so PMD,
// clone-alert and jscpd compare the exact same files. Dropped extensions are
// reported to stderr; falls back to the language's pure set if nothing is left.
function keepPureExtensions(extensions, pure, language) {
    const wanted = extensions
        .split(',')
        .map((ext) => ext.trim().replace(/^\./, ''))
        .filter(Boolean);
    const kept = wanted.filter((ext) => pure.includes(ext));
    const dropped = wanted.filter((ext) => !pure.includes(ext));
    if (dropped.length > 0) {
        const droppedList = dropped.map((ext) => `.${ext}`).join(', ');
        const pureList = pure.map((ext) => `.${ext}`).join(', ');
        process.stderr.write(
            `compare-pmd-cpd: PMD --language ${language} cannot parse ${droppedList}; comparing pure ${pureList} only\n`
        );
    }
    return (kept.length > 0 ? kept : pure).join(',');
}

function sanitizeRepoName(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}

function timestampForPath() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '').replace('T', '-');
}

function requireValue(argv, index, option) {
    const value = argv[index];
    if (!value || value.startsWith('-')) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function parsePositiveInteger(value, option) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${option} must be a positive integer`);
    }
    return parsed;
}

function parseReport(filePath) {
    const xml = readFileSync(filePath, 'utf8');
    const duplicates = [...xml.matchAll(/<duplication\b([^>]*)>([\s\S]*?)<\/duplication>/g)].map((match) => {
        const attrs = readAttributes(match[1]);
        const files = [...match[2].matchAll(/<file\b([\s\S]*?)\/>/g)].map((file) => {
            const fileAttrs = readAttributes(file[1]);
            return {
                path: normalizeReportPath(decodeXml(fileAttrs.path ?? '')),
                line: Number(fileAttrs.line ?? 0),
            };
        });
        return {
            lines: Number(attrs.lines ?? 0),
            tokens: Number(attrs.tokens ?? 0),
            files,
        };
    });
    return { duplicates };
}

function findJscpdReport(outDir) {
    const report = path.join(outDir, 'jscpd-report.json');
    if (!existsSync(report)) {
        throw new Error(`jscpd report was not created: ${report}`);
    }
    return report;
}

function parseJscpdReport(filePath) {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    const duplicates = (Array.isArray(data.duplicates) ? data.duplicates : []).map((duplicate) => ({
        lines: Number(duplicate.lines ?? 0),
        tokens: Number(duplicate.tokens ?? 0),
        files: [duplicate.firstFile, duplicate.secondFile]
            .filter(Boolean)
            .map((file) => ({
                path: normalizeReportPath(file.name ?? ''),
                line: Number(file.startLoc?.line ?? file.start ?? 0),
            })),
    }));
    return { duplicates, statistics: data.statistics ?? data.statistic ?? null };
}

function normalizeReportPath(filePath) {
    if (!filePath) return '';
    try {
        return realpathSync.native(filePath);
    } catch {
        return filePath;
    }
}

function readAttributes(source) {
    return Object.fromEntries([...source.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function decodeXml(value) {
    return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function compareReports(pmd, clone, jscpd) {
    const pmdExact = new Set(pmd.duplicates.map(exactStartKey));
    const cloneExact = new Set(clone.duplicates.map(exactStartKey));
    const pmdFileSets = new Set(pmd.duplicates.map(fileSetKey));
    const cloneFileSets = new Set(clone.duplicates.map(fileSetKey));

    return {
        pmd: summarize(pmd.duplicates),
        cloneAlert: summarize(clone.duplicates),
        jscpd: summarizeJscpd(jscpd),
        exactStartOverlap: countOverlap(pmdExact, cloneExact),
        fileSetOverlap: countOverlap(pmdFileSets, cloneFileSets),
        pairOverlap: {
            cloneAlert: comparePairOverlap(pmd.duplicates, clone.duplicates),
            jscpd: comparePairOverlap(pmd.duplicates, jscpd.duplicates),
        },
    };
}

function summarize(duplicates) {
    return {
        duplications: duplicates.length,
        occurrences: duplicates.reduce((sum, duplicate) => sum + duplicate.files.length, 0),
        uniqueFiles: new Set(duplicates.flatMap((duplicate) => duplicate.files.map((file) => file.path))).size,
        maxTokens: Math.max(0, ...duplicates.map((duplicate) => duplicate.tokens)),
        maxLines: Math.max(0, ...duplicates.map((duplicate) => duplicate.lines)),
    };
}

function summarizeJscpd(report) {
    const total = report.statistics?.total ?? {};
    return {
        ...summarize(report.duplicates),
        totalLines: Number(total.lines ?? 0),
        totalTokens: Number(total.tokens ?? 0),
        duplicatedLines: Number(total.duplicatedLines ?? 0),
        duplicatedTokens: Number(total.duplicatedTokens ?? 0),
        percentage: Number(total.percentage ?? 0),
        percentageTokens: Number(total.percentageTokens ?? 0),
    };
}

function exactStartKey(duplicate) {
    return duplicate.files.map((file) => `${file.path}:${file.line}`).sort().join('|');
}

function fileSetKey(duplicate) {
    return duplicate.files.map((file) => file.path).sort().join('|');
}

function countOverlap(left, right) {
    let count = 0;
    for (const key of left) {
        if (right.has(key)) count++;
    }
    return count;
}

function comparePairOverlap(pmdDuplicates, candidateDuplicates) {
    const candidateExactPairs = new Set();
    const candidateFilePairs = new Set();
    forEachPair(candidateDuplicates, (left, right) => {
        candidateExactPairs.add(pairKey(left, right, exactOccurrenceKey));
        candidateFilePairs.add(pairKey(left, right, filePathKey));
    });

    let pmdPairs = 0;
    const exactPairOverlap = new Set();
    const filePairOverlap = new Set();
    forEachPair(pmdDuplicates, (left, right) => {
        pmdPairs++;
        const exact = pairKey(left, right, exactOccurrenceKey);
        if (candidateExactPairs.has(exact)) {
            exactPairOverlap.add(exact);
        }
        const files = pairKey(left, right, filePathKey);
        if (candidateFilePairs.has(files)) {
            filePairOverlap.add(files);
        }
    });

    return {
        pmdExactPairs: pmdPairs,
        candidateExactPairs: candidateExactPairs.size,
        exactPairOverlap: exactPairOverlap.size,
        pmdFilePairs: pmdPairs,
        candidateFilePairs: candidateFilePairs.size,
        filePairOverlap: filePairOverlap.size,
    };
}

function forEachPair(duplicates, visit) {
    for (const duplicate of duplicates) {
        for (let left = 0; left < duplicate.files.length; left++) {
            for (let right = left + 1; right < duplicate.files.length; right++) {
                visit(duplicate.files[left], duplicate.files[right]);
            }
        }
    }
}

function pairKey(left, right, fileKey) {
    return [fileKey(left), fileKey(right)].sort().join('|');
}

function exactOccurrenceKey(file) {
    return `${file.path}:${file.line}`;
}

function filePathKey(file) {
    return file.path;
}

function runMeasured(label, command, args, options = {}) {
    const time = timeCommand(command, args);
    let result = spawnForMeasurement(time.command, time.args, options);
    if (result.status !== 0 && isTimeResourceDenied(result.stderr) && (time.command !== command || time.args !== args)) {
        result = spawnForMeasurement(command, args, options);
        if (result.status === 0) {
            return {
                elapsedMs: Math.round(result.elapsedMs),
                maxRssBytes: null,
            };
        }
    }

    if (result.error) {
        throw new Error(`${label} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${label} exited with ${result.status}${stderrTail(result.stderr)}`);
    }

    return {
        elapsedMs: Math.round(result.elapsedMs),
        maxRssBytes: parseMaxRssBytes(result.stderr),
    };
}

function spawnForMeasurement(command, args, options) {
    const stdoutFd = options.stdoutFile ? openSync(options.stdoutFile, 'w') : undefined;
    const started = process.hrtime.bigint();
    let result;
    try {
        result = spawnSync(command, args, {
            encoding: 'utf8',
            stdio: ['ignore', stdoutFd ?? 'pipe', 'pipe'],
        });
    } finally {
        if (stdoutFd !== undefined) {
            closeSync(stdoutFd);
        }
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    return {
        ...result,
        elapsedMs,
    };
}

function timeCommand(command, args) {
    if (process.platform === 'darwin' && existsSync('/usr/bin/time')) {
        return { command: '/usr/bin/time', args: ['-l', command, ...args] };
    }
    if (existsSync('/usr/bin/time')) {
        return { command: '/usr/bin/time', args: ['-v', command, ...args] };
    }
    return { command, args };
}

function parseMaxRssBytes(stderr) {
    const mac = stderr.match(/^\s*(\d+)\s+maximum resident set size/m);
    if (mac) {
        return Number(mac[1]);
    }
    const gnu = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    if (gnu) {
        return Number(gnu[1]) * 1024;
    }
    return null;
}

function isTimeResourceDenied(stderr) {
    return stderr.includes('sysctl kern.clockrate: Operation not permitted');
}

function stderrTail(stderr) {
    const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
    return lines.length ? `: ${lines.slice(-8).join('\n')}` : '';
}

if (isCliEntrypoint()) {
    try {
        const status = await main(process.argv.slice(2));
        process.exitCode = status;
    } catch (error) {
        process.stderr.write(`compare-pmd-cpd: ${error.message}\n`);
        process.exitCode = 2;
    }
}

function isCliEntrypoint() {
    return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
