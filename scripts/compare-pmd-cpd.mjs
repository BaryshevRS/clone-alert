#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HELP = `Usage: npm run compare:pmd -- <path> [options]

Compare PMD CPD and clone-alert on the same source tree.

Options:
  --minimum-tokens <n>        Minimum duplicated token span. Default: 50.
  --extensions <ext[,ext...]> Extensions for clone-alert scan. Default: ts.
  --language <name>           PMD CPD language. Default: typescript.
  --out-dir <path>            Directory for XML reports. Default: OS temp dir.
  --pmd <command>             PMD executable. Default: pmd.
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

    execFileSync(
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
            '--format',
            'xml',
            '--report-file',
            pmdReport,
            '--no-fail-on-violation',
            '--no-fail-on-error',
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] }
    );

    const cloneXml = execFileSync(
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
            '--format',
            'xml',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    );
    writeFileSync(cloneReport, cloneXml);

    const pmd = parseReport(pmdReport);
    const clone = parseReport(cloneReport);
    const summary = compareReports(pmd, clone);

    process.stdout.write(`${JSON.stringify({ reports: { pmd: pmdReport, cloneAlert: cloneReport }, ...summary }, null, 2)}\n`);
    return 0;
}

function parseArgs(argv) {
    const options = {
        inputPath: '',
        minimumTokens: 50,
        extensions: 'ts',
        language: 'typescript',
        outDir: path.join(tmpdir(), `clone-alert-pmd-compare-${process.pid}`),
        pmd: 'pmd',
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
        if (arg === '--out-dir') {
            options.outDir = path.resolve(requireValue(argv, ++index, arg));
            continue;
        }
        if (arg === '--pmd') {
            options.pmd = requireValue(argv, ++index, arg);
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`unknown option: ${arg}`);
        }
        options.inputPath = path.resolve(arg);
    }

    return options;
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
                path: decodeXml(fileAttrs.path ?? ''),
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

function readAttributes(source) {
    return Object.fromEntries([...source.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function decodeXml(value) {
    return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function compareReports(pmd, clone) {
    const pmdExact = new Set(pmd.duplicates.map(exactStartKey));
    const cloneExact = new Set(clone.duplicates.map(exactStartKey));
    const pmdFileSets = new Set(pmd.duplicates.map(fileSetKey));
    const cloneFileSets = new Set(clone.duplicates.map(fileSetKey));

    return {
        pmd: summarize(pmd.duplicates),
        cloneAlert: summarize(clone.duplicates),
        exactStartOverlap: countOverlap(pmdExact, cloneExact),
        fileSetOverlap: countOverlap(pmdFileSets, cloneFileSets),
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

try {
    const status = await main(process.argv.slice(2));
    process.exitCode = status;
} catch (error) {
    process.stderr.write(`compare-pmd-cpd: ${error.message}\n`);
    process.exitCode = 2;
}
