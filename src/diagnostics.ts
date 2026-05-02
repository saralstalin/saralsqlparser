import {
    Program,
    Statement,
    Expression,
    SelectNode,
    UpdateNode,
    DeleteNode,
    InsertNode,
    WithNode,
    IfNode,
    BlockNode,
    CreateNode,
    QueryStatement,
    NodeLocation,
    ColumnNode,
} from './parser';

import { ScopeBuilderResult } from './scopeBuilder';
import { SymbolKind, Scope } from './scope';

// ─── Core types ───────────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
    code: DiagnosticCode;
    message: string;
    severity: DiagnosticSeverity;
    start: number;
    end: number;
}

export const enum DiagnosticCode {
    UndeclaredVariable = 'VAR001',
    UnusedVariable = 'VAR002',
    UnusedParameter = 'VAR003',
    VariableUsedBeforeSet = 'VAR004',

    UpdateWithoutWhere = 'DML001',
    DeleteWithoutWhere = 'DML002',
    InsertWithoutColumnList = 'DML003',

    SelectStar = 'SEL001',
    SelectStarInView = 'SEL002',

    DuplicateVariable = 'DUP001',
    DuplicateCte = 'DUP002',
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DiagnosticEngine {
    private diagnostics: Diagnostic[] = [];

    run(program: Program, scopeResult: ScopeBuilderResult): Diagnostic[] {
        this.diagnostics = [];

        this.checkUndeclaredVariables(scopeResult);
        this.checkUnusedSymbols(scopeResult);

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

    private checkUnusedSymbols(result: ScopeBuilderResult): void {
        this.walkScopes(result.root, (scope) => {
            for (const symbol of scope.getOwnSymbols()) {

                const readRefs = symbol.references.filter(
                    r => r.kind === 'read'
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

            case 'CreateStatement':
                this.checkCreate(stmt);
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

        if (!stmt.where) {
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

        if (!stmt.where) {
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

            this.visitQuery(cte.query, false);
        }

        this.visitStatement(stmt.body, false);
    }

    private checkCreate(stmt: CreateNode): void {
        const isView = stmt.objectType === 'VIEW';

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
            case 'Identifier':
            case 'Variable':
                break;
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
}

// ─── Convenience ──────────────────────────────────────────────────────────────

export function diagnose(
    program: Program,
    scopeResult: ScopeBuilderResult
): Diagnostic[] {
    return new DiagnosticEngine().run(program, scopeResult);
}