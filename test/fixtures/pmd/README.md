# PMD CPD Fixtures

This directory vendors the PMD CPD JavaScript/TypeScript tokenizer fixtures
used by the Vitest compatibility suite.

Source repository path:

```text
pmd-javascript/src/test/resources/net/sourceforge/pmd/lang/{ecmascript,typescript}/cpd/testdata
```

The copied fixtures are from PMD and retain PMD's BSD-style license terms;
`LICENSE` and `NOTICE` are copied from the upstream PMD checkout.
Fixtures are discovered from disk by `test/helpers/pmd-fixtures.ts`, so newly
vendored `.js` and `.ts` files with matching `.txt` token dumps are covered by
`test/pmd-tokenizer-fixtures.test.ts` automatically. Unsupported fixtures must
be listed explicitly in `UNSUPPORTED_PMD_FIXTURES` with a concrete reason; an
unlisted fixture is treated as supported.

The fixture tree is intentionally excluded from Biome formatting and TypeScript
project checks. These files are upstream golden data, not local source code.
