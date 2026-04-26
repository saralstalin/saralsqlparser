import {
    Program,
    Statement,
    DeclareNode,
    CreateNode,
    WithNode,
    BlockNode,
    IfNode,
    SelectNode,
    SetOperatorNode,
    QueryStatement,
    TableReference,
    JoinNode
} from './parser';

import { Scope, SymbolKind } from './scope';

export class ScopeBuilder {
    private root!: Scope;
    private current!: Scope;

    build(program: Program): Scope {
        // NOTE:
        // Currently builds one root scope for the entire script.
        //
        // GO batch separators are consumed by parser but are not modeled
        // in AST, so ScopeBuilder cannot reset scope per batch.
        //
        // In real T-SQL:
        //   DECLARE @x INT
        //   GO
        //   SELECT @x   -- invalid
        //
        // Here @x would still resolve.
        //
        // Future fix:
        // introduce BatchNode[] in Program AST and create scope per batch.
        this.root = new Scope(
            0,
            Number.MAX_SAFE_INTEGER,
            null,
            'root'
        );

        this.current = this.root;

        for (const stmt of program.body) {
            this.visitStatement(stmt);
        }

        return this.root;
    }

    private pushScope(
        start: number,
        end: number,
        name?: string
    ): void {
        const child = new Scope(
            start,
            end,
            this.current,
            name
        );

        this.current = child;
    }

    private popScope(): void {
        if (this.current.parent) {
            this.current = this.current.parent;
        }
    }

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

            default:
                break;
        }
    }

    private visitDeclare(stmt: DeclareNode): void {
        for (const variable of stmt.variables) {
            this.current.define({
                name: variable.name,
                kind:
                    variable.dataType === 'TABLE'
                        ? SymbolKind.Table
                        : SymbolKind.Variable,
                dataType: variable.dataType,
                columns: variable.columns?.map(c => c.name),
                location: {
                    start: variable.start,
                    end: variable.end
                }
            });
        }
    }

    private visitCreate(stmt: CreateNode): void {
        switch (stmt.objectType) {
            case 'TABLE':
            case 'VIEW':
                this.current.define({
                    name: stmt.name,
                    kind: SymbolKind.Table,
                    columns: stmt.columns?.map(c => c.name),
                    location: stmt
                });
                return;

            case 'TYPE':
                this.current.define({
                    name: stmt.name,
                    kind: SymbolKind.Type,
                    columns: stmt.columns?.map(c => c.name),
                    location: stmt
                });
                return;

            case 'PROCEDURE':
            case 'FUNCTION':
                this.current.define({
                    name: stmt.name,
                    kind:
                        stmt.objectType === 'PROCEDURE'
                            ? SymbolKind.Procedure
                            : SymbolKind.Function,
                    location: stmt
                });

                this.pushScope(
                    stmt.start,
                    stmt.end,
                    stmt.name
                );

                for (const parameter of stmt.parameters ?? []) {
                    this.current.define({
                        name: parameter.name,
                        kind: SymbolKind.Parameter,
                        dataType: parameter.dataType,
                        location: parameter
                    });
                }

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

    private visitWith(stmt: WithNode): void {
        // CTE names are visible only within the WITH statement body.
        this.pushScope(
            stmt.start,
            stmt.end,
            'with'
        );

        for (const cte of stmt.ctes) {
            this.current.define({
                name: cte.name,
                kind: SymbolKind.CTE,
                location: cte
            });

            this.visitQuery(cte.query);
        }

        this.visitStatement(stmt.body);

        this.popScope();
    }

    private visitBlock(stmt: BlockNode): void {
        this.pushScope(
            stmt.start,
            stmt.end,
            'block'
        );

        for (const child of stmt.body) {
            this.visitStatement(child);
        }

        this.popScope();
    }

    private visitIf(stmt: IfNode): void {
        // T-SQL variables are batch/procedure scoped,
        // not lexical block scoped.
        //
        // Example:
        //   IF 1=1
        //       DECLARE @x INT
        //
        //   SELECT @x
        //
        // @x is valid after IF.
        //
        // Therefore we intentionally DO NOT create a child scope here.
        this.visitBranch(stmt.thenBranch);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch);
        }
    }

    private visitBranch(
        branch: Statement | Statement[]
    ): void {
        if (Array.isArray(branch)) {
            for (const stmt of branch) {
                this.visitStatement(stmt);
            }

            return;
        }

        this.visitStatement(branch);
    }

    private visitQuery(query: QueryStatement): void {
        if (query.type === 'SetOperator') {
            this.visitQuery(query.left);
            this.visitQuery(query.right);
            return;
        }

        this.visitSelect(query);
    }

    private visitSelect(stmt: SelectNode): void {
        if (!stmt.from) {
            return;
        }

        // aliases are query-local
        this.pushScope(
            stmt.start,
            stmt.end,
            'select'
        );

        for (const table of stmt.from) {
            this.visitTableReference(table);
        }

        this.popScope();
    }

    private visitTableReference(
        ref: TableReference
    ): void {
        if (ref.alias) {
            this.current.define({
                name: ref.alias,
                kind: SymbolKind.Alias,
                location: ref
            });
        }

        // TODO:
        // Derived table:
        // FROM (SELECT ...) x
        //
        // ref.table is SubqueryExpression.
        //
        // We should recursively visit inner query
        // and build its own nested scope.
        //
        // Not implemented in first pass.

        for (const join of ref.joins) {
            this.visitJoin(join);
        }
    }

    private visitJoin(join: JoinNode): void {
        if (join.alias) {
            this.current.define({
                name: join.alias,
                kind: SymbolKind.Alias,
                location: join
            });
        }

        // TODO:
        // JOIN (SELECT ...) x ON ...
        //
        // same derived-table handling needed here.
    }
}
