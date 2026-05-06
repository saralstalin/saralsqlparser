import { ASTNode } from './ast/types';
import { findNodeAt } from './ast/astWalker';
import { analyze, AnalysisDiagnostic } from './analyze';
import { offsetToPosition, Position, positionToOffset } from './position';
import { Scope, Symbol, SymbolKind } from './semantic/scope';

export type CompletionItemKind =
    | 'keyword'
    | 'variable'
    | 'table'
    | 'column'
    | 'alias'
    | 'function'
    | 'procedure'
    | 'type'
    | 'cte'
    | 'text';

export interface CompletionContext {
    offset: number;
    position: Position;
    prefix: string;
    node: ASTNode | null;
    scope: Scope;
    visibleSymbols: Symbol[];
    diagnostics: AnalysisDiagnostic[];
    keywords: string[];
}

export interface CompletionItem {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    start: number;
    end: number;
}

const KEYWORDS = [
    'SELECT',
    'FROM',
    'WHERE',
    'JOIN',
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'CROSS',
    'APPLY',
    'ON',
    'GROUP',
    'BY',
    'HAVING',
    'ORDER',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DECLARE',
    'SET',
    'CREATE',
    'TABLE',
    'VIEW',
    'PROCEDURE',
    'FUNCTION',
    'WITH',
    'AS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'AND',
    'OR',
    'NOT',
    'NULL',
    'IN',
    'BETWEEN',
    'LIKE',
    'EXISTS',
    'UNION',
    'EXCEPT',
    'INTERSECT'
];

export function getCompletionContext(
    sql: string,
    positionOrOffset: Position | number
): CompletionContext {
    const offset =
        typeof positionOrOffset === 'number'
            ? clamp(positionOrOffset, 0, sql.length)
            : positionToOffset(sql, positionOrOffset);

    const position =
        typeof positionOrOffset === 'number'
            ? offsetToPosition(sql, offset)
            : positionOrOffset;

    const result = analyze(sql);
    const scope = result.scope.root.findInnermost(offset);
    const prefix = getPrefix(sql, offset);

    return {
        offset,
        position,
        prefix,
        node: findNodeAt(result.ast, offset),
        scope,
        visibleSymbols: scope.getVisibleSymbols(),
        diagnostics: result.diagnostics,
        keywords: KEYWORDS
    };
}

export function getCompletionsAt(
    sql: string,
    positionOrOffset: Position | number
): CompletionItem[] {
    const context = getCompletionContext(sql, positionOrOffset);
    const replaceStart = context.offset - context.prefix.length;
    const seen = new Set<string>();
    const items: CompletionItem[] = [];

    for (const keyword of context.keywords) {
        pushCompletion(items, seen, {
            label: keyword,
            kind: 'keyword',
            start: replaceStart,
            end: context.offset
        }, context.prefix);
    }

    for (const symbol of context.visibleSymbols) {
        pushCompletion(items, seen, {
            label: symbol.name,
            kind: symbolKindToCompletionKind(symbol.kind),
            detail: symbol.dataType ?? symbol.kind,
            start: replaceStart,
            end: context.offset
        }, context.prefix);
    }

    return items.sort((a, b) => {
        if (a.kind === b.kind) return a.label.localeCompare(b.label);
        if (a.kind === 'keyword') return 1;
        if (b.kind === 'keyword') return -1;
        return a.kind.localeCompare(b.kind);
    });
}

function pushCompletion(
    items: CompletionItem[],
    seen: Set<string>,
    item: CompletionItem,
    prefix: string
): void {
    if (
        prefix &&
        !item.label.toLowerCase().startsWith(prefix.toLowerCase())
    ) {
        return;
    }

    const key = `${item.kind}:${item.label.toLowerCase()}`;
    if (seen.has(key)) return;

    seen.add(key);
    items.push(item);
}

function symbolKindToCompletionKind(kind: SymbolKind): CompletionItemKind {
    switch (kind) {
        case SymbolKind.Variable:
        case SymbolKind.Parameter:
            return 'variable';
        case SymbolKind.Table:
        case SymbolKind.TempTable:
            return 'table';
        case SymbolKind.Column:
            return 'column';
        case SymbolKind.Alias:
            return 'alias';
        case SymbolKind.CTE:
            return 'cte';
        case SymbolKind.Function:
            return 'function';
        case SymbolKind.Procedure:
            return 'procedure';
        case SymbolKind.Type:
            return 'type';
        default:
            return 'text';
    }
}

function getPrefix(sql: string, offset: number): string {
    let start = offset;

    while (start > 0 && /[a-zA-Z0-9_@#\[\].]/.test(sql[start - 1])) {
        start--;
    }

    return sql.slice(start, offset);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
