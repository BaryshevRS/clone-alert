# clone-alert

PMD CPD-like copy-paste detector для поиска дублей по токенам в TypeScript,
JavaScript и популярных frontend-шаблонах.

Ядро лежит в `src/core.ts`, токенайзеры в `src/tokenizers.ts`, CLI в
`src/cli.ts`.

## Установка и сборка

Проект собирается TypeScript 6 (`typescript@^6.0.3`) и Node.js 18+.

```sh
npm install
npm run build
```

После сборки CLI доступен как `dist/cli.js`. Через npm-bin:

```sh
npx clone-alert --help
```

Установка из npm:

```sh
npm install --save-dev clone-alert
npx clone-alert --minimum-tokens 50 --files src
```

Локально без публикации:

```sh
node dist/cli.js --minimum-tokens 50 --files src
```

## Использование

```sh
clone-alert [options] [<path>...]
```

Основные опции совместимы по духу с `pmd cpd`:

- `--files <path[,path...]>` - файлы или директории для анализа.
- `--minimum-tokens <n>` - минимальная длина дубля в токенах, по умолчанию `50`.
- `--minimum-tile-size <n>` - алиас для `--minimum-tokens`.
- `--format <text|xml|json>` - формат отчета, по умолчанию `text`.
- `--extensions <ext[,ext...]>` - список расширений для рекурсивного обхода.
- `--exclude <glob[,glob...]>` - исключить файлы или директории, можно повторять.
- `--ignore-identifiers` / `--no-ignore-identifiers` - нормализовать или сравнивать имена.
- `--ignore-literals` / `--no-ignore-literals` - нормализовать или сравнивать литералы.
- `--skip-angular-inline-templates` - не анализировать inline template в `@Component`.
- `--fail-on-violation` - вернуть exit code `4`, если дубли найдены.

Примеры:

```sh
node dist/cli.js --minimum-tokens 30 --files src --fail-on-violation
node dist/cli.js --minimum-tokens 50 --format xml src test
node dist/cli.js --format json --files src,packages --exclude '**/generated/**'
```

Поддерживаемые расширения по умолчанию:

```text
.ts, .tsx, .js, .jsx, .mts, .cts, .mjs, .cjs, .vue, .svelte, .html, .htm
```

Для `.vue`, `.svelte` и Angular HTML токенайзеры используют optional peer-пакеты
`@vue/compiler-sfc`, `svelte` и `@angular/compiler`. Если пакет не установлен,
соответствующие файлы будут пропущены с предупреждением.

## PMD CPD compatibility scope

`clone-alert` целится в PMD CPD-like поиск дублей для JavaScript/TypeScript
экосистемы: `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, а также frontend
шаблоны, которые типичны для TS-проектов.

Проверяемая совместимость сейчас покрывает:

- PMD JavaScript/TypeScript CPD tokenizer fixtures, vendored в `test/fixtures/pmd/**`.
- Итоговый duplicate search по токенам, включая `--ignore-identifiers`,
  `--ignore-literals` и suppress markers `CPD-OFF` / `CPD-ON`.
- JSX/TSX tokenization и duplicate detection для React-like компонентов.
- Реальные npm layouts: `src/**/*.ts`, `src/**/*.tsx`, monorepo `packages/**`
  и исключение generated файлов через `--exclude`.
- Отчёты `text`, `json`, `xml`: порядок occurrence, token counts, line ranges и paths.
- PMD `pmd-core/src/test/java/net/sourceforge/pmd/cpd` coverage matrix:
  core/model tests ported, renderer/config/file-analysis gaps marked explicitly.

PMD fixtures лежат внутри репозитория, поэтому тесты не требуют локального PMD
checkout или git submodule. Vendored golden data исключены из Biome и TypeScript
project checking, чтобы upstream fixture content не переформатировался.

## Проверка

```sh
npm run lint
npm test
npm run pack:dry-run
```

`npm run lint` запускает Biome auto-check, Knip, TypeScript typecheck и встроенный
`clone-alert` CPD-аналог вместо PMD. `npm test` собирает проект и запускает
Vitest-набор: CLI smoke/compat tests, алгоритмические CPD edge cases и golden
fixtures PMD для JavaScript/TypeScript CPD tokenizer.

`npm run pack:dry-run` собирает пакет через `prepack` и показывает состав npm
tarball без публикации.
