// angular.ts
// Расширение-токенайзер для Angular-шаблонов (внешние .html и inline @Component).
// Стоит поверх общего слоя из tokenizers.ts (optional/moduleResolveDirs/remap)
// и общего сентинела S из core.ts. Ядро (core.ts) про Angular ничего не знает.
import * as ts from 'typescript';
import { type RawToken, S } from './core';
import { DEFAULTS, moduleResolveDirs, optional, remap, type TokenizeOptions } from './tokenizers';

// Пространство имён токенов шаблонных выражений Angular. Префикс S гарантирует,
// что эти образы не пересекаются со script-токенами (никаких кросс-матчей .ts<->шаблон).
const NG = `${S}NG:`; // префикс для структурных маркеров/имён выражений
const NG_ID = `${S}NGID`; // нормализованный идентификатор шаблона (ignoreIdentifiers)
const NG_LIT = `${S}NGLIT`; // нормализованный литерал шаблона (ignoreLiterals)
const NG_TEXT = `${S}NGTEXT`; // статический текст шаблона

let warnedNg = false;

// --- Angular HTML-шаблон (внешний .html или inline) ---
// Токенайзер двух уровней: (1) структура — теги, имена атрибутов, статический
// текст; (2) выражения биндингов/интерполяций/блоков — обход AST @angular/compiler
// с той же нормализацией id/литералов, что и в script. Все образы S-префиксованы
// (см. NG/NG_ID/NG_LIT) => кросс-матчей со script-токенами нет.
// Позиции под-токенов выражения наследуются от объемлющего узла (хост): матчинг
// точный, гранулярность отчёта — на уровне строки биндинга (line-map не строим).
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
            console.warn('[cpd] Angular-шаблон пропущен: установите @angular/compiler');
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

    // Обход выражения биндинга. host — структурный узел, чьи координаты наследуем.
    const walkExpr = (ast: any, host: any) => {
        if (ast == null || typeof ast !== 'object') return;
        // ASTWithSource — обёртка; разворачиваем до фактического выражения.
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
                return; // корневой контекст компонента — токен не нужен
        }
    };

    const walk = (node: any) => {
        if (node == null) return;
        const walkAll = (items: unknown[] | undefined) => {
            for (const item of items ?? []) walk(item);
        };

        // Все коллекции биндингов узла (общие для Element и Template/ng-template).
        const walkBindings = (n: any) => {
            walkAll(n.attributes);
            walkAll(n.inputs);
            walkAll(n.outputs);
            walkAll(n.directives);
            walkAll(n.references);
        };

        // Element (есть имя тега + дети)
        if (typeof node.name === 'string' && Array.isArray(node.children)) {
            emit(`${NG}<${node.name}`, node);
            walkBindings(node);
            walkAll(node.children);
            return;
        }
        // Контейнеры: ng-template, control-flow блоки (@if/@for/@switch/@defer).
        // node.expression тянет и листовые блоки без детей (@case (…) -> SwitchBlockCase).
        if (
            Array.isArray(node.children) ||
            Array.isArray(node.branches) ||
            Array.isArray(node.cases) ||
            Array.isArray(node.groups) ||
            node.expression
        ) {
            if (typeof node.tagName === 'string') emit(`${NG}<${node.tagName}`, node);
            // Управляющие выражения блоков (@for of …; track …; @if/@case (…)).
            if (node.expression) {
                emit(`${NG}@expr`, node);
                walkExpr(node.expression, node);
            }
            if (node.trackBy) {
                emit(`${NG}@track`, node);
                walkExpr(node.trackBy, node);
            }
            walkBindings(node);
            walkAll(node.templateAttrs); // *ngIf / *ngFor микросинтаксис
            walkAll(node.variables); // let-… на ng-template
            walkAll(node.item ? [node.item] : undefined);
            walkAll(node.children);
            walkAll(node.branches);
            walkAll(node.cases);
            walkAll(node.groups);
            walk(node.empty);
            return;
        }
        // Атрибут / input / output / reference / variable: имя структурно,
        // значение/handler — выражение (если есть), статика — литерал.
        if (typeof node.name === 'string') {
            emit(`${NG}@${node.name}`, node);
            if (node.value && typeof node.value === 'object') walkExpr(node.value, node);
            else if (typeof node.value === 'string' && node.value.length) emitLit(node.value, node);
            if (node.handler && typeof node.handler === 'object') walkExpr(node.handler, node);
            return;
        }
        // BoundText / интерполяция (value это AST-выражение)
        if (node.value && typeof node.value === 'object') {
            walkExpr(node.value, node);
            return;
        }
        // Статический текст
        if (typeof node.value === 'string') {
            if (node.value.trim().length) emit(NG_TEXT, node);
            return;
        }
    };
    for (const n of parsed.nodes) walk(n);

    return local.map((t) => remap(t, base.line, base.col));
}

// --- Извлечение inline-шаблонов из @Component({ template: `...` }) ---
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
                        // позиция первого символа содержимого (после кавычки/бэктика)
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
