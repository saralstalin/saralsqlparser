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
    QueryStatement,
    TableReference,
    JoinNode,
    NodeLocation,
    SubqueryExpression,
} from './parser';

import { Scope, Symbol, SymbolKind, SymbolReference, ReferenceKind } from './scope';


export interface DuplicateDeclaration {
    name: string;
    original: NodeLocation;
    duplicate: NodeLocation;
    scopeName?: string;
}


// ─── Result ──────────────────────────────────────────────────────────────────

export interface ScopeBuilderResult {
    root: Scope;
    references: Map<string, SymbolReference[]>;
    undeclared: SymbolReference[];
    duplicates: DuplicateDeclaration[];
}



// ─── Builder ─────────────────────────────────────────────────────────────────

export class ScopeBuilder {
    private root!: Scope;
    private current!: Scope;

    private references = new Map<string, SymbolReference[]>();
    private undeclared: SymbolReference[] = [];
    private duplicates: DuplicateDeclaration[] = [];

    // ── Public ────────────────────────────────────────────────────────────────

    build(program: Program): ScopeBuilderResult {
        this.references = new Map();
        this.undeclared = [];
        this.duplicates = [];

        this.root = new Scope(0, Number.MAX_SAFE_INTEGER, null, 'root');
        this.current = this.root;

        for (const stmt of program.body) {
            this.visitStatement(stmt);
        }

        return {
            root: this.root,
            references: this.references,
            undeclared: this.undeclared,
            duplicates: this.duplicates,
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
            this.duplicates.push({
                name: symbol.name,
                original: existing.location,
                duplicate: symbol.location,
                scopeName: this.current.name,
            });
        }
    }

    // ── References ────────────────────────────────────────────────────────────

