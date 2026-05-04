import {
    Program,
    Statement,
    QueryStatement,
    SelectNode,
    Expression,
    IdentifierNode,
    WildcardExpression,
    WithNode,
    InsertNode,
    UpdateNode,
    TableReference,
    JoinNode,
} from './parser';

import {
    LineageNode,
    DerivedColumn,
    VirtualSource,
    LineageEdge,
    LineageResult
} from './lineage';

type SourceMap = Map<string, VirtualSource>;

export class LineageBuilder {
    private columns: DerivedColumn[] = [];
    private sources: SourceMap[] = [];

    build(program: Program): LineageResult {
        this.columns = [];
        this.sources = [new Map()];

        for (const stmt of program.body) {
            this.visitStatement(stmt);
        }

        return {
            columns: this.columns,
            edges: this.buildEdges(this.columns)
        };
    }

    // ============================================================
    // source scopes
    // ============================================================

    private pushSources(): void {
        this.sources.push(new Map());
    }

    private popSources(): void {
        this.sources.pop();
    }

    private currentSources(): SourceMap {
        return this.sources[this.sources.length - 1];
    }

    private defineSource(name: string, source: VirtualSource): void {
        this.currentSources().set(name.toLowerCase(), source);
    }

    private resolveSource(name: string): VirtualSource | undefined {
        const key = name.toLowerCase();

        for (let i = this.sources.length - 1; i >= 0; i--) {
            const found = this.sources[i].get(key);
            if (found) return found;
        }

        return undefined;
    }

    // ============================================================
    // traversal
    // ============================================================

    private visitStatement(stmt: Statement): void {
        switch (stmt.type) {
            case 'SelectStatement':
                this.visitSelect(stmt, true);
                break;

            case 'SetOperator':
                this.visitQuery(stmt, true);
                break;

            case 'WithStatement':
                this.visitWith(stmt);
                break;

            case 'InsertStatement':
                this.visitInsert(stmt);
                break;

            case 'UpdateStatement':
                this.visitUpdate(stmt);
                break;
        }
    }

    private visitQuery(
        query: QueryStatement | null,
        emit = false
    ): DerivedColumn[] {
        if (!query) {
            return [];
        }

        if (query.type === 'SetOperator') {
            return this.visitQuery(query.left, emit);
        }

        return this.visitSelect(query, emit);
    }

    private visitWith(stmt: WithNode): void {
        this.pushSources();

        for (const cte of stmt.ctes) {
            const cols = this.visitQuery(cte.query, false);

            this.defineSource(cte.name, {
                name: cte.name,
                columns: new Map(
                    cols.map(c => [c.name.toLowerCase(), c])
                ),
                wildcardSources: []
            });
        }

        this.visitStatement(stmt.body);

        this.popSources();
    }

    // ============================================================
    // SELECT
    // ============================================================

    private visitSelect(
        stmt: SelectNode,
        emit = false
    ): DerivedColumn[] {
        this.pushSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        const derived: DerivedColumn[] = [];

        for (const col of stmt.columns) {
            const dc: DerivedColumn = {
                name: col.outputName,
                expression: col.expression,
                inputs: this.resolveExpression(col.expression),
                location: col
            };

            derived.push(dc);

            if (emit) {
                this.columns.push(dc);
            }
        }

        this.popSources();

        return derived;
    }

    private registerTableReference(ref: TableReference): void {
        this.registerSource(ref.table, ref.alias);

        for (const join of ref.joins) {
            this.registerJoin(join);
        }
    }

    private registerJoin(join: JoinNode): void {
        this.registerSource(join.table, join.alias);
    }

    private registerSource(
        expr: Expression | null,
        alias?: string
    ): void {
        if (!expr) {
            return;
        }

        // subquery source
        if (expr.type === 'SubqueryExpression') {
            const bindName = alias ?? '__subquery';

            const cols = this.visitQuery(expr.query, false);

            this.defineSource(bindName, {
                name: bindName,
                columns: new Map(
                    cols.map(c => [c.name.toLowerCase(), c])
                ),
                wildcardSources: []
            });

            return;
        }

        // physical table / CTE / alias source
        if (expr.type === 'Identifier') {
            const objectName = expr.name;
            const bindName = alias ?? objectName;

            const existing = this.resolveSource(objectName);

            // CTE / virtual source already defined
            if (existing) {
                this.defineSource(bindName, existing);
                return;
            }

            // physical table
            this.defineSource(bindName, {
                name: objectName,
                columns: new Map(),
                wildcardSources: [
                    {
                        kind: 'column',
                        name: `${objectName}.*`,
                        source: objectName,
                        wildcard: true,
                        location: expr
                    }
                ]
            });
        }
    }

    // ============================================================
    // INSERT
    // ============================================================

    private visitInsert(stmt: InsertNode): void {
        if (!stmt.table || !stmt.selectQuery) {
            return;
        }

        if (stmt.table.type !== 'Identifier') {
            return;
        }

        const target = stmt.table.name;
        const sourceCols = this.visitQuery(stmt.selectQuery, false);

        if (!stmt.columns || stmt.columns.length === 0) {
            return;
        }

        for (let i = 0; i < stmt.columns.length; i++) {
            const targetCol = stmt.columns[i];
            const src = sourceCols[i];

            if (!src) continue;

            this.columns.push({
                name: `${target}.${targetCol}`,
                inputs: src.inputs,
                location: stmt
            });
        }
    }

