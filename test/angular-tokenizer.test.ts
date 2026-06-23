import { describe, expect, test } from 'vitest';
import { extractAngularInlineTemplates, tokenizeAngularHtml } from '../src/angular';
import { S } from '../src/core';
import { Cpd } from '../src/index';

// Образы шаблонных токенов лежат в S-префиксованном неймспейсе (см. src/angular.ts).
const NG = `${S}NG:`;
const NG_ID = `${S}NGID`; // нормализованный идентификатор (ignoreIdentifiers)
const NG_LIT = `${S}NGLIT`; // нормализованный литерал (ignoreLiterals)
const NG_TEXT = `${S}NGTEXT`; // статический текст

const img = (tpl: string, opts?: Parameters<typeof tokenizeAngularHtml>[3], base?: { line: number; col: number }) =>
    tokenizeAngularHtml('t.html', tpl, base, opts).map((t) => t.image);

describe('Angular tokenizer — структура', () => {
    test('теги и статический текст', () => {
        expect(img('<div><span>hi</span></div>')).toEqual([`${NG}<div`, `${NG}<span`, NG_TEXT]);
    });

    test('глубокая вложенность сохраняет порядок', () => {
        expect(img('<div><section><span>{{a.b.c}}</span></section></div>')).toEqual([
            `${NG}<div`,
            `${NG}<section`,
            `${NG}<span`,
            `${NG}id:a`,
            `${NG}id:b`,
            `${NG}id:c`,
        ]);
    });

    test('void-элемент с биндингом', () => {
        expect(img('<input [value]="v">')).toEqual([`${NG}<input`, `${NG}@value`, `${NG}id:v`]);
    });

    test('статическое значение атрибута -> литерал', () => {
        expect(img('<div class="box">x</div>')).toEqual([`${NG}<div`, `${NG}@class`, `${NG}lit:"box"`, NG_TEXT]);
    });
});

describe('Angular tokenizer — выражения биндингов', () => {
    test('интерполяция: цепочка свойств', () => {
        expect(img('<div>{{ user.name }}</div>')).toEqual([`${NG}<div`, `${NG}id:user`, `${NG}id:name`]);
    });

    test('бинарный оператор', () => {
        expect(img('<div>{{ a + b }}</div>')).toEqual([`${NG}<div`, `${NG}op:+`, `${NG}id:a`, `${NG}id:b`]);
    });

    test('тернарный оператор', () => {
        expect(img('<div>{{ x ? y : z }}</div>')).toEqual([
            `${NG}<div`,
            `${NG}?:`,
            `${NG}id:x`,
            `${NG}id:y`,
            `${NG}id:z`,
        ]);
    });

    test('вызов метода', () => {
        expect(img('<div>{{ foo(a) }}</div>')).toEqual([`${NG}<div`, `${NG}id:foo`, `${NG}()`, `${NG}id:a`]);
    });

    test('пайп', () => {
        expect(img('<div>{{ x | uppercase }}</div>')).toEqual([
            `${NG}<div`,
            `${NG}id:x`,
            `${NG}pipe`,
            `${NG}id:uppercase`,
        ]);
    });

    test('safe-навигация ?.', () => {
        expect(img('<div>{{ a?.b }}</div>')).toEqual([`${NG}<div`, `${NG}id:a`, `${NG}?.`, `${NG}id:b`]);
    });

    test('индексный доступ', () => {
        expect(img('<div>{{ arr[i] }}</div>')).toEqual([`${NG}<div`, `${NG}id:arr`, `${NG}[]`, `${NG}id:i`]);
    });

    test('строковый и числовой литералы различимы по значению', () => {
        expect(img(`<div>{{ 'hi' }}</div>`)).toEqual([`${NG}<div`, `${NG}lit:"hi"`]);
        expect(img('<div>{{ 42 }}</div>')).toEqual([`${NG}<div`, `${NG}lit:42`]);
    });

    test('литерал-массив и литерал-объект', () => {
        expect(img('<div [x]="[1,d]">y</div>')).toEqual([
            `${NG}<div`,
            `${NG}@x`,
            `${NG}[arr]`,
            `${NG}lit:1`,
            `${NG}id:d`,
            NG_TEXT,
        ]);
        expect(img('<div [x]="{a:1,b:c}">y</div>')).toEqual([
            `${NG}<div`,
            `${NG}@x`,
            `${NG}{map}`,
            `${NG}id:a`,
            `${NG}id:b`,
            `${NG}lit:1`,
            `${NG}id:c`,
            NG_TEXT,
        ]);
    });

    test('input-биндинг и event-handler', () => {
        expect(img(`<a [href]="url" (click)="go()">x</a>`)).toEqual([
            `${NG}<a`,
            `${NG}@href`,
            `${NG}id:url`,
            `${NG}@click`,
            `${NG}id:go`,
            `${NG}()`,
            NG_TEXT,
        ]);
    });

    test('разные выражения дают разные токены (не схлопываются в плейсхолдер)', () => {
        expect(img('<div>{{a}}</div>')).not.toEqual(img('<div>{{b}}</div>'));
    });
});