    private recordReference(name: string, location: NodeLocation, kind: ReferenceKind = 'read'): void {
        if (name.startsWith('@@')) return;

        const ref: SymbolReference = { location, kind };
        const key = name.toLowerCase();

        if (!this.references.has(key)) {
            this.references.set(key, []);
        }

        this.references.get(key)!.push(ref);

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

            default:
                break;
        }
    }

    // ── DML ───────────────────────────────────────────────────────────────────

    private visitDeclare(stmt: DeclareNode): void {
        for (const variable of stmt.variables) {
            this.declare({
                name: variable.name,
                kind:
                    variable.dataType === 'TABLE'
                        ? SymbolKind.Table
                        : SymbolKind.Variable,
                dataType: variable.dataType,
                columns: variable.columns?.map(c => c.name),
                location: { start: variable.start, end: variable.end },
                references: [],
            });

            if (variable.initialValue) {
                this.visitExpression(variable.initialValue);
            }
        }
    }

    private visitSet(stmt: SetNode): void {
        // Only variable assignments are symbol references
        // Examples:
        // SET @x = 1
        // SET @@ROWCOUNT = 5
        if (stmt.variable.startsWith('@')) {
            this.recordReference(
                stmt.variable,
                {
                    start: stmt.variableStart,
                    end: stmt.variableEnd
                },
                'write'
            );
        }

        if (stmt.value) {
            this.visitExpression(stmt.value);
        }
    }

    private visitPrint(stmt: PrintNode): void {
        this.visitExpression(stmt.value);
    }

    private visitInsert(stmt: InsertNode): void {
        if (stmt.table) {
            this.visitExpression(stmt.table);
        }

        if (stmt.values) {
            for (const row of stmt.values) {
                for (const expr of row) {
                    this.visitExpression(expr);
                }
            }
        }

        if (stmt.selectQuery) {
            this.visitQuery(stmt.selectQuery);
        }
    }

    private visitUpdate(stmt: UpdateNode): void {
        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        if (stmt.from) {
            this.pushScope(stmt.start, stmt.end, 'update');

            for (const table of stmt.from) {
                this.visitTableReference(table);
            }

            if (stmt.assignments) {
                for (const assignment of stmt.assignments) {
                    this.visitExpression(assignment.value);
                }
            }

            if (stmt.where) {
                this.visitExpression(stmt.where);
            }

            this.popScope();
        } else {
            if (stmt.assignments) {
                for (const assignment of stmt.assignments) {
                    this.visitExpression(assignment.value);
                }
            }

            if (stmt.where) {
                this.visitExpression(stmt.where);
            }
        }
    }

    private visitDelete(stmt: DeleteNode): void {
        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        if (stmt.from) {
            this.pushScope(stmt.start, stmt.end, 'delete');

            for (const table of stmt.from) {
                this.visitTableReference(table);
            }

            if (stmt.where) {
                this.visitExpression(stmt.where);
            }

            this.popScope();
        } else {
            if (stmt.where) {
                this.visitExpression(stmt.where);
            }
        }
    }

    // ── CREATE ────────────────────────────────────────────────────────────────

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
                    kind:
                        stmt.objectType === 'PROCEDURE'
                            ? SymbolKind.Procedure
                            : SymbolKind.Function,
                    location: stmt,
                    references: [],
                });

                this.pushScope(stmt.start, stmt.end, stmt.name);

                for (const param of stmt.parameters ?? []) {
                    this.declare({
                        name: param.name,
                        kind: SymbolKind.Parameter,
                        dataType: param.dataType,
                        location: param,
                        references: [],
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

    // ── Control flow ──────────────────────────────────────────────────────────

    private visitWith(stmt: WithNode): void {
        this.pushScope(stmt.start, stmt.end, 'with');

        for (const cte of stmt.ctes) {
            this.declare({
                name: cte.name,
                kind: SymbolKind.CTE,
                location: cte,
                references: [],
            });

            this.visitQuery(cte.query);
        }

        this.visitStatement(stmt.body);

        this.popScope();
    }

    private visitBlock(stmt: BlockNode): void {
        for (const child of stmt.body) {
            this.visitStatement(child);
        }
    }

    private visitIf(stmt: IfNode): void {
        this.visitExpression(stmt.condition);
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

    // ── Query ────────────────────────────────────────────────────────────────

    private visitQuery(query: QueryStatement | null): void {
        if (!query) {
            return;
        }

        if (query.type === 'SetOperator') {
            this.visitQuery(query.left);

            if (query.right) {
                this.visitQuery(query.right);
            }

            return;
        }

        this.visitSelect(query);
    }

    private visitSelect(stmt: SelectNode): void {
        this.pushScope(stmt.start, stmt.end, 'select');

        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        for (const col of stmt.columns) {
            this.visitExpression(col.expression);

            if (col.alias) {
                this.declare({
                    name: col.alias,
                    kind: SymbolKind.Alias,
                    location: col,
                    references: [],
                });
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        if (stmt.groupBy) {
            for (const expr of stmt.groupBy) {
                this.visitExpression(expr);
            }
        }

        if (stmt.having) {
            this.visitExpression(stmt.having);
        }

        if (stmt.orderBy) {
            for (const order of stmt.orderBy) {
                this.visitExpression(order.expression);
            }
        }

        this.popScope();
    }

    private visitTableReference(ref: TableReference): void {
        if (ref.alias) {
            this.declare({
                name: ref.alias,
                kind: SymbolKind.Alias,
                location: ref,
                references: [],
            });
        }

        const table = ref.table;

        if (table) {
            if (table.type === 'SubqueryExpression') {
                this.visitSubquery(table);
            } else {
                this.visitExpression(table);
            }
        }

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

        const table = join.table;

        if (table) {
            if (table.type === 'SubqueryExpression') {
                this.visitSubquery(table);
            } else {
                this.visitExpression(table);
            }
        }

        if (join.on) {
            this.visitExpression(join.on);
        }
    }

    private visitSubquery(expr: SubqueryExpression): void {
        this.pushScope(expr.start, expr.end, 'subquery');
        this.visitQuery(expr.query);
        this.popScope();
    }

    // ── Expression ───────────────────────────────────────────────────────────

    private visitExpression(expr: Expression | null | undefined): void {
        if (!expr) return;

        switch (expr.type) {
            case 'Variable':
                this.recordReference(expr.name, expr);
                break;

            case 'Identifier':
            case 'Literal':
                break;

            case 'MemberExpression':
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
                this.visitExpression(expr.expression);

                if (expr.window.partitionBy) {
                    for (const e of expr.window.partitionBy) {
                        this.visitExpression(e);
                    }
                }

                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.visitExpression(o.expression);
                    }
                }
                break;

            case 'CaseExpression':
                if (expr.input) {
                    this.visitExpression(expr.input);
                }

                for (const branch of expr.branches) {
                    this.visitExpression(branch.when);
                    this.visitExpression(branch.then);
                }

                if (expr.elseBranch) {
                    this.visitExpression(expr.elseBranch);
                }
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

            default:
                break;
        }
    }
}