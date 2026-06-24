/**
 * Tokenizer extension for Angular templates (external `.html` and inline
 * `@Component`). Built on top of the shared layer in tokenizers.ts
 * (optional/moduleResolveDirs/remap) and the shared sentinel `S` from core.ts.
 * The core (core.ts) knows nothing about Angular.
 *
 * @packageDocumentation
 */
import * as ts from 'typescript';
import { type RawToken, S } from './core';
import { DEFAULTS, moduleResolveDirs, optional, remap, type TokenizeOptions } from './tokenizers';

// Token namespace for Angular template expressions. The S prefix guarantees these
// images never collide with script tokens (no .ts<->template cross-matches).
const NG = `${S}NG:`; // prefix for structural markers / expression names
const NG_ID = `${S}NGID`; // normalized template identifier (ignoreIdentifiers)
const NG_LIT = `${S}NGLIT`; // normalized template literal (ignoreLiterals)
const NG_TEXT = `${S}NGTEXT`; // static template text

let warnedNg = false;

/**
 * Tokenize an Angular HTML template (external `.html` or inline). Two layers:
 * (1) structure — tags, attribute names, static text; (2) binding/interpolation/
 * block expressions — an AST walk over @angular/compiler with the same id/literal
 * normalization as in script. All images are S-prefixed (see NG/NG_ID/NG_LIT) so
 * there are no cross-matches with script tokens.
 *
 * Expression sub-token positions are inherited from the enclosing (host) node:
 * matching is exact, report granularity is at the binding-line level (no line map
 * is built).
 */