describe('Angular tokenizer — control-flow блоки', () => {
    test('@if', () => {
        expect(img('@if (cond) { <p>x</p> }')).toEqual([`${NG}@expr`, `${NG}id:cond`, `${NG}<p`, NG_TEXT]);
    });

    test('@for: выражение, track и переменная цикла', () => {
        expect(img('@for (item of items; track item.id) { <li>{{item}}</li> }')).toEqual([
            `${NG}@expr`,
            `${NG}id:items`,
            `${NG}@track`,
            `${NG}id:item`,
            `${NG}id:id`,
            `${NG}@item`,
            `${NG}lit:"$implicit"`,
            `${NG}<li`,
            `${NG}id:item`,
        ]);
    });

    // Регрессия: @case (value) — листовой SwitchBlockCase без массива детей,
    // его выражение раньше терялось.
    test('@switch ловит значение каждого @case', () => {
        expect(img(`@switch (s) { @case (1) { <a>1</a> } @default { <b>d</b> } }`)).toEqual([
            `${NG}@expr`,
            `${NG}id:s`,
            `${NG}<a`,
            NG_TEXT,
            `${NG}@expr`,
            `${NG}lit:1`,
            `${NG}<b`,
            NG_TEXT,
        ]);
    });
});

describe('Angular tokenizer — ng-template и структурные директивы', () => {
    // Регрессия: [ngIf] на <ng-template> лежит в inputs Template-узла,
    // контейнерная ветка раньше их не обходила.
    test('биндинг на <ng-template> не теряется', () => {
        expect(img('<ng-template [ngIf]="show"><p>x</p></ng-template>')).toEqual([
            `${NG}<ng-template`,
            `${NG}@ngIf`,
            `${NG}id:show`,
            `${NG}<p`,
            NG_TEXT,
        ]);
    });

    test('*ngIf микросинтаксис (templateAttrs)', () => {
        expect(img('<div *ngIf="show">x</div>')).toEqual([
            `${NG}<div`,
            `${NG}@ngIf`,
            `${NG}id:show`,
            `${NG}<div`,
            NG_TEXT,
        ]);
    });

    test('let-переменная на ng-template', () => {
        expect(img('<ng-template let-n="nm"><p>{{n}}</p></ng-template>')).toEqual([
            `${NG}<ng-template`,
            `${NG}@n`,
            `${NG}lit:"nm"`,
            `${NG}<p`,
            `${NG}id:n`,
        ]);
    });
});

describe('Angular tokenizer — опции нормализации', () => {
    test('ignoreIdentifiers схлопывает только идентификаторы', () => {
        expect(img('<div>{{ user.name + 1 }}</div>', { ignoreIdentifiers: true })).toEqual([
            `${NG}<div`,
            `${NG}op:+`,
            NG_ID,
            NG_ID,
            `${NG}lit:1`,
        ]);
    });

    test('ignoreLiterals схлопывает статику и литералы', () => {
        expect(img(`<div class="x">{{ 'hi' }}</div>`, { ignoreLiterals: true })).toEqual([
            `${NG}<div`,
            `${NG}@class`,
            NG_LIT,
            NG_LIT,
        ]);
    });
});

