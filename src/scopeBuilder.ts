import {
    Program,
    Statement,
    Expression,
    DeclareNode,
    CreateNode,
    WithNode,
    BlockNode,
    IfNode,
    SelectNode,
    UpdateNode,
    DeleteNode,
    InsertNode,
    SetNode,
    PrintNode,
    SetOperatorNode,
    QueryStatement,
    TableReference,
    JoinNode,
    NodeLocation,
    SubqueryExpression,
} from './parser';

import { Scope, Symbol, SymbolKind, SymbolReference } from './scope';

// ─── Result ──────────────────────────────────────────────────────────────────

export interface ScopeBuilderResult {
    /** The root of the scope tree (one root per build call). */
    root: Scope;

    /**
     * Every variable reference found in the AST, whether resolved or not.
     * Key is the lowercased symbol name (e.g. "@id").
     */
    references: Map<string, SymbolReference[]>;

    /**
     * Variable nodes that could not be resolved to any declaration.
     * Used directly to produce "undeclared variable" diagnostics.
     */
    undeclared: SymbolReference[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export class ScopeBuilder {
    private root!: Scope;
    private current!: Scope;

    // Collected across the whole build pass
    private references = new Map<string, SymbolReference[]>();
    private undeclared: SymbolReference[] = [];

    // ── Public entry point ────────────────────────────────────────────────────

    build(program: Program): ScopeBuilderResult {
        // Reset state so the builder is reusable
        this.references = new Map();
        this.undeclared = [];

        // NOTE: GO batch separators are consumed by the parser and not
        // modelled in the AST, so the entire script shares one root scope.
        //
        // Real T-SQL scoping across GO:
        //   DECLARE @x INT
        //   GO
        //   SELECT @x   -- invalid in SQL Server
        //
        // @x would still resolve here until BatchNode[] is introduced
        // in Program and each batch gets its own Scope.
        this.root = new Scope(0, Number.MAX_SAFE_INTEGER, null, 'root');
        this.current = this.root;

        for (const stmt of program.body) {
            this.visitStatement(stmt);
        }

        return {
            root: this.root,
            references: this.references,
            undeclared: this.undeclared,
        };
    }

    // ── Scope stack ───────────────────────────────────────────────────────────

    private pushScope(start: number, end: number, name?: string): void {
        const child = new Scope(start, end, this.current, name);
        this.current = child;
    }
    

    private popScope(): void {
        if (this.current.parent) {
            this.current = this.current.parent;
        }
    }

    private declare(symbol: Symbol): void {
        const existing = this.current.define(symbol);

        if (existing) {
            // Keep first declaration; ignore duplicate overwrite.
            // Diagnostics engine can surface DUP001 / DUP002 later.
            //
            // Optional future:
            // this.duplicates.push({
            //     name: symbol.name,
            //     original: existing.location,
            //     duplicate: symbol.location
            // });
        }
    }



    // ── Reference recording ───────────────────────────────────────────────────

    /**
     * Records that a variable name was used at the given location.
     * Resolves upward through the scope chain.
     * If not found, adds to the undeclared list.
     */
    private recordReference(name: string, location: NodeLocation): void {
        // System variables (@@ROWCOUNT, @@ERROR, @@IDENTITY …) are always valid
        if (name.startsWith('@@')) return;

        const ref: SymbolReference = { location };

        // Track in flat reference map for diagnostics
        const key = name.toLowerCase();
        if (!this.references.has(key)) {
            this.references.set(key, []);
        }
        this.references.get(key)!.push(ref);

        // Resolve through scope chain and attach reference
        const symbol = this.current.resolve(name);
        if (symbol) {
            symbol.references.push(ref);
        } else {
            this.undeclared.push(ref);
        }
    }

    // ── Statement visitor ─────────────────────────────────────────────────────

    private visitStatement(stmt: Statement): void {
        switch (stmt.type) {
            case 'DeclareStatement':
                this.visitDeclare(stmt);
                break;

            case 'CreateStatement':
                this.visitCreate(stmt);
                break;

            case 'WithStatement':
                this.visitWith(stmt);
                break;

            case 'BlockStatement':
                this.visitBlock(stmt);
                break;

            case 'IfStatement':
                this.visitIf(stmt);
                break;

            case 'SelectStatement':
                this.visitSelect(stmt);
                break;

            case 'SetOperator':
                this.visitQuery(stmt);
                break;

            case 'UpdateStatement':
                this.visitUpdate(stmt);
                break;

            case 'DeleteStatement':
                this.visitDelete(stmt);
                break;

            case 'InsertStatement':
                this.visitInsert(stmt);
                break;

            case 'SetStatement':
                this.visitSet(stmt);
                break;

            case 'PrintStatement':
                this.visitPrint(stmt);
                break;

            // ErrorStatement and unknown nodes are intentionally ignored
            default:
                break;
        }
    }

    // ── DML visitors ─────────────────────────────────────────────────────────

    private visitDeclare(stmt: DeclareNode): void {
        for (const variable of stmt.variables) {
            this.declare({
                name: variable.name,
                kind: variable.dataType === 'TABLE'
                    ? SymbolKind.Table
                    : SymbolKind.Variable,
                dataType: variable.dataType,
                columns: variable.columns?.map(c => c.name),
                location: { start: variable.start, end: variable.end },
                references: [],
            });

            // Visit the optional initialiser: DECLARE @x INT = @y + 1
            if (variable.initialValue) {
                this.visitExpression(variable.initialValue);
            }
        }
    }


    private visitSet(stmt: SetNode): void {
        // SET @X = ...
        // target variable counts as usage
        this.recordReference(stmt.variable, stmt);

        // RHS expression
        this.visitExpression(stmt.value);
    }



    private visitPrint(stmt: PrintNode): void {
        this.visitExpression(stmt.value);
    }

    private visitInsert(stmt: InsertNode): void {
        // Visit VALUES expressions
        if (stmt.values) {
            for (const row of stmt.values) {
                for (const expr of row) {
                    this.visitExpression(expr);
                }
            }
        }

        // Visit INSERT ... SELECT
        if (stmt.selectQuery) {
            this.visitQuery(stmt.selectQuery);
        }
    }

    private visitUpdate(stmt: UpdateNode): void {
        // FROM clause — register aliases first so SET/WHERE can reference them
        if (stmt.from) {
            // Push a query scope so aliases don't leak out
            this.pushScope(stmt.start, stmt.end, 'update');
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        for (const assignment of stmt.assignments) {
            this.visitExpression(assignment.value);
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        if (stmt.from) {
            this.popScope();
        }
    }

    private visitDelete(stmt: DeleteNode): void {
        if (stmt.from) {
            this.pushScope(stmt.start, stmt.end, 'delete');
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        if (stmt.from) {
            this.popScope();
        }
    }

    // ── CREATE visitor ────────────────────────────────────────────────────────

    private visitCreate(stmt: CreateNode): void {
        switch (stmt.objectType) {
            case 'TABLE':
            case 'VIEW':
                this.declare({
                    name: stmt.name,
                    kind: SymbolKind.Table,
                    columns: stmt.columns?.map(c => c.name),
                    location: stmt,
                    references: [],
                });
                return;

            case 'TYPE':
                this.declare({
                    name: stmt.name,
                    kind: SymbolKind.Type,
                    columns: stmt.columns?.map(c => c.name),
                    location: stmt,
                    references: [],
                });
                return;

            case 'PROCEDURE':
            case 'FUNCTION':
                this.declare({
                    name: stmt.name,
                    kind: stmt.objectType === 'PROCEDURE'
                        ? SymbolKind.Procedure
                        : SymbolKind.Function,
                    location: stmt,
                    references: [],
                });

                // Each proc/function gets its own scope
                this.pushScope(stmt.start, stmt.end, stmt.name);

                // Parameters are declared in the proc scope
                for (const param of stmt.parameters ?? []) {
                    this.declare({
                        name: param.name,
                        kind: SymbolKind.Parameter,
                        dataType: param.dataType,
                        location: param,
                        references: [],
                    });
                }

                // Walk the body
                if (Array.isArray(stmt.body)) {
                    for (const child of stmt.body) {
                        this.visitStatement(child);
                    }
                } else if (stmt.body) {
                    this.visitStatement(stmt.body);
                }

                this.popScope();
                return;

            default:
                return;
        }
    }

    // ── Control flow ──────────────────────────────────────────────────────────

    private visitWith(stmt: WithNode): void {
        // CTE names visible only within the WITH statement body
        this.pushScope(stmt.start, stmt.end, 'with');

        for (const cte of stmt.ctes) {
            this.declare({
                name: cte.name,
                kind: SymbolKind.CTE,
                location: cte,
                references: [],
            });

            // Visit the CTE query body
            // NOTE: CTE's own name should not be visible inside itself
            // unless it is a recursive CTE. Recursive CTE detection is
            // not implemented yet — treat all CTEs as non-recursive for now.
            this.visitQuery(cte.query);
        }

        this.visitStatement(stmt.body);

        this.popScope();
    }

    private visitBlock(stmt: BlockNode): void {
        // T-SQL variables are batch/procedure-scoped, NOT block-scoped.
        //
        //   BEGIN
        //       DECLARE @x INT
        //   END
        //   SELECT @x   -- valid in T-SQL
        //
        // Therefore BEGIN…END does NOT push a new scope.
        // We walk the body in the current scope only.
        for (const child of stmt.body) {
            this.visitStatement(child);
        }
    }

    private visitIf(stmt: IfNode): void {
        // Visit the condition expression
        this.visitExpression(stmt.condition);

        // Same reasoning as visitBlock: no new scope for branches
        this.visitBranch(stmt.thenBranch);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch);
        }
    }

    private visitBranch(branch: Statement | Statement[]): void {
        if (Array.isArray(branch)) {
            for (const stmt of branch) {
                this.visitStatement(stmt);
            }
            return;
        }
        this.visitStatement(branch);
    }

    // ── Query visitors ────────────────────────────────────────────────────────

    private visitQuery(query: QueryStatement): void {
        if (query.type === 'SetOperator') {
            this.visitQuery(query.left);
            this.visitQuery(query.right);
            return;
        }
        this.visitSelect(query);
    }

    private visitSelect(stmt: SelectNode): void {
        // Every SELECT gets its own query scope for table/column aliases.
        // T-SQL alias scoping rules:
        //   - Table aliases (FROM clause) are visible in SELECT, WHERE, HAVING, ORDER BY
        //   - Column aliases (SELECT list) are NOT visible in WHERE/HAVING
        //     but ARE visible in ORDER BY
        // We model this as one flat query scope for now.
        // Fine-grained alias visibility can be added when needed.
        this.pushScope(stmt.start, stmt.end, 'select');

        // 1. Register table/join aliases first so they're available
        //    when we walk SELECT list and WHERE expressions
        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        // 2. Walk SELECT column expressions
        for (const col of stmt.columns) {
            this.visitExpression(col.expression);

            // Register column alias for ORDER BY visibility
            if (col.alias) {
                this.declare({
                    name: col.alias,
                    kind: SymbolKind.Alias,
                    location: col,
                    references: [],
                });
            }
        }

        // 3. WHERE — column aliases are NOT visible here in T-SQL
        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        // 4. GROUP BY
        if (stmt.groupBy) {
            for (const expr of stmt.groupBy) {
                this.visitExpression(expr);
            }
        }

        // 5. HAVING
        if (stmt.having) {
            this.visitExpression(stmt.having);
        }

        // 6. ORDER BY — column aliases ARE visible here in T-SQL
        if (stmt.orderBy) {
            for (const order of stmt.orderBy) {
                this.visitExpression(order.expression);
            }
        }

        this.popScope();
    }
    
    private visitTableReference(ref: TableReference): void {
        // Register alias into the current query scope
        if (ref.alias) {
            this.declare({
                name: ref.alias,
                kind: SymbolKind.Alias,
                location: ref,
                references: [],
            });
        }

        // Derived table: FROM (SELECT ...) AS x
        // Recursively visit the inner query in its own scope
        const table = ref.table as any;
        if (table?.type === 'SubqueryExpression') {
            this.visitSubquery(table as SubqueryExpression);
        }

        // Walk JOIN clauses
        for (const join of ref.joins) {
            this.visitJoin(join);
        }
    }

    private visitJoin(join: JoinNode): void {
        if (join.alias) {
            this.declare({
                name: join.alias,
                kind: SymbolKind.Alias,
                location: join,
                references: [],
            });
        }

        // Derived table in JOIN: JOIN (SELECT ...) AS x ON ...
        const table = join.table as any;
        if (table?.type === 'SubqueryExpression') {
            this.visitSubquery(table as SubqueryExpression);
        }

        // Visit the ON condition expression
        if (join.on) {
            this.visitExpression(join.on);
        }
    }

    private visitSubquery(expr: SubqueryExpression): void {
        // Subqueries create their own nested scope
        this.pushScope(expr.start, expr.end, 'subquery');
        this.visitQuery(expr.query);
        this.popScope();
    }

    // ── Expression visitor ────────────────────────────────────────────────────

    /**
     * Recursively walks any Expression node.
     * Collects Variable references and records them against the scope chain.
     */
    private visitExpression(expr: Expression): void {
        if (!expr) return;

        switch (expr.type) {
            case 'Variable':
                // The primary purpose of expression visiting:
                // record every variable usage for undeclared/unused diagnostics
                this.recordReference(expr.name, expr);
                break;

            case 'Identifier':
                // Plain identifiers (column names, table names) — no scope action needed yet.
                // When schema integration is added, column refs will be resolved here.
                break;

            case 'MemberExpression':
                // e.g. u.Name — visit the object side (could be a variable or subexpression)
                this.visitExpression(expr.object);
                break;

            case 'BinaryExpression':
                this.visitExpression(expr.left);
                this.visitExpression(expr.right);
                break;

            case 'UnaryExpression':
                this.visitExpression(expr.right);
                break;

            case 'GroupingExpression':
                this.visitExpression(expr.expression);
                break;

            case 'FunctionCall':
                for (const arg of expr.args) {
                    this.visitExpression(arg);
                }
                break;

            case 'OverExpression':
                // The function call itself (e.g. ROW_NUMBER())
                this.visitExpression(expr.expression);
                // PARTITION BY expressions
                if (expr.window.partitionBy) {
                    for (const e of expr.window.partitionBy) {
                        this.visitExpression(e);
                    }
                }
                // ORDER BY expressions inside OVER()
                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.visitExpression(o.expression);
                    }
                }
                break;

            case 'CaseExpression':
                if (expr.input) this.visitExpression(expr.input);
                for (const branch of expr.branches) {
                    this.visitExpression(branch.when);
                    this.visitExpression(branch.then);
                }
                if (expr.elseBranch) this.visitExpression(expr.elseBranch);
                break;

            case 'InExpression':
                this.visitExpression(expr.left);
                if (expr.list) {
                    for (const item of expr.list) {
                        this.visitExpression(item);
                    }
                }
                if (expr.subquery) {
                    this.visitSubquery({
                        type: 'SubqueryExpression',
                        query: expr.subquery,
                        start: expr.start,
                        end: expr.end,
                    });
                }
                break;

            case 'BetweenExpression':
                this.visitExpression(expr.left);
                this.visitExpression(expr.lowerBound);
                this.visitExpression(expr.upperBound);
                break;

            case 'SubqueryExpression':
                this.visitSubquery(expr);
                break;

            case 'Literal':
                // No scope action needed for literals
                break;

            default:
                break;
        }
    }
}