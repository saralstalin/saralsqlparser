import {
    Program,
    Statement,
    Expression,
    SelectNode,
    UpdateNode,
    DeleteNode,
    InsertNode,
    MergeNode,
    WithNode,
    IfNode,
    BlockNode,
    CreateNode,
    AlterTableNode,
    QueryStatement,
    NodeLocation,
    ColumnNode,
    IdentifierNode,
} from '../ast/types';

import { ScopeBuilderResult, DuplicateDeclaration } from '../semantic/scopeBuilder';
import { SymbolKind, Scope } from '../semantic/scope';

// ─── Core types ───────────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
    code: DiagnosticCode;
    message: string;
    severity: DiagnosticSeverity;
    start: number;
    end: number;
}

export enum DiagnosticCode {
    UndeclaredVariable = 'VAR001',
    UnusedVariable = 'VAR002',
    UnusedParameter = 'VAR003',
    VariableUsedBeforeSet = 'VAR004',
    UnknownColumn = 'COL001',
    UnbracketedKeywordColumnName = 'NAM001',

    MissingCommaBeforeTableConstraint = 'DDL001',

    UpdateWithoutWhere = 'DML001',
    DeleteWithoutWhere = 'DML002',
    InsertWithoutColumnList = 'DML003',
    UpdateTargetNoLock = 'DML004',
    JoinHintUsage = 'JOIN001',
    CursorUsage = 'CUR001',

    SelectStar = 'SEL001',
    SelectStarInView = 'SEL002',
    SelfComparison = 'LOG001',

