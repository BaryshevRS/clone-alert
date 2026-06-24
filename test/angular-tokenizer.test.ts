import { describe, expect, test } from 'vitest';
import { extractAngularInlineTemplates, tokenizeAngularHtml } from '../src/angular';
import { S } from '../src/core';
import { Cpd } from '../src/index';

// Template token images live in the S-prefixed namespace (see src/angular.ts).
const NG = `${S}NG:`;
const NG_ID = `${S}NGID`; // normalized identifier (ignoreIdentifiers)
const NG_LIT = `${S}NGLIT`; // normalized literal (ignoreLiterals)
const NG_TEXT = `${S}NGTEXT`; // static text

const img = (tpl: string, opts?: Parameters<typeof tokenizeAngularHtml>[3], base?: { line: number; col: number }) =>
    tokenizeAngularHtml('t.html', tpl, base, opts).map((t) => t.image);

describe('Angular tokenizer — structure', () => {
    test('tags and static text', () => {
        expect(img('<div><span>hi</span></div>')).toEqual([`${NG}<div`, `${NG}<span`, NG_TEXT]);
    });

    test('deep nesting preserves order', () => {
        expect(img('<div><section><span>{{a.b.c}}</span></section></div>')).toEqual([
            `${NG}<div`,
            `${NG}<section`,
            `${NG}<span`,
            `${NG}id:a`,
            `${NG}id:b`,
            `${NG}id:c`,
        ]);
    });

    test('void element with a binding', () => {
        expect(img('<input [value]="v">')).toEqual([`${NG}<input`, `${NG}@value`, `${NG}id:v`]);
    });

    test('static attribute value -> literal', () => {
        expect(img('<div class="box">x</div>')).toEqual([`${NG}<div`, `${NG}@class`, `${NG}lit:"box"`, NG_TEXT]);
    });
});

