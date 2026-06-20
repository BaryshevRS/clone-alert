# PMD CPD Fixtures

This directory vendors the minimal PMD CPD JavaScript/TypeScript tokenizer
fixtures used by the Vitest compatibility suite.

Source repository path:

```text
pmd-javascript/src/test/resources/net/sourceforge/pmd/lang/{ecmascript,typescript}/cpd/testdata
```

The copied fixtures are from PMD and retain PMD's BSD-style license terms;
`LICENSE` and `NOTICE` are copied from the upstream PMD checkout.
Only the fixture subset used by `test/pmd-tokenizer-fixtures.test.ts` is copied
here so the test suite is self-contained and does not depend on a local PMD
checkout or git submodule.