export function tokenizeAngularHtml(
    filePath: string,
    template: string,
    base: { line: number; col: number } = { line: 1, col: 1 },
    options?: TokenizeOptions
): RawToken[] {
    const o = { ...DEFAULTS, ...options };
    const ngc = optional('@angular/compiler', moduleResolveDirs(filePath));
    if (!ngc || typeof ngc.parseTemplate !== 'function') {
        if (!warnedNg) {
            console.warn('[cpd] Angular template skipped: install @angular/compiler');
            warnedNg = true;
        }
        return [];
    }
    let parsed: any;
    try {
        parsed = ngc.parseTemplate(template, filePath, { preserveWhitespaces: false });
    } catch {
        return [];
    }
    if (!parsed || !Array.isArray(parsed.nodes)) return [];

    const local: RawToken[] = [];
    const emit = (image: string, node: any) => {
        const sp = node?.sourceSpan ?? node?.startSourceSpan;
        const loc = sp?.start;
        local.push({ image, line: (loc?.line ?? 0) + 1, column: (loc?.col ?? 0) + 1 });
    };
    const emitId = (name: unknown, host: any) => emit(o.ignoreIdentifiers ? NG_ID : `${NG}id:${String(name)}`, host);
    const emitLit = (value: unknown, host: any) =>
        emit(o.ignoreLiterals ? NG_LIT : `${NG}lit:${JSON.stringify(value)}`, host);

    // Walk a binding expression. host is the structural node whose coordinates we inherit.
    const walkExpr = (ast: any, host: any) => {
        if (ast == null || typeof ast !== 'object') return;
        // ASTWithSource is a wrapper; unwrap it down to the actual expression.
        if (ast.ast && typeof ast.ast === 'object') return walkExpr(ast.ast, host);

        switch (ast.constructor?.name) {
            case 'Interpolation':
                for (const e of ast.expressions ?? []) walkExpr(e, host);
                return;
            case 'Binary':
                emit(`${NG}op:${ast.operation}`, host);
                walkExpr(ast.left, host);
                walkExpr(ast.right, host);
                return;
            case 'Unary':
                emit(`${NG}op:${ast.operator}`, host);
                walkExpr(ast.expr, host);
                return;
            case 'PrefixNot':
                emit(`${NG}op:!`, host);
                walkExpr(ast.expression, host);
                return;
            case 'NonNullAssert':
                emit(`${NG}!.`, host);
                walkExpr(ast.expression, host);
                return;
            case 'Conditional':
                emit(`${NG}?:`, host);
                walkExpr(ast.condition, host);
                walkExpr(ast.trueExp, host);
                walkExpr(ast.falseExp, host);
                return;
            case 'PropertyRead':
                walkExpr(ast.receiver, host);
                emitId(ast.name, host);
                return;
            case 'SafePropertyRead':
                walkExpr(ast.receiver, host);
                emit(`${NG}?.`, host);
                emitId(ast.name, host);
                return;
            case 'KeyedRead':
                walkExpr(ast.receiver, host);
                emit(`${NG}[]`, host);
                walkExpr(ast.key, host);
                return;
            case 'SafeKeyedRead':
                walkExpr(ast.receiver, host);
                emit(`${NG}?.[]`, host);
                walkExpr(ast.key, host);
                return;
            case 'Call':
            case 'SafeCall':
                walkExpr(ast.receiver, host);
                emit(`${NG}()`, host);
                for (const a of ast.args ?? []) walkExpr(a, host);
                return;
            case 'BindingPipe':
                walkExpr(ast.exp, host);
                emit(`${NG}pipe`, host);
                emitId(ast.name, host);
                for (const a of ast.args ?? []) walkExpr(a, host);
                return;
            case 'LiteralArray':
                emit(`${NG}[arr]`, host);
                for (const e of ast.expressions ?? []) walkExpr(e, host);
                return;
            case 'LiteralMap':
                emit(`${NG}{map}`, host);
                for (const k of ast.keys ?? []) emitId(k?.key, host);
                for (const v of ast.values ?? []) walkExpr(v, host);
                return;
            case 'LiteralPrimitive':
                emitLit(ast.value, host);
                return;
            case 'ThisReceiver':
                emit(`${NG}this`, host);
                return;
            case 'ParenthesizedExpression':
                walkExpr(ast.expression, host);
                return;
            case 'ImplicitReceiver':
            case 'EmptyExpr':
                return; // root component context — no token needed
        }
    };

    const walk = (node: any) => {
        if (node == null) return;
        const walkAll = (items: unknown[] | undefined) => {
            for (const item of items ?? []) walk(item);
        };

        // All of a node's binding collections (common to Element and Template/ng-template).
        const walkBindings = (n: any) => {
            walkAll(n.attributes);
            walkAll(n.inputs);
            walkAll(n.outputs);
            walkAll(n.directives);
            walkAll(n.references);
        };

        // Element (has a tag name + children)
        if (typeof node.name === 'string' && Array.isArray(node.children)) {
            emit(`${NG}<${node.name}`, node);
            walkBindings(node);
            walkAll(node.children);
            return;
        }
        // Containers: ng-template, control-flow blocks (@if/@for/@switch/@defer).
        // node.expression also catches leaf blocks without children (@case (…) -> SwitchBlockCase).
        if (
            Array.isArray(node.children) ||
            Array.isArray(node.branches) ||
            Array.isArray(node.cases) ||
            Array.isArray(node.groups) ||
            node.expression
        ) {
            if (typeof node.tagName === 'string') emit(`${NG}<${node.tagName}`, node);
            // Block control expressions (@for of …; track …; @if/@case (…)).
            if (node.expression) {
                emit(`${NG}@expr`, node);
                walkExpr(node.expression, node);
            }
            if (node.trackBy) {
                emit(`${NG}@track`, node);
                walkExpr(node.trackBy, node);
            }
            walkBindings(node);
            walkAll(node.templateAttrs); // *ngIf / *ngFor microsyntax
            walkAll(node.variables); // let-… on ng-template
            walkAll(node.item ? [node.item] : undefined);
            walkAll(node.children);
            walkAll(node.branches);
            walkAll(node.cases);
            walkAll(node.groups);
            walk(node.empty);
            return;
        }
        // Attribute / input / output / reference / variable: the name is structural,
        // the value/handler is an expression (if any), static is a literal.
        if (typeof node.name === 'string') {
            emit(`${NG}@${node.name}`, node);
            if (node.value && typeof node.value === 'object') walkExpr(node.value, node);
            else if (typeof node.value === 'string' && node.value.length) emitLit(node.value, node);
            if (node.handler && typeof node.handler === 'object') walkExpr(node.handler, node);
            return;
        }
        // BoundText / interpolation (value is an AST expression)
        if (node.value && typeof node.value === 'object') {
            walkExpr(node.value, node);
            return;
        }
        // Static text
        if (typeof node.value === 'string') {
            if (node.value.trim().length) emit(NG_TEXT, node);
            return;
        }
    };
    for (const n of parsed.nodes) walk(n);

    return local.map((t) => remap(t, base.line, base.col));
}

/** Extract inline templates from `@Component({ template: \`...\` })`. */
export function extractAngularInlineTemplates(
    filePath: string,
    source: string
): { code: string; line: number; col: number }[] {
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result: { code: string; line: number; col: number }[] = [];

    const visit = (node: ts.Node) => {
        if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
            const callee = node.expression.expression;
            const name = ts.isIdentifier(callee) ? callee.text : '';
            const arg = node.expression.arguments[0];
            if (name === 'Component' && arg && ts.isObjectLiteralExpression(arg)) {
                for (const p of arg.properties) {
                    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name)) continue;
                    if (p.name.text !== 'template') continue;
                    const init = p.initializer;
                    if (ts.isStringLiteralLike(init)) {
                        // position of the first content char (after the quote/backtick)
                        const contentStart = init.getStart(sf) + 1;
                        const { line, character } = sf.getLineAndCharacterOfPosition(contentStart);
                        result.push({ code: init.text, line: line + 1, col: character + 1 });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return result;
}
