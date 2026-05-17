import {
    Program,
    Statement,
    QueryStatement,
    SelectNode,
    MergeNode,
    MergeAction,
    Expression,
    IdentifierNode,
    WildcardExpression,
    WithNode,
    CreateNode,
    IfNode,
    BlockNode,
    TryCatchNode,
    InsertNode,
    UpdateNode,
    DeleteNode,
    OutputColumnNode,
    OutputClauseNode,
    TableReference,
    JoinNode,
    FrameBoundary,
} from '../ast/types';

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

            case 'CreateStatement':
                this.visitCreate(stmt);
                break;

            case 'IfStatement':
                this.visitIf(stmt);
                break;

            case 'BlockStatement':
                this.visitBlock(stmt);
                break;

            case 'TryCatchStatement':
                this.visitTryCatch(stmt);
                break;

            case 'InsertStatement':
                this.visitInsert(stmt);
                break;

            case 'UpdateStatement':
                this.visitUpdate(stmt);
                break;

            case 'DeleteStatement':
                this.visitDelete(stmt);
                break;

            case 'MergeStatement':
                this.visitMerge(stmt);
                break;
        }
    }

    private visitCreate(stmt: CreateNode): void {
        if (
            stmt.objectType === 'TABLE' &&
            stmt.nameNode?.name &&
            stmt.nameNode.name.startsWith('#') &&
            stmt.columns &&
            stmt.columns.length > 0
        ) {
            const name = stmt.nameNode.name;
            const source: VirtualSource = {
                name,
                columns: new Map(
                    stmt.columns.map(col => [
                        col.name.toLowerCase(),
                        {
                            name: col.name,
                            inputs: [],
                            location: stmt
                        } as DerivedColumn
                    ])
                ),
                wildcardSources: [
                    {
                        kind: 'column',
                        name: `${name}.*`,
                        source: name,
                        wildcard: true,
                        location: stmt.nameNode
                    }
                ]
            };

            this.defineSource(name, source);
        }

        if (!stmt.body) {
            return;
        }

        if (Array.isArray(stmt.body)) {
            for (const child of stmt.body) {
                this.visitStatement(child);
            }
            return;
        }

        this.visitStatement(stmt.body);
    }

    private visitIf(stmt: IfNode): void {
        this.visitBranch(stmt.thenBranch);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch);
        }
    }

    private visitBlock(stmt: BlockNode): void {
        for (const child of stmt.body) {
            this.visitStatement(child);
        }
    }

    private visitTryCatch(stmt: TryCatchNode): void {
        this.visitStatement(stmt.tryBlock);
        this.visitStatement(stmt.catchBlock);
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

    private defineOutputPseudoSources(): void {
        for (const name of ['INSERTED', 'DELETED']) {
            this.defineSource(name, {
                name,
                columns: new Map(),
                wildcardSources: [
                    {
                        kind: 'column',
                        name: `${name}.*`,
                        source: name,
                        wildcard: true
                    }
                ]
            });
        }
    }

    private visitOutputClause(
        output: OutputClauseNode | undefined
    ): void {
        if (!output) {
            return;
        }

        for (let i = 0; i < output.columns.length; i++) {
            const out = output.columns[i];

            let inputs: LineageNode[];

            // ------------------------------------------------------------
            // 1. Special-case wildcard: inserted.* / deleted.*
            // ------------------------------------------------------------
            if (out.sourceTable && out.column.wildcard) {
                inputs = [{
                    kind: 'column',
                    name: `${out.sourceTable}.*`,
                    source: out.sourceTable,
                    wildcard: true,
                    location: out.column
                }];
            } else {
                // ------------------------------------------------------------
                // 2. Resolve expression normally
                // ------------------------------------------------------------
                inputs = this.resolveExpression(
                    out.column.expression
                );

                // ------------------------------------------------------------
                // 3. Restore INSERTED / DELETED prefix
                // ------------------------------------------------------------
                if (out.sourceTable) {
                    const source = out.sourceTable; // narrowed to non-null

                    inputs = inputs.map(node => {
                        if (
                            node.kind === 'column' &&
                            !node.source
                        ) {
                            return {
                                ...node,
                                name: `${source}.${node.name}`,
                                source
                            } as LineageNode;
                        }

                        return node;
                    });
                }
            }

            // ------------------------------------------------------------
            // 4. Target name
            // ------------------------------------------------------------
            let target = out.column.outputName;

            if (
                output.intoTable &&
                output.intoTable.type === 'Identifier' &&
                output.intoColumns &&
                output.intoColumns[i]
            ) {
                target =
                    `${output.intoTable.name}.${output.intoColumns[i]}`;
            }

            // ------------------------------------------------------------
            // 5. Emit lineage
            // ------------------------------------------------------------
            this.columns.push({
                name: target,
                expression: out.column.expression,
                inputs,
                location: out
            });
        }
    }

    private visitDelete(stmt: DeleteNode): void {
        this.pushSources();

        this.defineOutputPseudoSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        this.visitOutputClause(stmt.output);

        this.popSources();
    }

    private visitMerge(stmt: MergeNode): void {
        this.pushSources();

        if (stmt.output) {
            this.defineOutputPseudoSources();
        }

        if (stmt.target) {
            this.registerSource(stmt.target, stmt.targetAlias);
        }

        if (stmt.using) {
            this.registerTableReference(stmt.using);
        }

        if (stmt.on) {
            this.resolveExpression(stmt.on);
        }

        for (const clause of stmt.whenClauses) {
            if (clause.predicate) {
                this.resolveExpression(clause.predicate);
            }

            this.visitMergeAction(clause.action, stmt);
        }

        this.visitOutputClause(stmt.output);

        this.popSources();
    }

    private visitMergeAction(
        action: MergeAction,
        stmt: MergeNode
    ): void {
        if (action.type === 'MergeUpdateAction') {
            const targetName = this.resolveMergeTargetName(stmt);

            for (const assignment of action.assignments ?? []) {
                this.columns.push({
                    name: assignment.columnNode &&
                        assignment.columnNode.parts.length > 1
                        ? assignment.columnNode.name
                        : `${targetName}.${assignment.column}`,
                    expression: assignment.value ?? undefined,
                    inputs: assignment.value
                        ? this.resolveExpression(assignment.value)
                        : [],
                    location: stmt
                });
            }

            return;
        }

        if (action.type === 'MergeInsertAction') {
            const targetName = this.resolveMergeTargetName(stmt);

            if (action.values && action.columns) {
                for (let i = 0; i < action.columns.length; i++) {
                    const target = `${targetName}.${action.columns[i]}`;
                    const value = action.values[i];
                    this.columns.push({
                        name: target,
                        expression: value ?? undefined,
                        inputs: value
                            ? this.resolveExpression(value)
                            : [],
                        location: stmt
                    });
                }
            }

            if (action.columns && action.selectQuery) {
                const sourceCols = this.visitQuery(action.selectQuery, false);

                for (let i = 0; i < action.columns.length; i++) {
                    const target = `${targetName}.${action.columns[i]}`;
                    const sourceCol = sourceCols[i];

                    if (!sourceCol) {
                        continue;
                    }

                    this.columns.push({
                        name: target,
                        inputs: sourceCol.inputs,
                        location: stmt
                    });
                }
            }

            return;
        }
    }

    private resolveMergeTargetName(stmt: MergeNode): string {
        if (!stmt.target || stmt.target.type !== 'Identifier') {
            return '';
        }

        return stmt.targetAlias ?? stmt.target.name;
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
                wildcardSources: this.collectWildcardSources(cols)
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
            if (
                col.expression.type === 'BinaryExpression' &&
                col.expression.operator === '=' &&
                col.expression.left.type === 'Variable'
            ) {
                const dc: DerivedColumn = {
                    name: col.expression.left.name,
                    expression: col.expression.right ?? undefined,
                    inputs: this.resolveExpression(col.expression.right),
                    location: col
                };

                derived.push(dc);

                if (emit) {
                    this.columns.push(dc);
                }

                continue;
            }

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

        // ------------------------------------------------------------
        // subquery source
        // ------------------------------------------------------------
        if (expr.type === 'SubqueryExpression') {
            const bindName = alias ?? '__subquery';

            const cols = this.visitQuery(expr.query, false);

            this.defineSource(bindName, {
                name: bindName,
                columns: new Map(
                    cols.map(c => [c.name.toLowerCase(), c])
                ),
                wildcardSources: this.collectWildcardSources(cols)
            });

            return;
        }

        // ------------------------------------------------------------
        // physical table / CTE
        // ------------------------------------------------------------
        if (expr.type === 'Identifier') {
            const objectName =
                expr.parts.length > 0
                    ? expr.parts.join('.')
                    : expr.name;

            const bindName = alias ?? objectName;

            // existing virtual source (CTE etc.)
            const existing =
                this.resolveSource(objectName);

            if (existing) {
                // preserve original underlying name
                this.defineSource(bindName, {
                    ...existing,
                    name: existing.name
                });
                return;
            }

            // physical table
            const physical: VirtualSource = {
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
            };

            // bind alias -> physical
            this.defineSource(bindName, physical);

            // also bind physical name -> physical
            // Customer -> Customer
            if (bindName.toLowerCase() !== objectName.toLowerCase()) {
                this.defineSource(objectName, physical);
            }
        }
    }

    // ============================================================
    // INSERT
    // ============================================================

    private visitInsert(stmt: InsertNode): void {
        // OUTPUT pseudo tables live in statement-local scope
        this.pushSources();
        this.defineOutputPseudoSources();

        // INSERT ... SELECT lineage
        if (
            stmt.table &&
            stmt.table.type === 'Identifier' &&
            stmt.selectQuery
        ) {
            const target = stmt.table.name;
            const sourceCols = this.visitQuery(
                stmt.selectQuery,
                false
            );
            const targetSource =
                this.resolveSource(target);
            const targetCols =
                stmt.columns && stmt.columns.length > 0
                    ? stmt.columns
                    : [...(
                        targetSource?.columns.values() ?? []
                    )].map(col => col.name);

            if (
                targetCols.length === 0 &&
                sourceCols.length === 1 &&
                sourceCols[0].inputs.some(input => input.wildcard)
            ) {
                this.columns.push({
                    name: `${target}.*`,
                    expression: sourceCols[0].expression,
                    inputs: sourceCols[0].inputs,
                    location: stmt
                });
            }

            for (let i = 0; i < targetCols.length; i++) {
                const targetCol = targetCols[i];
                const src = sourceCols[i];

                if (!src) {
                    continue;
                }

                this.columns.push({
                    name: `${target}.${targetCol}`,
                    inputs: src.inputs,
                    location: stmt
                });
            }
        }

        // INSERT ... VALUES lineage
        if (
            stmt.table &&
            stmt.table.type === 'Identifier' &&
            stmt.values &&
            stmt.columns &&
            stmt.columns.length > 0
        ) {
            const target = stmt.table.name;

            for (const row of stmt.values) {
                for (let i = 0; i < stmt.columns.length; i++) {
                    const targetCol = stmt.columns[i];
                    const expr = row[i];

                    if (!expr) {
                        continue;
                    }

                    this.columns.push({
                        name: `${target}.${targetCol}`,
                        expression: expr,
                        inputs: this.resolveExpression(expr),
                        location: stmt
                    });
                }
            }
        }

        // INSERT ... OUTPUT ...
        this.visitOutputClause(stmt.output);

        this.popSources();
    }

    // ============================================================
    // UPDATE
    // ============================================================

    private visitUpdate(stmt: UpdateNode): void {
        if (!stmt.target || stmt.target.type !== 'Identifier') {
            return;
        }

        this.pushSources();
        this.defineOutputPseudoSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        const target = stmt.target.name;

        for (const assignment of stmt.assignments ?? []) {
            this.columns.push({
                name:
                    assignment.columnNode &&
                    assignment.columnNode.parts.length > 1
                        ? assignment.columnNode.name
                        : `${target}.${assignment.column}`,
                expression: assignment.value ?? undefined,
                inputs: assignment.value
                    ? this.resolveExpression(assignment.value)
                    : [],
                location: stmt
            });
        }

        this.visitOutputClause(stmt.output);
        this.popSources();
    }

    // ============================================================
    // expression resolution
    // ============================================================

    private resolveExpression(expr: Expression | null | undefined): LineageNode[] {
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
                return [
                    ...expr.args.flatMap(x =>
                        this.resolveExpression(x)
                    ),
                    ...(expr.withinGroup?.flatMap(order =>
                        this.resolveExpression(order.expression)
                    ) ?? [])
                ];

            case 'ValuesTableExpression':
                return expr.rows.flatMap(row =>
                    row.flatMap(value =>
                        this.resolveExpression(value)
                    )
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
                    ) ?? []),
                    ...(expr.subquery
                        ? this.resolveQueryInputs(expr.subquery)
                        : [])
                ];

            case 'OverExpression':
                return [
                    ...this.resolveExpression(expr.expression),
                    ...(expr.window.partitionBy?.flatMap(partition =>
                        this.resolveExpression(partition)
                    ) ?? []),
                    ...(expr.window.orderBy?.flatMap(order =>
                        this.resolveExpression(order.expression)
                    ) ?? []),
                    ...this.resolveFrameBoundary(expr.window.frame?.from),
                    ...this.resolveFrameBoundary(expr.window.frame?.to)
                ];

            case 'CastExpression':
                return [
                    ...this.resolveExpression(expr.expression),
                    ...(expr.style
                        ? this.resolveExpression(expr.style)
                        : [])
                ];

            case 'SubqueryExpression':
                return this.resolveQueryInputs(expr.query);

            case 'ExistsExpression':
                return this.resolveQueryInputs(expr.query);

            default:
                return [];
        }
    }

    private resolveQueryInputs(
        query: QueryStatement
    ): LineageNode[] {
        return this.visitQuery(query, false)
            .flatMap(column => column.inputs);
    }

    private resolveFrameBoundary(
        boundary: FrameBoundary | null | undefined
    ): LineageNode[] {
        if (!boundary) {
            return [];
        }

        if (
            boundary.type === 'PRECEDING' ||
            boundary.type === 'FOLLOWING'
        ) {
            return this.resolveExpression(boundary.value);
        }

        return [];
    }

    private resolveIdentifier(
        expr: IdentifierNode
    ): LineageNode[] {
        const parts = expr.parts;

        // ------------------------------------------------------------
        // qualified reference: alias.column / table.column
        // ------------------------------------------------------------
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

        // ------------------------------------------------------------
        // unqualified reference: infer source if exactly one visible
        // ------------------------------------------------------------
        const unique = new Map<string, VirtualSource>();

        for (const source of this.currentSources().values()) {
            unique.set(source.name.toLowerCase(), source);
        }

        // exactly one visible source → infer ownership
        if (unique.size === 1) {
            const source = [...unique.values()][0];

            const derived =
                source.columns.get(expr.name.toLowerCase());

            // flatten virtual source lineage
            if (derived) {
                return derived.inputs;
            }

            return [{
                kind: 'column',
                name: `${source.name}.${expr.name}`,
                source: source.name,
                location: expr
            }];
        }

        // ambiguous / unknown
        return [{
            kind: 'column',
            name: expr.name,
            location: expr
        }];
    }

    private resolveWildcard(
        expr: WildcardExpression
    ): LineageNode[] {
        // ------------------------------------------------------------
        // SELECT *
        // Expand to every visible source in current FROM scope.
        // ------------------------------------------------------------
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

            // fallback: malformed / missing FROM
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

        // ------------------------------------------------------------
        // SELECT alias.*
        // ------------------------------------------------------------
        const qualifier = expr.tablePrefix.name;
        const source = this.resolveSource(qualifier);

        // unresolved alias:
        // preserve qualifier instead of degrading to bare *
        if (!source) {
            return [{
                kind: 'column',
                name: `${qualifier}.*`,
                source: qualifier,
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

    private collectWildcardSources(
        cols: DerivedColumn[]
    ): LineageNode[] {
        const seen = new Set<string>();
        const nodes: LineageNode[] = [];

        for (const col of cols) {
            for (const input of col.inputs) {
                if (!input.wildcard) {
                    continue;
                }

                const key = input.name.toLowerCase();

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                nodes.push(input);
            }
        }

        return nodes;
    }

    public resolveExpressionPublic(
        expr: Expression | null | undefined
    ): LineageNode[] {
        return this.resolveExpression(expr);
    }

    private resolveUpdateTargetName(stmt: UpdateNode): string {
        if (!stmt.target || stmt.target.type !== 'Identifier') {
            return '';
        }

        const targetName = stmt.target.name;

        const source = this.resolveSource(targetName);

        return source?.name ?? targetName;
    }
}

