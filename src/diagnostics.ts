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
    SetNode,
    QueryStatement,
    NodeLocation,
    ColumnNode,
} from './parser';

import { ScopeBuilderResult } from './scopeBuilder';
import { SymbolKind } from './scope';

// ─── Core types ───────────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
    /** Rule identifier — used to suppress specific rules */
    code: DiagnosticCode;
    message: string;
    severity: DiagnosticSeverity;
    start: number;
    end: number;
}

export const enum DiagnosticCode {
    // Variable rules
    UndeclaredVariable = 'VAR001',
    UnusedVariable = 'VAR002',
    UnusedParameter = 'VAR003',
    VariableUsedBeforeSet = 'VAR004',

    // DML safety rules
    UpdateWithoutWhere = 'DML001',
    DeleteWithoutWhere = 'DML002',
    InsertWithoutColumnList = 'DML003',

    // SELECT rules
    SelectStar = 'SEL001',
    SelectStarInView = 'SEL002',

    // Duplicate declaration
    DuplicateVariable = 'DUP001',
    DuplicateCte = 'DUP002',
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DiagnosticEngine {
    private diagnostics: Diagnostic[] = [];

    run(program: Program, scopeResult: ScopeBuilderResult): Diagnostic[] {
        this.diagnostics = [];

        // Scope-based rules (require symbol table)
        this.checkUndeclaredVariables(scopeResult);
        this.checkUnusedSymbols(scopeResult);

        // AST-based rules (pure tree walk)
        for (const stmt of program.body) {
            this.visitStatement(stmt, false);
        }

        // Sort by position for clean LSP output
        return this.diagnostics.sort((a, b) => a.start - b.start);
    }

    // ── Scope-based rules ─────────────────────────────────────────────────────

    /**
     * VAR001: Variable referenced but never declared.
     * Excludes system variables (@@ROWCOUNT etc.) — those are filtered
     * upstream in ScopeBuilder.recordReference.
     */
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

    /**
     * VAR002: Variable declared but never referenced.
     * VAR003: Procedure/function parameter declared but never used.
     * Only fires on user variables (@x) and parameters, not on
     * table symbols, aliases, CTEs, or procedures.
     */
    private checkUnusedSymbols(result: ScopeBuilderResult): void {
        this.walkScopes(result.root, (scope) => {
            for (const symbol of scope.getOwnSymbols()) {
                if (symbol.references.length > 0) continue;

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

    // ── AST-based rules ───────────────────────────────────────────────────────

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

            default:
                break;
        }
    }

    private visitQuery(query: QueryStatement, insideView: boolean): void {
        if (query.type === 'SetOperator') {
            this.visitQuery(query.left, insideView);
            this.visitQuery(query.right, insideView);
            return;
        }
        this.checkSelect(query, insideView);
    }

    // ── DML001: UPDATE without WHERE ─────────────────────────────────────────

    /**
     * DML001: UPDATE with no WHERE clause will affect every row in the table.
     * Exempt: UPDATE with a FROM clause that filters via JOIN (common pattern),
     * but still warn because the WHERE-less form is a common mistake.
     */
    private checkUpdate(stmt: UpdateNode): void {
        if (!stmt.where) {
            this.emit({
                code: DiagnosticCode.UpdateWithoutWhere,
                message: `UPDATE statement has no WHERE clause — all rows will be affected`,
                severity: 'warning',
                start: stmt.start,
                end: stmt.start + 6, // Underline just "UPDATE"
            });
        }
    }

    // ── DML002: DELETE without WHERE ─────────────────────────────────────────

    private checkDelete(stmt: DeleteNode): void {
        if (!stmt.where) {
            this.emit({
                code: DiagnosticCode.DeleteWithoutWhere,
                message: `DELETE statement has no WHERE clause — all rows will be deleted`,
                severity: 'warning',
                start: stmt.start,
                end: stmt.start + 6, // Underline just "DELETE"
            });
        }
    }

    // ── DML003: INSERT without column list ───────────────────────────────────

    /**
     * DML003: INSERT INTO T VALUES (...) without specifying columns.
     * Breaks silently when table schema changes.
     */
    private checkInsert(stmt: InsertNode): void {
        if (stmt.values && stmt.values.length > 0 && !stmt.columns) {
            this.emit({
                code: DiagnosticCode.InsertWithoutColumnList,
                message: `INSERT statement does not specify a column list — this will break if the table schema changes`,
                severity: 'warning',
                start: stmt.start,
                end: stmt.start + 6, // Underline just "INSERT"
            });
        }
    }

    // ── SEL001/SEL002: SELECT * ──────────────────────────────────────────────

    /**
     * SEL001: SELECT * in a regular query — informational, not an error.
     * SEL002: SELECT * inside a CREATE VIEW — error, will break the view
     *         if the underlying table schema changes.
     */
    private checkSelect(stmt: SelectNode, insideView: boolean): void {
        // Check for SELECT * or SELECT table.*
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

        // Recurse into subqueries in FROM
        if (stmt.from) {
            for (const ref of stmt.from) {
                const table = ref.table as any;
                if (table?.type === 'SubqueryExpression') {
                    this.visitQuery(table.query, insideView);
                }
                for (const join of ref.joins) {
                    const jt = join.table as any;
                    if (jt?.type === 'SubqueryExpression') {
                        this.visitQuery(jt.query, insideView);
                    }
                }
            }
        }

        // Recurse into subqueries in WHERE / HAVING expressions
        if (stmt.where) this.visitExpression(stmt.where, insideView);
        if (stmt.having) this.visitExpression(stmt.having, insideView);
    }

    // ── DUP001/DUP002: Duplicate declarations ────────────────────────────────

    /**
     * DUP001: DECLARE @x INT; DECLARE @x VARCHAR — same variable declared twice.
     * DUP002: Two CTEs with the same name in a WITH clause.
     */

    private checkWith(stmt: WithNode): void {
        // Check for duplicate CTE names
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

            // IMPORTANT:
            // walk the CTE query body
            this.visitQuery(cte.query, false);
        }

        // walk statement after WITH
        this.visitStatement(stmt.body, false);
    }



    private checkCreate(stmt: CreateNode): void {
        const isView = stmt.objectType === 'VIEW';

        if (stmt.body) {
            if (Array.isArray(stmt.body)) {
                for (const s of stmt.body) {
                    this.visitStatement(s, isView);
                }
            } else {
                this.visitStatement(stmt.body, isView);
            }
        }
    }

    private checkIf(stmt: IfNode): void {
        this.visitBranch(stmt.thenBranch, false);
        if (stmt.elseBranch) this.visitBranch(stmt.elseBranch, false);
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
            for (const s of branch) this.visitStatement(s, insideView);
            return;
        }
        this.visitStatement(branch, insideView);
    }

    // ── Expression subquery recursion ─────────────────────────────────────────

    /**
     * Recurse into subquery expressions found inside WHERE/HAVING/IN
     * so that SELECT * inside a subquery is also caught.
     */
    private visitExpression(expr: Expression, insideView: boolean): void {
        if (!expr) return;
        switch (expr.type) {
            case 'SubqueryExpression':
                this.visitQuery(expr.query, insideView);
                break;
            case 'InExpression':
                if (expr.subquery) this.visitQuery(expr.subquery, insideView);
                break;
            case 'BinaryExpression':
                this.visitExpression(expr.left, insideView);
                this.visitExpression(expr.right, insideView);
                break;
            case 'UnaryExpression':
                this.visitExpression(expr.right, insideView);
                break;
            case 'CaseExpression':
                if (expr.input) this.visitExpression(expr.input, insideView);
                for (const b of expr.branches) {
                    this.visitExpression(b.when, insideView);
                    this.visitExpression(b.then, insideView);
                }
                if (expr.elseBranch) this.visitExpression(expr.elseBranch, insideView);
                break;
            case 'FunctionCall':
                for (const arg of expr.args) {
                    this.visitExpression(arg, insideView);
                }
                break;
            default:
                break;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private isWildcard(col: ColumnNode): boolean {
        // SELECT * — expression is an Operator with value '*'
        if ((col.expression as any).type === 'Operator') return true;
        if (col.name === '*') return true;

        // Identifier with name '*'
        const expr = col.expression as any;
        if (expr?.type === 'Identifier' && expr?.name === '*') return true;

        // MemberExpression: table.*
        if (expr?.type === 'MemberExpression' && expr?.property === '*') return true;

        return false;
    }

    private walkScopes(
        scope: import('./scope').Scope,
        visitor: (scope: import('./scope').Scope) => void
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

// ─── Convenience function ────────────────────────────────────────────────────

/**
 * Single entry point for the LSP layer.
 * Returns all diagnostics sorted by position.
 */
export function diagnose(
    program: Program,
    scopeResult: ScopeBuilderResult
): Diagnostic[] {
    return new DiagnosticEngine().run(program, scopeResult);
}