    // ============================================================
    // UPDATE
    // ============================================================

    private visitUpdate(stmt: UpdateNode): void {
        if (!stmt.target || stmt.target.type !== 'Identifier') {
            return;
        }

        const target = stmt.target.name;

        this.pushSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        for (const assignment of stmt.assignments ?? []) {
            this.columns.push({
                name: `${target}.${assignment.column}`,
                expression: assignment.value ?? undefined,
                inputs: assignment.value
                    ? this.resolveExpression(assignment.value)
                    : [],
                location: stmt
            });
        }

        this.popSources();
    }

    // ============================================================
    // expression resolution
    // ============================================================

    private resolveExpression(expr: Expression | null): LineageNode[] {
        if (!expr) {
            return [];
        }

        switch (expr.type) {
            case 'Identifier':
                return this.resolveIdentifier(expr);

            case 'Variable':
                return [{
                    kind: 'variable',
                    name: expr.name,
                    location: expr
                }];

            case 'WildcardExpression':
                return this.resolveWildcard(expr);

            case 'BinaryExpression':
                return [
                    ...this.resolveExpression(expr.left),
                    ...this.resolveExpression(expr.right)
                ];

            case 'UnaryExpression':
                return this.resolveExpression(expr.right);

            case 'GroupingExpression':
                return this.resolveExpression(expr.expression);

            case 'FunctionCall':
                return expr.args.flatMap(x =>
                    this.resolveExpression(x)
                );

            case 'CaseExpression':
                return [
                    ...(expr.input
                        ? this.resolveExpression(expr.input)
                        : []),
                    ...expr.branches.flatMap(b => [
                        ...(b.when
                            ? this.resolveExpression(b.when)
                            : []),
                        ...(b.then
                            ? this.resolveExpression(b.then)
                            : [])
                    ]),
                    ...(expr.elseBranch
                        ? this.resolveExpression(expr.elseBranch)
                        : [])
                ];

            case 'BetweenExpression':
                return [
                    ...this.resolveExpression(expr.left),
                    ...this.resolveExpression(expr.lowerBound),
                    ...this.resolveExpression(expr.upperBound)
                ];

            case 'InExpression':
                return [
                    ...this.resolveExpression(expr.left),
                    ...(expr.list?.flatMap(x =>
                        this.resolveExpression(x)
                    ) ?? [])
                ];

            case 'OverExpression':
                return this.resolveExpression(expr.expression);

            default:
                return [];
        }
    }

    private resolveIdentifier(
        expr: IdentifierNode
    ): LineageNode[] {
        const parts = expr.parts;

        // alias.column
        if (parts.length >= 2) {
            const qualifier = parts[0];
            const column = parts[parts.length - 1];

            const source = this.resolveSource(qualifier);

            if (source) {
                const derived =
                    source.columns.get(column.toLowerCase());

                // flatten virtual source lineage
                if (derived) {
                    return derived.inputs;
                }

                // physical table column
                return [{
                    kind: 'column',
                    name: `${source.name}.${column}`,
                    source: source.name,
                    location: expr
                }];
            }
        }

        // unqualified
        return [{
            kind: 'column',
            name: expr.name,
            location: expr
        }];
    }

    private resolveWildcard(
        expr: WildcardExpression
    ): LineageNode[] {
        // SELECT *
        // Expand to every visible source in current FROM scope.
        if (!expr.tablePrefix) {
            const seen = new Set<string>();
            const nodes: LineageNode[] = [];

            const current = this.currentSources();

            for (const source of current.values()) {
                for (const wildcard of source.wildcardSources) {
                    const key = wildcard.name.toLowerCase();

                    if (seen.has(key)) {
                        continue;
                    }

                    seen.add(key);
                    nodes.push(wildcard);
                }
            }

            // fallback (SELECT * with malformed / missing FROM)
            if (nodes.length === 0) {
                return [{
                    kind: 'column',
                    name: '*',
                    wildcard: true,
                    location: expr
                }];
            }

            return nodes;
        }

        // SELECT alias.*
        const source =
            this.resolveSource(expr.tablePrefix.name);

        if (!source) {
            return [{
                kind: 'column',
                name: '*',
                wildcard: true,
                location: expr
            }];
        }

        return source.wildcardSources;
    }

    // ============================================================
    // edge projection
    // ============================================================

    private buildEdges(
        columns: DerivedColumn[]
    ): LineageEdge[] {
        const edges: LineageEdge[] = [];
        const seen = new Set<string>();

        for (const col of columns) {
            const target: LineageNode = {
                kind: 'result',
                name: col.name,
                location: col.location
            };

            for (const input of col.inputs) {
                const key =
                    `${input.name}->${target.name}`;

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                edges.push({
                    from: input,
                    to: target,
                    location: col.location
                });
            }
        }

        return edges;
    }
}