    DuplicateVariable = 'DUP001',
    DuplicateCte = 'DUP002',
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DiagnosticEngine {
    private diagnostics: Diagnostic[] = [];
    private rootScope: Scope | null = null;
    private static readonly KEYWORD_COLUMN_NAMES = new Set([
        'ADD', 'ALL', 'ALTER', 'AND', 'APPLY', 'AS', 'ASC',
        'BEGIN', 'BETWEEN', 'BREAK', 'BY',
        'CASE', 'CATCH', 'CHECK', 'CLOSE', 'COLUMN', 'COMMIT', 'CONSTRAINT', 'CONTINUE', 'CREATE', 'CROSS', 'CURSOR',
        'DEALLOCATE', 'DECLARE', 'DEFAULT', 'DELETE', 'DELAY', 'DESC', 'DISTINCT', 'DROP',
        'ELSE', 'END', 'EXCEPT', 'EXEC', 'EXECUTE', 'EXISTS',
        'FETCH', 'FOR', 'FOREIGN', 'FROM', 'FULL', 'FUNCTION',
        'GO', 'GOTO', 'GROUP',
        'HAVING',
        'IDENTITY', 'IF', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTERSECT', 'INTO', 'IS',
        'JOIN',
        'KEY',
        'LEFT', 'LIKE', 'LOOP',
        'MATCHED', 'MERGE',
        'NEXT', 'NOT', 'NULL',
        'OFFSET', 'ON', 'ONLY', 'OPEN', 'OPTION', 'OR', 'ORDER', 'OUT', 'OUTER', 'OUTPUT', 'OVER',
        'PARTITION', 'PERCENT', 'PIVOT', 'PRECEDING', 'PRIMARY', 'PRINT', 'PROCEDURE',
        'RAISERROR', 'RANGE', 'READONLY', 'REFERENCES', 'RETURN', 'RIGHT', 'ROLLBACK', 'ROW', 'ROWS',
        'SAVE', 'SELECT', 'SEMICOLON', 'SET',
        'TABLE', 'TARGET', 'THEN', 'THROW', 'TIES', 'TOP', 'TRAN', 'TRANSACTION', 'TRUNCATE', 'TRY',
        'UNBOUNDED', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE', 'USING',
        'VALUES', 'VIEW',
        'WAITFOR', 'WHEN', 'WHERE', 'WHILE', 'WITH', 'WITHIN'
    ]);

    run(program: Program, scopeResult: ScopeBuilderResult): Diagnostic[] {
        this.diagnostics = [];
        this.rootScope = scopeResult.root;

        this.checkUndeclaredVariables(scopeResult);
        this.checkUnusedSymbols(scopeResult);
        this.checkDuplicateDeclarations(scopeResult);

        for (const stmt of program.body) {
            this.visitStatement(stmt, false);
        }

        return this.diagnostics.sort((a, b) => a.start - b.start);
    }

    // ── Scope rules ───────────────────────────────────────────────────────────

    private checkUndeclaredVariables(result: ScopeBuilderResult): void {
        for (const ref of result.undeclared) {
            this.emit({
                code: DiagnosticCode.UndeclaredVariable,
                message: `Variable is not declared`,
                severity: 'error',
                start: ref.location.start,
                end: ref.location.end,
            });
        }
    }

    private checkDuplicateDeclarations(result: ScopeBuilderResult): void {
        for (const dup of result.duplicates) {
            if (dup.scopeName === 'with') continue; // WITH clause duplicates are already reported by the CheckWith method
            this.emit({
                code: DiagnosticCode.DuplicateVariable,
                message: `'${dup.name}' is already declared in this scope`,
                severity: 'error',
                start: dup.duplicate.start,
                end: dup.duplicate.end,
            });
        }
    }

    private checkUnusedSymbols(result: ScopeBuilderResult): void {
        this.walkScopes(result.root, (scope) => {
            for (const symbol of scope.getOwnSymbols()) {

                const readRefs = symbol.references.filter(
                    r => r.kind === 'read'
                );
                const writeRefs = symbol.references.filter(
                    r => r.kind === 'write'
                );

                if (readRefs.length > 0) continue;

                if (symbol.kind === SymbolKind.Variable) {
                    this.emit({
                        code: DiagnosticCode.UnusedVariable,
                        message: `Variable '${symbol.name}' is declared but never used`,
                        severity: 'warning',
                        start: symbol.location.start,
                        end: symbol.location.end,
                    });
                }

                if (symbol.kind === SymbolKind.Parameter) {
                    const isOutputParameter =
                        symbol.metadata?.isOutput === true;

                    if (isOutputParameter && writeRefs.length > 0) {
                        continue;
                    }

                    this.emit({
                        code: DiagnosticCode.UnusedParameter,
                        message: `Parameter '${symbol.name}' is declared but never used`,
                        severity: 'warning',
                        start: symbol.location.start,
                        end: symbol.location.end,
                    });
                }
            }
        });
    }

    // ── Statement traversal ───────────────────────────────────────────────────

    private visitStatement(stmt: Statement, insideView: boolean): void {
        switch (stmt.type) {
            case 'SelectStatement':
                this.checkSelect(stmt, insideView);
                break;

            case 'UpdateStatement':
                this.checkUpdate(stmt);
                break;

            case 'DeleteStatement':
                this.checkDelete(stmt);
                break;

            case 'InsertStatement':
                this.checkInsert(stmt);
                break;

            case 'MergeStatement':
                this.checkMerge(stmt);
                break;

            case 'CreateStatement':
                this.checkCreate(stmt);
                break;

            case 'AlterTableStatement':
                this.checkAlterTable(stmt);
                break;

            case 'WithStatement':
                this.checkWith(stmt);
                break;

            case 'IfStatement':
                this.checkIf(stmt);
                break;

            case 'BlockStatement':
                this.checkBlock(stmt);
                break;

            case 'DeclareCursorStatement':
                this.emit({
                    code: DiagnosticCode.CursorUsage,
                    message: `Cursor usage can be slow and hard to maintain; prefer set-based logic when possible`,
                    severity: 'warning',
                    start: stmt.start,
                    end: stmt.end,
                });
                break;

            case 'SetOperator':
                this.visitQuery(stmt, insideView);
                break;
        }
    }

    private visitQuery(
        query: QueryStatement | null,
        insideView: boolean
    ): void {
        if (!query) {
            return;
        }

        if (query.type === 'SetOperator') {
            this.visitQuery(query.left, insideView);

            if (query.right) {
                this.visitQuery(query.right, insideView);
            }

            return;
        }

        this.checkSelect(query, insideView);
    }

    // ── DML rules ─────────────────────────────────────────────────────────────

    private checkUpdate(stmt: UpdateNode): void {
        if (stmt.incomplete) return;

        if (this.updateTargetHasNoLockHint(stmt)) {
            this.emit({
                code: DiagnosticCode.UpdateTargetNoLock,
                message: `UPDATE target table must not use WITH (NOLOCK)`,
                severity: 'error',
                start: stmt.start,
                end: stmt.end,
            });
        }

        if (!stmt.where && !this.hasJoinedFromClause(stmt.from)) {
            this.emit({
                code: DiagnosticCode.UpdateWithoutWhere,
                message: `UPDATE statement has no WHERE clause — all rows will be affected`,
                severity: 'warning',
                start: stmt.start,
                end: stmt.start + 6,
            });
        }
    }

    private checkDelete(stmt: DeleteNode): void {
        if (stmt.incomplete) return;

        if (!stmt.where && !this.hasJoinedFromClause(stmt.from)) {
            this.emit({
                code: DiagnosticCode.DeleteWithoutWhere,
                message: `DELETE statement has no WHERE clause — all rows will be deleted`,
                severity: 'warning',
                start: stmt.start,
                end: stmt.start + 6,
            });
        }
    }

    private checkInsert(stmt: InsertNode): void {
        const hasValuesClause =
            stmt.values !== null;

        if (
            hasValuesClause &&
            !stmt.columns
        ) {
            this.emit({
                code: DiagnosticCode.InsertWithoutColumnList,
                message:
                    `INSERT statement does not specify a column list — ` +
                    `this will break if the table schema changes`,
                severity: 'warning',
                start: stmt.start,
                end: stmt.start + 6,
            });
        }

        for (const columnNode of stmt.columnNodes ?? []) {
            this.checkIdentifierColumnName(columnNode);
        }

        for (const columnNode of stmt.output?.intoColumnNodes ?? []) {
            this.checkIdentifierColumnName(columnNode);
        }

        if (stmt.selectQuery) {
            this.visitQuery(stmt.selectQuery, false);
        }
    }

    private checkMerge(stmt: MergeNode): void {
        if (stmt.incomplete) return;

        for (const clause of stmt.whenClauses) {
            if (
                clause.action.type === 'MergeInsertAction' &&
                clause.action.values &&
                !clause.action.columns
            ) {
                this.emit({
                    code: DiagnosticCode.InsertWithoutColumnList,
                    message:
                        `MERGE INSERT action does not specify a column list — ` +
                        `this will break if the target table schema changes`,
                    severity: 'warning',
                    start: clause.action.start,
                    end: clause.action.end,
                });
            }
        }
    }

    // ── SELECT rules ──────────────────────────────────────────────────────────

    private checkSelect(stmt: SelectNode, insideView: boolean): void {
        for (const col of stmt.columns) {
            if (this.isWildcard(col)) {
                if (insideView) {
                    this.emit({
                        code: DiagnosticCode.SelectStarInView,
                        message: `SELECT * inside a view will break if the underlying table schema changes`,
                        severity: 'error',
                        start: col.start,
                        end: col.end,
                    });
                } else {
                    this.emit({
                        code: DiagnosticCode.SelectStar,
                        message: `SELECT * is not recommended — list columns explicitly`,
                        severity: 'info',
                        start: col.start,
                        end: col.end,
                    });
                }
            }

            this.visitExpression(col.expression, insideView);
        }

        // FROM / JOIN recursion
        if (stmt.from) {
            for (const ref of stmt.from) {
                const table = ref.table;

                if (table?.type === 'SubqueryExpression') {
                    this.visitQuery(table.query, insideView);
                } else if (table) {
                    this.visitExpression(table, insideView);
                }

                for (const join of ref.joins) {
                    if (join.joinHint) {
                        this.emit({
                            code: DiagnosticCode.JoinHintUsage,
                            message: `${join.joinHint} JOIN hint can reduce optimizer flexibility; review whether it is really needed`,
                            severity: 'warning',
                            start: join.start,
                            end: join.end,
                        });
                    }

                    const jt = join.table;

                    if (jt?.type === 'SubqueryExpression') {
                        this.visitQuery(jt.query, insideView);
                    } else if (jt) {
                        this.visitExpression(jt, insideView);
                    }

                    if (join.on) {
                        this.visitExpression(join.on, insideView);
                    }
                }
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where, insideView);
        }

        if (stmt.having) {
            this.visitExpression(stmt.having, insideView);
        }

        if (stmt.groupBy) {
            for (const expr of stmt.groupBy) {
                this.visitExpression(expr, insideView);
            }
        }

        if (stmt.orderBy) {
            for (const order of stmt.orderBy) {
                this.visitExpression(order.expression, insideView);
            }
        }
    }

    // ── WITH / CREATE / IF / BLOCK ───────────────────────────────────────────

    private checkWith(stmt: WithNode): void {
        const seen = new Map<string, NodeLocation>();

        for (const cte of stmt.ctes) {
            const key = cte.name.toLowerCase();

            if (seen.has(key)) {
                this.emit({
                    code: DiagnosticCode.DuplicateCte,
                    message: `CTE '${cte.name}' is defined more than once in this WITH clause`,
                    severity: 'error',
                    start: cte.start,
                    end: cte.end,
                });
            } else {
                seen.set(key, cte);
            }

            for (const columnName of cte.columns ?? []) {
                this.checkColumnNameText(
                    columnName,
                    cte.start,
                    cte.end
                );
            }

            this.visitQuery(cte.query, false);
        }

        this.visitStatement(stmt.body, false);
    }

    private checkCreate(stmt: CreateNode): void {
        const isView = stmt.objectType === 'VIEW';

        if (stmt.objectType === 'TABLE' && stmt.constraints?.length) {
            for (const constraint of stmt.constraints) {
                if (constraint.missingLeadingComma) {
                    this.emit({
                        code: DiagnosticCode.MissingCommaBeforeTableConstraint,
                        message: `Table-level constraint is missing a preceding comma`,
                        severity: 'warning',
                        start: constraint.start,
                        end: constraint.end,
                    });
                }
            }
        }

        for (const column of stmt.columns ?? []) {
            this.checkColumnNameText(
                column.name,
                column.start,
                column.start + column.name.length
            );
        }

        if (!stmt.body) return;

        if (Array.isArray(stmt.body)) {
            for (const s of stmt.body) {
                this.visitStatement(s, isView);
            }
        } else {
            this.visitStatement(stmt.body, isView);
        }
    }

    private checkIf(stmt: IfNode): void {
        this.visitBranch(stmt.thenBranch, false);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch, false);
        }
    }

    private checkBlock(stmt: BlockNode): void {
        for (const s of stmt.body) {
            this.visitStatement(s, false);
        }
    }

    private visitBranch(
        branch: Statement | Statement[],
        insideView: boolean
    ): void {
        if (Array.isArray(branch)) {
            for (const s of branch) {
                this.visitStatement(s, insideView);
            }
            return;
        }

        this.visitStatement(branch, insideView);
    }

    // ── Expression traversal ──────────────────────────────────────────────────

    private visitExpression(
        expr: Expression | null | undefined,
        insideView: boolean
    ): void {
        if (!expr) return;

        switch (expr.type) {
            case 'WildcardExpression':
                break;
            case 'SubqueryExpression':
                this.visitQuery(expr.query, insideView);
                break;
            case 'ValuesTableExpression':
                for (const row of expr.rows) {
                    for (const value of row) {
                        this.visitExpression(value, insideView);
                    }
                }
                break;

            case 'InExpression':
                this.visitExpression(expr.left, insideView);

                if (expr.list) {
                    for (const item of expr.list) {
                        this.visitExpression(item, insideView);
                    }
                }

                if (expr.subquery) {
                    this.visitQuery(expr.subquery, insideView);
                }
                break;

            case 'BinaryExpression':
                this.checkBinaryExpression(expr);
                this.visitExpression(expr.left, insideView);
                this.visitExpression(expr.right, insideView);
                break;

            case 'UnaryExpression':
                this.visitExpression(expr.right, insideView);
                break;

            case 'GroupingExpression':
                this.visitExpression(expr.expression, insideView);
                break;

            case 'BetweenExpression':
                this.visitExpression(expr.left, insideView);
                this.visitExpression(expr.lowerBound, insideView);
                this.visitExpression(expr.upperBound, insideView);
                break;

            case 'CaseExpression':
                if (expr.input) {
                    this.visitExpression(expr.input, insideView);
                }

                for (const b of expr.branches) {
                    this.visitExpression(b.when, insideView);
                    this.visitExpression(b.then, insideView);
                }

                if (expr.elseBranch) {
                    this.visitExpression(expr.elseBranch, insideView);
                }
                break;

            case 'FunctionCall':
                for (const arg of expr.args) {
                    this.visitExpression(arg, insideView);
                }
                break;

            case 'OverExpression':
                this.visitExpression(expr.expression, insideView);

                if (expr.window.partitionBy) {
                    for (const p of expr.window.partitionBy) {
                        this.visitExpression(p, insideView);
                    }
                }

                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.visitExpression(o.expression, insideView);
                    }
                }
                break;

            case 'MemberExpression':
                this.visitExpression(expr.object, insideView);
                break;

            case 'Literal':
            case 'Variable':
                break;

            case 'Identifier':
                this.checkQualifiedIdentifierColumn(expr);
                break;
        }
    }

    private checkAlterTable(stmt: AlterTableNode): void {
        if (
            stmt.action?.kind === 'ADD_COLUMN' ||
            stmt.action?.kind === 'ALTER_COLUMN'
        ) {
            const column = stmt.action.column;

            this.checkColumnNameText(
                column.name,
                column.start,
                column.start + column.name.length
            );
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private isWildcard(col: ColumnNode): boolean {
        const expr = col.expression;

        // Check for the new dedicated node type (e.g., SELECT *)
        if (expr.type === 'WildcardExpression') {
            return true;
        }

        // Check for table wildcards (e.g., SELECT u.*)
        // If your parser still produces MemberExpression for these, keep this check:
        if (expr.type === 'MemberExpression' && expr.property === '*') {
            return true;
        }

        // Fallback for legacy Identifier nodes with '*' name
        if (expr.type === 'Identifier' && expr.name === '*') {
            return true;
        }

        return false;
    }

    private updateTargetHasNoLockHint(stmt: UpdateNode): boolean {
        if (!stmt.target || stmt.target.type !== 'Identifier' || !stmt.from) {
            return false;
        }

        const targetName = stmt.target.name.toLowerCase();

        for (const ref of stmt.from) {
            const hints = ref.hints ?? [];

            if (!hints.some(h => h.toUpperCase() === 'NOLOCK')) {
                continue;
            }

            if (ref.alias && ref.alias.toLowerCase() === targetName) {
                return true;
            }

            if (
                ref.table &&
                ref.table.type === 'Identifier' &&
                ref.table.name.toLowerCase() === targetName
            ) {
                return true;
            }
        }

        return false;
    }

    private checkBinaryExpression(expr: Extract<Expression, { type: 'BinaryExpression' }>): void {
        this.checkSelfComparison(expr);
    }

    private checkSelfComparison(expr: Extract<Expression, { type: 'BinaryExpression' }>): void {
        if (!expr.right) {
            return;
        }

        if (!['=', '<>', '!=', '<', '>', '<=', '>='].includes(expr.operator)) {
            return;
        }

        const leftRef = this.getComparableReferenceName(expr.left);
        const rightRef = this.getComparableReferenceName(expr.right);

        if (!leftRef || !rightRef) {
            return;
        }

        if (leftRef.toLowerCase() !== rightRef.toLowerCase()) {
            return;
        }

        this.emit({
            code: DiagnosticCode.SelfComparison,
            message: `Condition compares '${leftRef}' to itself`,
            severity: 'warning',
            start: expr.start,
            end: expr.end,
        });
    }

    private getComparableReferenceName(expr: Expression): string | null {
        switch (expr.type) {
            case 'Identifier':
                return expr.name;
            case 'Variable':
                return expr.name;
            default:
                return null;
        }
    }

    private checkQualifiedIdentifierColumn(expr: Extract<Expression, { type: 'Identifier' }>): void {
        if (expr.parts.length < 2 || !this.rootScope) {
            return;
        }

        const qualifier = expr.parts[0];
        const columnName = expr.parts[expr.parts.length - 1];
        const columns = this.getKnownColumnsForQualifier(qualifier, expr.start);

        if (!columns?.length) {
            return;
        }

        const normalizedTarget = this.normalizeColumnName(columnName);
        const exists = columns.some(col =>
            this.normalizeColumnName(col) === normalizedTarget
        );

        if (exists) {
            return;
        }

        this.emit({
            code: DiagnosticCode.UnknownColumn,
            message: `Unknown column '${columnName}' on '${qualifier}'`,
            severity: 'warning',
            start: expr.start,
            end: expr.end,
        });
    }

    private getKnownColumnsForQualifier(name: string, offset: number): string[] | null {
        if (!this.rootScope) {
            return null;
        }

        const scope = this.rootScope.findInnermost(offset);
        const symbol = scope.resolve(name);

        if (!symbol) {
            return null;
        }

        if (symbol.columns && symbol.columns.length > 0) {
            return symbol.columns;
        }

        if (
            symbol.kind === SymbolKind.Alias &&
            symbol.metadata?.tableName &&
            typeof symbol.metadata.tableName === 'string'
        ) {
            const tableSymbol = scope.resolve(symbol.metadata.tableName);
            if (tableSymbol?.columns && tableSymbol.columns.length > 0) {
                return tableSymbol.columns;
            }
        }

        return null;
    }

    private hasJoinedFromClause(
        from: SelectNode['from'] | UpdateNode['from'] | DeleteNode['from'] | undefined
    ): boolean {
        if (!from?.length) {
            return false;
        }

        return from.some(ref => ref.joins.length > 0);
    }

    private normalizeColumnName(name: string): string {
        return name
            .trim()
            .replace(/^\[(.*)\]$/, '$1')
            .toLowerCase();
    }

    private walkScopes(
        scope: Scope,
        visitor: (scope: Scope) => void
    ): void {
        visitor(scope);

        for (const child of scope.getChildren()) {
            this.walkScopes(child, visitor);
        }
    }

    private emit(diagnostic: Diagnostic): void {
        this.diagnostics.push(diagnostic);
    }

    private checkIdentifierColumnName(node: IdentifierNode): void {
        this.checkColumnNameText(
            node.name,
            node.start,
            node.end
        );
    }

    private checkColumnNameText(
        name: string,
        start: number,
        end: number
    ): void {
        if (
            !name ||
            name.startsWith('[') ||
            name.includes('.')
        ) {
            return;
        }

        const normalized = name.toUpperCase();

        if (
            DiagnosticEngine.KEYWORD_COLUMN_NAMES.has(normalized)
        ) {
            this.emit({
                code: DiagnosticCode.UnbracketedKeywordColumnName,
                message: `Column name '${normalized}' matches a SQL keyword; bracket it to avoid ambiguity`,
                severity: 'warning',
                start,
                end,
            });
        }
    }
}

// ─── Convenience ──────────────────────────────────────────────────────────────

export function diagnose(
    program: Program,
    scopeResult: ScopeBuilderResult
): Diagnostic[] {
    return new DiagnosticEngine().run(program, scopeResult);
}
