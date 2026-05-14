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
    MergeNode,
    TryCatchNode,
    RaiseErrorNode,
    ThrowNode,
    WhileNode,
    QueryStatement,
    TableReference,
    JoinNode,
    NodeLocation,
    SubqueryExpression,
    OutputClauseNode,
    IdentifierNode
} from '../ast/types';

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

            case 'MergeStatement':
                this.visitMerge(stmt);
                break;

            case 'SetStatement':
                this.visitSet(stmt);
                break;

            case 'PrintStatement':
                this.visitPrint(stmt);
                break;

            case 'RaiseErrorStatement':
                this.visitRaiseError(stmt);
                break;

            case 'ThrowStatement':
                this.visitThrow(stmt);
                break;

            case 'TryCatchStatement':
                this.visitTryCatch(stmt);
                break;

            case 'WhileStatement':
                this.visitWhile(stmt);
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

    private visitRaiseError(stmt: RaiseErrorNode): void {
        for (const arg of stmt.args) {
            this.visitExpression(arg);
        }
    }

    private visitThrow(stmt: ThrowNode): void {
        if (stmt.errorNumber) {
            this.visitExpression(stmt.errorNumber);
        }

        if (stmt.message) {
            this.visitExpression(stmt.message);
        }

        if (stmt.state) {
            this.visitExpression(stmt.state);
        }
    }

    private visitTryCatch(stmt: TryCatchNode): void {
        this.visitBlock(stmt.tryBlock);
        this.visitBlock(stmt.catchBlock);
    }

    private visitWhile(stmt: WhileNode): void {
        if (stmt.condition) {
            this.visitExpression(stmt.condition);
        }

        if (stmt.body) {
            this.visitStatement(stmt.body);
        }
    }

    private visitInsert(stmt: InsertNode): void {
        this.pushScope(stmt.start, stmt.end, 'insert');

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }
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

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitUpdate(stmt: UpdateNode): void {
        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        this.pushScope(stmt.start, stmt.end, 'update');

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }

        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        if (stmt.assignments) {
            for (const assignment of stmt.assignments) {
                this.visitExpression(assignment.value);
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitDelete(stmt: DeleteNode): void {
        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        this.pushScope(stmt.start, stmt.end, 'delete');

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }

        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitMerge(stmt: MergeNode): void {
        this.pushScope(stmt.start, stmt.end, 'merge');

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }

        if (stmt.target && stmt.targetAlias) {
            let targetName: string | undefined;

            if (stmt.target.type === 'Identifier') {
                targetName = stmt.target.name;
            }

            this.declare({
                name: stmt.targetAlias,
                kind: SymbolKind.Alias,
                location: stmt,
                references: [],
                metadata: targetName ? { tableName: targetName } : undefined,
            });
        }

        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        if (stmt.using) {
            this.visitTableReference(stmt.using);
        }

        if (stmt.on) {
            this.visitExpression(stmt.on);
        }

        for (const clause of stmt.whenClauses) {
            if (clause.predicate) {
                this.visitExpression(clause.predicate);
            }

            switch (clause.action.type) {
                case 'MergeUpdateAction':
                    for (const assignment of clause.action.assignments ?? []) {
                        if (assignment.columnNode) {
                            this.visitExpression(assignment.columnNode);
                        }

                        this.visitExpression(assignment.value);
                    }
                    break;

                case 'MergeInsertAction':
                    if (clause.action.values) {
                        for (const value of clause.action.values) {
                            this.visitExpression(value);
                        }
                    }

                    if (clause.action.selectQuery) {
                        this.visitQuery(clause.action.selectQuery);
                    }
                    break;

                case 'MergeDeleteAction':
                    break;
            }
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

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
        const table = ref.table;

        // -----------------------------------------
        // Alias (WITH metadata)
        // -----------------------------------------
        if (ref.alias) {
            let tableName: string | undefined;
            const columns =
                this.getTableReferenceAliasColumns(ref);

            if (table?.type === 'Identifier') {
                tableName = table.name;
            }

            this.declare({
                name: ref.alias,
                kind: SymbolKind.Alias, // ✅ DO NOT CHANGE
                location: ref,
                references: [],
                ...(columns?.length
                    ? { columns }
                    : {}),
                metadata: tableName
                    ? { tableName }
                    : undefined,
            });
        }

        // -----------------------------------------
        // Visit table
        // -----------------------------------------
        if (table) {
            if (table.type === 'SubqueryExpression') {
                this.visitSubquery(table);
            } else {
                this.visitExpression(table);
            }
        }

        // -----------------------------------------
        // Joins
        // -----------------------------------------
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
                this.recordIdentifierReference(expr);
                break;

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

    private declareOutputPseudoTables(location: NodeLocation): void {
        this.declare({
            name: 'INSERTED',
            kind: SymbolKind.Table,
            location,
            references: [],
        });

        this.declare({
            name: 'DELETED',
            kind: SymbolKind.Table,
            location,
            references: [],
        });
    }

    private visitOutputClause(output?: OutputClauseNode): void {
        if (!output) {
            return;
        }

        for (const col of output.columns) {
            if (col.sourceTable) {
                this.recordReference(col.sourceTable, col);
            }

            this.visitExpression(col.column.expression);
        }

        if (output.intoTable) {
            this.visitExpression(output.intoTable);
        }
    }

    private recordIdentifierReference(expr: IdentifierNode): void {
        const parts = expr.parts;

        // -----------------------------------------
        // CASE 1: Qualified identifier (u.Id)
        // -----------------------------------------
        if (parts.length >= 2) {
            const qualifier = parts[0];

            if (this.current.resolve(qualifier)) {
                //  only record qualifier (alias/table symbol)
                this.recordReference(qualifier, expr);
            }

            return;
        }

        // -----------------------------------------
        // CASE 2: Single identifier
        // -----------------------------------------
        const name = expr.name;

        // ONLY resolve declared symbols (variables, alias, params, etc.)
        if (this.current.resolve(name)) {
            this.recordReference(name, expr);
        }

        //  DO NOT attempt column resolution here
        //  DO NOT push undeclared for identifiers
    }

    private getTableReferenceAliasColumns(ref: TableReference): string[] | undefined {
        if (ref.pivot) {
            return this.getPivotOutputColumns(ref);
        }

        if (ref.unpivot) {
            return this.getUnpivotOutputColumns(ref);
        }

        return undefined;
    }

    private getPivotOutputColumns(ref: TableReference): string[] | undefined {
        const pivot = ref.pivot;
        if (!pivot) {
            return undefined;
        }

        const sourceColumns =
            this.getExpressionOutputColumns(ref.table) ?? [];
        const forColumnName =
            pivot.forColumn?.name;
        const aggregateInputColumns =
            this.getExpressionIdentifierNames(pivot.aggregate);
        const pivotColumns =
            pivot.inColumns.map(col => col.name);

        const preserved =
            sourceColumns.filter(name =>
                !this.isSameColumnName(name, forColumnName) &&
                !aggregateInputColumns.some(input =>
                    this.isSameColumnName(name, input)
                )
            );

        const combined = [
            ...preserved,
            ...pivotColumns
        ];

        return combined.length
            ? this.uniqueColumnNames(combined)
            : undefined;
    }

    private getUnpivotOutputColumns(ref: TableReference): string[] | undefined {
        const unpivot = ref.unpivot;
        if (!unpivot) {
            return undefined;
        }

        const sourceColumns =
            this.getExpressionOutputColumns(ref.table) ?? [];
        const inputColumns =
            unpivot.inColumns.map(col => col.name);
        const preserved =
            sourceColumns.filter(name =>
                !inputColumns.some(input =>
                    this.isSameColumnName(name, input)
                )
            );

        const combined = [
            ...preserved,
            ...(unpivot.valueColumn ? [unpivot.valueColumn.name] : []),
            ...(unpivot.forColumn ? [unpivot.forColumn.name] : [])
        ];

        return combined.length
            ? this.uniqueColumnNames(combined)
            : undefined;
    }

    private getExpressionOutputColumns(expr: Expression | null | undefined): string[] | undefined {
        if (!expr) {
            return undefined;
        }

        if (expr.type === 'Identifier') {
            return this.current.resolve(expr.name)?.columns;
        }

        if (expr.type === 'SubqueryExpression') {
            return this.getQueryOutputColumns(expr.query);
        }

        return undefined;
    }

    private getQueryOutputColumns(query: QueryStatement | null | undefined): string[] | undefined {
        if (!query) {
            return undefined;
        }

        if (query.type === 'SetOperator') {
            return this.getQueryOutputColumns(query.left);
        }

        const columns = query.columns
            .map(col => col.alias || col.outputName || col.sourceName)
            .filter((name): name is string => Boolean(name));

        return columns.length
            ? columns
            : undefined;
    }

    private getExpressionIdentifierNames(expr: Expression | null | undefined): string[] {
        if (!expr) {
            return [];
        }

        switch (expr.type) {
            case 'Identifier':
                return [expr.name];

            case 'FunctionCall':
                return expr.args.flatMap(arg =>
                    this.getExpressionIdentifierNames(arg)
                );

            case 'BinaryExpression':
                return [
                    ...this.getExpressionIdentifierNames(expr.left),
                    ...this.getExpressionIdentifierNames(expr.right)
                ];

            case 'UnaryExpression':
                return this.getExpressionIdentifierNames(expr.right);

            case 'GroupingExpression':
                return this.getExpressionIdentifierNames(expr.expression);

            case 'MemberExpression':
                return this.getExpressionIdentifierNames(expr.object);

            case 'CastExpression':
                return this.getExpressionIdentifierNames(expr.expression);

            default:
                return [];
        }
    }

    private isSameColumnName(left: string | undefined, right: string | undefined): boolean {
        if (!left || !right) {
            return false;
        }

        return this.normalizeColumnName(left) === this.normalizeColumnName(right);
    }

    private normalizeColumnName(name: string): string {
        return name
            .trim()
            .replace(/^\[(.*)\]$/, '$1')
            .toLowerCase();
    }

    private uniqueColumnNames(columns: string[]): string[] {
        const seen = new Set<string>();
        const unique: string[] = [];

        for (const column of columns) {
            const key =
                this.normalizeColumnName(column);

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            unique.push(column);
        }

        return unique;
    }



}
