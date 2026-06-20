import { describe, expect, test } from 'vitest';

type CoverageStatus = 'ported' | 'partial' | 'out-of-scope';

interface PmdCoreCoverage {
    className: string;
    status: CoverageStatus;
    localCoverage: string;
    reason?: string;
}

const PMD_CORE_CPD_COVERAGE: PmdCoreCoverage[] = [
    {
        className: 'AnyCpdLexerTest',
        status: 'out-of-scope',
        localCoverage: 'JS/TS tokenizer golden fixtures cover the supported ecosystem tokenizers.',
        reason: 'PMD dummy/any lexer is not exposed by the JS/TS-only CLI.',
    },
    {
        className: 'CPDConfigurationTest',
        status: 'out-of-scope',
        localCoverage: 'CLI argument parsing is covered by cli.test.ts and pmd-project-scenarios.test.ts.',
        reason: 'PMD Java language registry and renderer configuration APIs do not exist in this package.',
    },
    {
        className: 'CPDFilelistTest',
        status: 'out-of-scope',
        localCoverage: 'Directory and repeated --files style scans are covered by CLI tests.',
        reason: 'PMD --file-list compatibility is not implemented yet.',
    },
    {
        className: 'CPDReportTest',
        status: 'partial',
        localCoverage: 'JSON/XML/text report tests cover duplicate ordering, paths, line ranges, and token counts.',
        reason: 'There is no public CPDReport object with filterMatches semantics.',
    },
    {
        className: 'CSVRendererTest',
        status: 'out-of-scope',
        localCoverage: 'JSON/XML/text report formats are covered.',
        reason: 'CSV output is not a supported CLI format.',
    },
    {
        className: 'CpdAnalysisTest',
        status: 'partial',
        localCoverage: 'Project scenario tests cover directory traversal, file order, missing paths, and excludes.',
        reason: 'Symlink identity and PMD lexical-error continuation APIs are not implemented.',
    },
    {
        className: 'CpdXsltTest',
        status: 'out-of-scope',
        localCoverage: 'No local equivalent.',
        reason: 'PMD XSLT HTML report generation is not supported.',
    },
    {
        className: 'MarkTest',
        status: 'ported',
        localCoverage: 'pmd-match-algorithm.test.ts covers mark token identity and source locations.',
    },
    {
        className: 'MarkdownCodeBlockTest',
        status: 'out-of-scope',
        localCoverage: 'No local equivalent.',
        reason: 'Markdown report rendering is not supported.',
    },
    {
        className: 'MarkdownRendererTest',
        status: 'out-of-scope',
        localCoverage: 'No local equivalent.',
        reason: 'Markdown report rendering is not supported.',
    },
    {
        className: 'MarkdownSyntaxHighlightingLanguageTest',
        status: 'out-of-scope',
        localCoverage: 'No local equivalent.',
        reason: 'Markdown report rendering is not supported.',
    },
    {
        className: 'MatchAlgorithmTest',
        status: 'ported',
        localCoverage: 'pmd-match-algorithm.test.ts ports simple duplicate and multiple-match behavior.',
    },
    {
        className: 'MatchTest',
        status: 'ported',
        localCoverage: 'pmd-match-algorithm.test.ts covers token counts, mark order, dedupe, and match ordering.',
    },
    {
        className: 'TokenEntryTest',
        status: 'ported',
        localCoverage: 'pmd-match-algorithm.test.ts covers token identity, index, start, and end positions.',
    },
    {
        className: 'XMLOldRendererTest',
        status: 'out-of-scope',
        localCoverage: 'Current XML renderer is covered in pmd-cli-compat.test.ts.',
        reason: 'Legacy PMD XML renderer is not supported.',
    },
    {
        className: 'XMLRendererTest',
        status: 'partial',
        localCoverage: 'pmd-cli-compat.test.ts covers XML escaping, tokens, occurrences, and start/end locations.',
        reason: 'PMD XML schema, code fragments, token indexes, and processing errors are not implemented.',
    },
    {
        className: 'impl/BaseTokenFilterTest',
        status: 'out-of-scope',
        localCoverage: 'CPD-OFF/CPD-ON tokenizer behavior is covered by pmd-match-algorithm.test.ts.',
        reason: 'The TypeScript scanner path does not expose PMD BaseTokenFilter iterator semantics.',
    },
];

describe('PMD core CPD compatibility coverage matrix', () => {
    test('classifies every local PMD pmd-core CPD test class', () => {
        expect(PMD_CORE_CPD_COVERAGE.map((entry) => entry.className).sort()).toEqual([
            'AnyCpdLexerTest',
            'CPDConfigurationTest',
            'CPDFilelistTest',
            'CPDReportTest',
            'CSVRendererTest',
            'CpdAnalysisTest',
            'CpdXsltTest',
            'MarkTest',
            'MarkdownCodeBlockTest',
            'MarkdownRendererTest',
            'MarkdownSyntaxHighlightingLanguageTest',
            'MatchAlgorithmTest',
            'MatchTest',
            'TokenEntryTest',
            'XMLOldRendererTest',
            'XMLRendererTest',
            'impl/BaseTokenFilterTest',
        ]);
    });

    test('requires unsupported PMD core classes to carry an explicit reason', () => {
        const unsupported = PMD_CORE_CPD_COVERAGE.filter((entry) => entry.status !== 'ported');

        expect(unsupported).toEqual(
            unsupported.map((entry) =>
                expect.objectContaining({
                    reason: expect.stringMatching(/\S/),
                })
            )
        );
    });

    test('keeps core algorithm and model tests ported', () => {
        const coreClasses = ['MarkTest', 'MatchAlgorithmTest', 'MatchTest', 'TokenEntryTest'];

        expect(
            PMD_CORE_CPD_COVERAGE.filter((entry) => coreClasses.includes(entry.className)).map((entry) => entry.status)
        ).toEqual(['ported', 'ported', 'ported', 'ported']);
    });
});