describe('Angular tokenizer — позиции и неймспейс', () => {
    test('base сдвигает координаты inline-шаблона', () => {
        const toks = tokenizeAngularHtml('t.html', '<div>{{a}}</div>', { line: 10, col: 5 });
        expect(toks[0]).toMatchObject({ image: `${NG}<div`, line: 10, column: 5 });
        // под-токен выражения наследует строку хоста, столбец первой строки сдвинут на base.col
        expect(toks[1]).toMatchObject({ image: `${NG}id:a`, line: 10 });
    });

    test('все образы шаблона S-префиксованы (нет кросс-матчей со script)', () => {
        const toks = img('<div [x]="a.b(c) | p">{{ y ? z : 1 }}</div>');
        expect(toks.length).toBeGreaterThan(0);
        expect(toks.every((i) => i.startsWith(S))).toBe(true);
    });
});

describe('Angular tokenizer — edge cases / устойчивость', () => {
    test('пустой шаблон -> []', () => {
        expect(img('')).toEqual([]);
        expect(img('   \n  ')).toEqual([]);
    });

    test('только комментарий -> []', () => {
        expect(img('<!-- nothing -->')).toEqual([]);
    });

    test('незакрытый тег не роняет токенайзер', () => {
        expect(() => img('<div><span>oops')).not.toThrow();
    });
});

describe('extractAngularInlineTemplates', () => {
    test('извлекает inline template и его позицию, пропускает templateUrl', () => {
        const src = [
            ``,
            `@Component({ selector: 'x', template: '<p>{{a}}</p>' })`,
            `export class X {}`,
            `@Component({ templateUrl: './y.html' })`,
            `export class Y {}`,
            ``,
        ].join('\n');
        expect(extractAngularInlineTemplates('c.ts', src)).toEqual([{ code: '<p>{{a}}</p>', line: 2, col: 40 }]);
    });

    test('бэктик-шаблон тоже извлекается', () => {
        const src = '@Component({ template: `<div>{{x}}</div>` }) export class Z {}';
        const out = extractAngularInlineTemplates('c.ts', src);
        expect(out).toHaveLength(1);
        expect(out[0].code).toBe('<div>{{x}}</div>');
    });
});

describe('Cpd — обнаружение клонов в шаблонах (e2e)', () => {
    const dup = '<div>{{user.name}}<span>{{user.age}}</span><a [href]="user.url">go</a></div>';

    test('одинаковые .html находятся как клон', () => {
        const cpd = new Cpd({ minTileSize: 5 });
        cpd.addSource('a.html', dup);
        cpd.addSource('b.html', dup);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].markCount).toBe(2);
    });

    test('структурно разные шаблоны не матчатся', () => {
        const cpd = new Cpd({ minTileSize: 5 });
        cpd.addSource('a.html', dup);
        cpd.addSource('b.html', '<ul><li>{{x}}</li></ul>');
        expect(cpd.run()).toHaveLength(0);
    });

    test('нет кросс-матча между script и шаблоном с теми же идентификаторами', () => {
        const cpd = new Cpd({ minTileSize: 3 });
        cpd.addSource('a.ts', 'const user = name; const span = user.age; user.url;');
        cpd.addSource('b.html', dup);
        // разные неймспейсы => совпадений между файлами нет
        expect(cpd.run()).toHaveLength(0);
    });

    test('inline-шаблон в .ts матчится с внешним .html (единый неймспейс)', () => {
        const cpd = new Cpd({ minTileSize: 5, angularInlineTemplates: true });
        cpd.addSource('cmp.ts', `@Component({ template: \`${dup}\` }) export class C {}`);
        cpd.addSource('ext.html', dup);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        const files = matches[0].marks.map((m) => m.token.file).sort();
        expect(files).toEqual(['cmp.ts', 'ext.html']);
    });
});