describe('Angular tokenizer — binding expressions', () => {
    test('interpolation: property chain', () => {
        expect(img('<div>{{ user.name }}</div>')).toEqual([`${NG}<div`, `${NG}id:user`, `${NG}id:name`]);
    });

    test('binary operator', () => {
        expect(img('<div>{{ a + b }}</div>')).toEqual([`${NG}<div`, `${NG}op:+`, `${NG}id:a`, `${NG}id:b`]);
    });

    test('ternary operator', () => {
        expect(img('<div>{{ x ? y : z }}</div>')).toEqual([
            `${NG}<div`,
            `${NG}?:`,
            `${NG}id:x`,
            `${NG}id:y`,
            `${NG}id:z`,
        ]);
    });

    test('method call', () => {
        expect(img('<div>{{ foo(a) }}</div>')).toEqual([`${NG}<div`, `${NG}id:foo`, `${NG}()`, `${NG}id:a`]);
    });

    test('pipe', () => {
        expect(img('<div>{{ x | uppercase }}</div>')).toEqual([
            `${NG}<div`,
            `${NG}id:x`,
            `${NG}pipe`,
            `${NG}id:uppercase`,
        ]);
    });

    test('safe navigation ?.', () => {
        expect(img('<div>{{ a?.b }}</div>')).toEqual([`${NG}<div`, `${NG}id:a`, `${NG}?.`, `${NG}id:b`]);
    });

    test('indexed access', () => {
        expect(img('<div>{{ arr[i] }}</div>')).toEqual([`${NG}<div`, `${NG}id:arr`, `${NG}[]`, `${NG}id:i`]);
    });

    test('string and numeric literals are distinguished by value', () => {
        expect(img(`<div>{{ 'hi' }}</div>`)).toEqual([`${NG}<div`, `${NG}lit:"hi"`]);
        expect(img('<div>{{ 42 }}</div>')).toEqual([`${NG}<div`, `${NG}lit:42`]);
    });

    test('array literal and object literal', () => {
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

    test('input binding and event handler', () => {
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

    test('different expressions yield different tokens (not collapsed into a placeholder)', () => {
        expect(img('<div>{{a}}</div>')).not.toEqual(img('<div>{{b}}</div>'));
    });
});

describe('Angular tokenizer — control-flow blocks', () => {
    test('@if', () => {
        expect(img('@if (cond) { <p>x</p> }')).toEqual([`${NG}@expr`, `${NG}id:cond`, `${NG}<p`, NG_TEXT]);
    });

    test('@for: expression, track, and loop variable', () => {
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

    // Regression: @case (value) is a leaf SwitchBlockCase with no children array;
    // its expression used to be lost.
    test('@switch captures the value of every @case', () => {
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

describe('Angular tokenizer — ng-template and structural directives', () => {
    // Regression: [ngIf] on <ng-template> lives in the Template node's inputs;
    // the container branch used to skip them.
    test('a binding on <ng-template> is not lost', () => {
        expect(img('<ng-template [ngIf]="show"><p>x</p></ng-template>')).toEqual([
            `${NG}<ng-template`,
            `${NG}@ngIf`,
            `${NG}id:show`,
            `${NG}<p`,
            NG_TEXT,
        ]);
    });

    test('*ngIf microsyntax (templateAttrs)', () => {
        expect(img('<div *ngIf="show">x</div>')).toEqual([
            `${NG}<div`,
            `${NG}@ngIf`,
            `${NG}id:show`,
            `${NG}<div`,
            NG_TEXT,
        ]);
    });

    test('let variable on ng-template', () => {
        expect(img('<ng-template let-n="nm"><p>{{n}}</p></ng-template>')).toEqual([
            `${NG}<ng-template`,
            `${NG}@n`,
            `${NG}lit:"nm"`,
            `${NG}<p`,
            `${NG}id:n`,
        ]);
    });
});

describe('Angular tokenizer — normalization options', () => {
    test('ignoreIdentifiers collapses identifiers only', () => {
        expect(img('<div>{{ user.name + 1 }}</div>', { ignoreIdentifiers: true })).toEqual([
            `${NG}<div`,
            `${NG}op:+`,
            NG_ID,
            NG_ID,
            `${NG}lit:1`,
        ]);
    });

    test('ignoreLiterals collapses static text and literals', () => {
        expect(img(`<div class="x">{{ 'hi' }}</div>`, { ignoreLiterals: true })).toEqual([
            `${NG}<div`,
            `${NG}@class`,
            NG_LIT,
            NG_LIT,
        ]);
    });
});

describe('Angular tokenizer — positions and namespace', () => {
    test('base shifts the coordinates of an inline template', () => {
        const toks = tokenizeAngularHtml('t.html', '<div>{{a}}</div>', { line: 10, col: 5 });
        expect(toks[0]).toMatchObject({ image: `${NG}<div`, line: 10, column: 5 });
        // the expression sub-token inherits the host line; the first-line column is shifted by base.col
        expect(toks[1]).toMatchObject({ image: `${NG}id:a`, line: 10 });
    });

    test('every template image is S-prefixed (no cross-matches with script)', () => {
        const toks = img('<div [x]="a.b(c) | p">{{ y ? z : 1 }}</div>');
        expect(toks.length).toBeGreaterThan(0);
        expect(toks.every((i) => i.startsWith(S))).toBe(true);
    });
});

describe('Angular tokenizer — edge cases / robustness', () => {
    test('empty template -> []', () => {
        expect(img('')).toEqual([]);
        expect(img('   \n  ')).toEqual([]);
    });

    test('comment only -> []', () => {
        expect(img('<!-- nothing -->')).toEqual([]);
    });

    test('an unclosed tag does not crash the tokenizer', () => {
        expect(() => img('<div><span>oops')).not.toThrow();
    });
});

describe('extractAngularInlineTemplates', () => {
    test('extracts an inline template and its position, skips templateUrl', () => {
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

    test('a backtick template is extracted too', () => {
        const src = '@Component({ template: `<div>{{x}}</div>` }) export class Z {}';
        const out = extractAngularInlineTemplates('c.ts', src);
        expect(out).toHaveLength(1);
        expect(out[0].code).toBe('<div>{{x}}</div>');
    });
});

describe('Cpd — clone detection in templates (e2e)', () => {
    const dup = '<div>{{user.name}}<span>{{user.age}}</span><a [href]="user.url">go</a></div>';

    test('identical .html files are detected as a clone', () => {
        const cpd = new Cpd({ minTileSize: 5 });
        cpd.addSource('a.html', dup);
        cpd.addSource('b.html', dup);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].markCount).toBe(2);
    });

    test('structurally different templates do not match', () => {
        const cpd = new Cpd({ minTileSize: 5 });
        cpd.addSource('a.html', dup);
        cpd.addSource('b.html', '<ul><li>{{x}}</li></ul>');
        expect(cpd.run()).toHaveLength(0);
    });

    test('no cross-match between script and a template with the same identifiers', () => {
        const cpd = new Cpd({ minTileSize: 3 });
        cpd.addSource('a.ts', 'const user = name; const span = user.age; user.url;');
        cpd.addSource('b.html', dup);
        // different namespaces => no matches between the files
        expect(cpd.run()).toHaveLength(0);
    });

    test('an inline template in .ts matches an external .html (shared namespace)', () => {
        const cpd = new Cpd({ minTileSize: 5, angularInlineTemplates: true });
        cpd.addSource('cmp.ts', `@Component({ template: \`${dup}\` }) export class C {}`);
        cpd.addSource('ext.html', dup);
        const matches = cpd.run();
        expect(matches.length).toBeGreaterThan(0);
        const files = matches[0].marks.map((m) => m.token.file).sort();
        expect(files).toEqual(['cmp.ts', 'ext.html']);
    });
});
