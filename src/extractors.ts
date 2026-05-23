import {
    BlockNode,
    CreateNode,
    DeclareNode,
    DeleteNode,
    Expression,
    ExecuteNode,
    IdentifierNode,
    InsertNode,
    NodeLocation,
    OutputClauseNode,
    Program,
    QueryStatement,
    SelectNode,
    Statement,
    TableReference,
    UpdateNode,
    WithNode
} from './ast/types';

export type ExtractedDeclarationKind =
    | 'table'
    | 'view'
    | 'procedure'
    | 'function'
    | 'type'
    | 'cte'
    | 'variable'
    | 'parameter'
    | 'column';

export interface ExtractedDeclaration {
    kind: ExtractedDeclarationKind;
    name: string;
    normalizedName: string;
    location: NodeLocation;
    nameLocation: NodeLocation;
    parentName?: string;
    dataType?: string;
    columns?: ExtractedDeclaration[];
    parameters?: ExtractedDeclaration[];
}

export type ExtractedReferenceKind =
    | 'table'
    | 'column'
    | 'variable'
    | 'function'
    | 'cte'
    | 'unknown';

export type ExtractedReferenceContext =
    | 'from'
    | 'join'
    | 'insert-target'
    | 'update-target'
    | 'delete-target'
    | 'output-into'
    | 'execute-target'
    | 'expression';

export interface ExtractedReference {
    kind: ExtractedReferenceKind;
    context: ExtractedReferenceContext;
    name: string;
    normalizedName: string;
    location: NodeLocation;
    parts?: string[];
}

export interface ExtractedDependency {
    from: string | null;
    to: string;
    normalizedFrom: string | null;
    normalizedTo: string;
    kind: ExtractedReferenceKind;
    context: ExtractedReferenceContext;
    location: NodeLocation;
}

export function extractDeclarations(program: Program): ExtractedDeclaration[] {
    const declarations: ExtractedDeclaration[] = [];

    for (const stmt of program.body) {
        collectDeclarationsFromStatement(stmt, declarations);
    }

    return declarations;
}

export function extractReferences(program: Program): ExtractedReference[] {
    const references: ExtractedReference[] = [];

    for (const stmt of program.body) {
        collectReferencesFromStatement(stmt, references);
    }

    return references;
}

export function extractDependencies(program: Program): ExtractedDependency[] {
    const dependencies: ExtractedDependency[] = [];

    for (const stmt of program.body) {
        if (stmt.type === 'CreateStatement') {
            const from = stmt.name || null;
            const localNames = new Set<string>();

            if (from) {
                localNames.add(normalizeName(from));
            }

            collectCreateLocalNames(stmt, localNames);

            for (const ref of referencesForStatement(stmt)) {
                if (shouldSkipDependency(ref, localNames)) {
                    continue;
                }

                dependencies.push({
                    from,
                    to: ref.name,
                    normalizedFrom: from ? normalizeName(from) : null,
                    normalizedTo: ref.normalizedName,
                    kind: ref.kind,
                    context: ref.context,
                    location: ref.location
                });
            }
        } else {
            const localNames = new Set<string>();
            for (const declaration of declarationsForStatement(stmt)) {
                if (declaration.kind === 'cte' || declaration.kind === 'variable') {
                    localNames.add(declaration.normalizedName);
                }
            }

            for (const ref of referencesForStatement(stmt)) {
                if (shouldSkipDependency(ref, localNames)) {
                    continue;
                }

                dependencies.push({
                    from: null,
                    to: ref.name,
                    normalizedFrom: null,
                    normalizedTo: ref.normalizedName,
                    kind: ref.kind,
                    context: ref.context,
                    location: ref.location
                });
            }
        }
    }

    return uniqueDependencies(dependencies);
}

function declarationsForStatement(stmt: Statement): ExtractedDeclaration[] {
    const declarations: ExtractedDeclaration[] = [];
    collectDeclarationsFromStatement(stmt, declarations);
    return declarations;
}

function collectDeclarationsFromStatement(
    stmt: Statement,
    declarations: ExtractedDeclaration[]
): void {
    switch (stmt.type) {
        case 'BatchSeparatorStatement':
            return;

        case 'CreateStatement':
            declarations.push(createObjectDeclaration(stmt));

            if (Array.isArray(stmt.body)) {
                for (const child of stmt.body) {
                    collectDeclarationsFromStatement(child, declarations);
                }
            } else if (stmt.body) {
                collectDeclarationsFromStatement(stmt.body, declarations);
            }
            return;

        case 'DeclareStatement':
            declarations.push(...declareDeclarations(stmt));
            return;

        case 'WithStatement':
            for (const cte of stmt.ctes) {
                declarations.push({
                    kind: 'cte',
                    name: cte.name,
                    normalizedName: normalizeName(cte.name),
                    location: cte,
                    nameLocation: {
                        start: cte.start,
                        end: cte.start + cte.name.length
                    }
                });
            }
            collectDeclarationsFromStatement(stmt.body, declarations);
            return;

        case 'BlockStatement':
            for (const child of stmt.body) {
                collectDeclarationsFromStatement(child, declarations);
            }
            return;

        case 'IfStatement':
            collectDeclarationsFromBranch(stmt.thenBranch, declarations);
            collectDeclarationsFromBranch(stmt.elseBranch, declarations);
            return;

        case 'TryCatchStatement':
            collectDeclarationsFromStatement(stmt.tryBlock, declarations);
            collectDeclarationsFromStatement(stmt.catchBlock, declarations);
            return;

        case 'WhileStatement':
            if (stmt.body) {
                collectDeclarationsFromStatement(stmt.body, declarations);
            }
            return;

        default:
            return;
    }
}

function collectDeclarationsFromBranch(
    branch: Statement | Statement[] | undefined,
    declarations: ExtractedDeclaration[]
): void {
    if (!branch) return;
    if (Array.isArray(branch)) {
        for (const stmt of branch) {
            collectDeclarationsFromStatement(stmt, declarations);
        }
        return;
    }
    collectDeclarationsFromStatement(branch, declarations);
}

function createObjectDeclaration(stmt: CreateNode): ExtractedDeclaration {
    const name = stmt.name || '<anonymous>';
    const columns = (stmt.columns ?? []).map(column => ({
        kind: 'column' as const,
        name: column.name,
        normalizedName: normalizeName(column.name),
        parentName: name,
        dataType: column.dataType,
        location: column,
        nameLocation: {
            start: column.start,
            end: column.start + column.name.length
        }
    }));

    const parameters = (stmt.parameters ?? []).map(param => ({
        kind: 'parameter' as const,
        name: param.name,
        normalizedName: normalizeName(param.name),
        parentName: name,
        dataType: param.dataType,
        location: param,
        nameLocation: {
            start: param.start,
            end: param.start + param.name.length
        }
    }));

    return {
        kind: createDeclarationKind(stmt),
        name,
        normalizedName: normalizeName(name),
        location: stmt,
        nameLocation: stmt.nameNode,
        ...(columns.length ? { columns } : {}),
        ...(parameters.length ? { parameters } : {})
    };
}

function declareDeclarations(stmt: DeclareNode): ExtractedDeclaration[] {
    return stmt.variables.map(variable => {
        const columns = (variable.columns ?? []).map(column => ({
            kind: 'column' as const,
            name: column.name,
            normalizedName: normalizeName(column.name),
            parentName: variable.name,
            dataType: column.dataType,
            location: column,
            nameLocation: {
                start: column.start,
                end: column.start + column.name.length
            }
        }));

        return {
            kind: 'variable' as const,
            name: variable.name,
            normalizedName: normalizeName(variable.name),
            dataType: variable.dataType,
            location: variable,
            nameLocation: {
                start: variable.start,
                end: variable.start + variable.name.length
            },
            ...(columns.length ? { columns } : {})
        };
    });
}

function collectReferencesFromStatement(
    stmt: Statement,
    references: ExtractedReference[]
): void {
    references.push(...referencesForStatement(stmt));
}

function referencesForStatement(stmt: Statement): ExtractedReference[] {
    const references: ExtractedReference[] = [];

    switch (stmt.type) {
        case 'BatchSeparatorStatement':
            break;

        case 'SelectStatement':
            collectReferencesFromSelect(stmt, references);
            break;

        case 'SetOperator':
            collectReferencesFromQuery(stmt.left, references);
            collectReferencesFromQuery(stmt.right, references);
            break;

        case 'WithStatement':
            for (const cte of stmt.ctes) {
                collectReferencesFromQuery(cte.query, references);
            }
            collectReferencesFromStatement(stmt.body, references);
            break;

        case 'InsertStatement':
            collectReferencesFromInsert(stmt, references);
            break;

        case 'UpdateStatement':
            collectReferencesFromUpdate(stmt, references);
            break;

        case 'DeleteStatement':
            collectReferencesFromDelete(stmt, references);
            break;

        case 'CreateStatement':
            collectReferencesFromCreate(stmt, references);
            break;

        case 'DeclareStatement':
            for (const variable of stmt.variables) {
                collectReferencesFromExpression(variable.initialValue, references);
            }
            break;

        case 'SetStatement':
            collectReferencesFromExpression(stmt.value, references);
            break;

        case 'PrintStatement':
            collectReferencesFromExpression(stmt.value, references);
            break;

        case 'ExecuteStatement':
            collectReferencesFromExecute(stmt, references);
            break;

        case 'IfStatement':
            collectReferencesFromExpression(stmt.condition, references);
            collectReferencesFromBranch(stmt.thenBranch, references);
            collectReferencesFromBranch(stmt.elseBranch, references);
            break;

        case 'WhileStatement':
            collectReferencesFromExpression(stmt.condition, references);
            if (stmt.body) collectReferencesFromStatement(stmt.body, references);
            break;

        case 'TryCatchStatement':
            collectReferencesFromStatement(stmt.tryBlock, references);
            collectReferencesFromStatement(stmt.catchBlock, references);
            break;

        case 'ReturnStatement':
            collectReferencesFromExpression(stmt.value, references);
            if (stmt.query) collectReferencesFromStatement(stmt.query, references);
            break;

        case 'ThrowStatement':
            collectReferencesFromExpression(stmt.errorNumber, references);
            collectReferencesFromExpression(stmt.message, references);
            collectReferencesFromExpression(stmt.state, references);
            break;

        case 'RaiseErrorStatement':
            for (const arg of stmt.args) {
                collectReferencesFromExpression(arg, references);
            }
            break;

        case 'WaitForStatement':
            collectReferencesFromExpression(stmt.value, references);
            break;

        case 'BlockStatement':
            for (const child of stmt.body) {
                collectReferencesFromStatement(child, references);
            }
            break;
    }

    return uniqueReferences(references);
}

function collectReferencesFromBranch(
    branch: Statement | Statement[] | undefined,
    references: ExtractedReference[]
): void {
    if (!branch) return;
    if (Array.isArray(branch)) {
        for (const stmt of branch) {
            collectReferencesFromStatement(stmt, references);
        }
        return;
    }
    collectReferencesFromStatement(branch, references);
}

function collectReferencesFromQuery(
    query: QueryStatement | null | undefined,
    references: ExtractedReference[]
): void {
    if (!query) return;

    if (query.type === 'SetOperator') {
        collectReferencesFromQuery(query.left, references);
        collectReferencesFromQuery(query.right, references);
        return;
    }

    collectReferencesFromSelect(query, references);
}

function collectReferencesFromCreate(
    stmt: CreateNode,
    references: ExtractedReference[]
): void {
    if (Array.isArray(stmt.body)) {
        for (const child of stmt.body) {
            collectReferencesFromStatement(child, references);
        }
    } else if (stmt.body) {
        collectReferencesFromStatement(stmt.body, references);
    }
}

function collectReferencesFromSelect(
    stmt: SelectNode,
    references: ExtractedReference[]
): void {
    for (const table of stmt.from ?? []) {
        collectReferencesFromTableReference(table, references, 'from');
    }

    for (const col of stmt.columns) {
        collectReferencesFromExpression(col.expression, references);
    }

    collectReferencesFromExpression(stmt.where, references);
    collectReferencesFromExpression(stmt.having, references);

    for (const expr of stmt.groupBy ?? []) {
        collectReferencesFromExpression(expr, references);
    }

    for (const order of stmt.orderBy ?? []) {
        collectReferencesFromExpression(order.expression, references);
    }
}

function collectReferencesFromInsert(
    stmt: InsertNode,
    references: ExtractedReference[]
): void {
    addObjectReference(stmt.table, references, 'insert-target');

    for (const row of stmt.values ?? []) {
        for (const expr of row) {
            collectReferencesFromExpression(expr, references);
        }
    }

    collectReferencesFromQuery(stmt.selectQuery, references);
    collectReferencesFromOutput(stmt.output, references);
}

function collectReferencesFromUpdate(
    stmt: UpdateNode,
    references: ExtractedReference[]
): void {
    addObjectReference(stmt.target, references, 'update-target');

    for (const assignment of stmt.assignments ?? []) {
        collectReferencesFromExpression(assignment.value, references);
    }

    for (const table of stmt.from ?? []) {
        collectReferencesFromTableReference(table, references, 'from');
    }

    collectReferencesFromExpression(stmt.where, references);
    collectReferencesFromOutput(stmt.output, references);
}

function collectReferencesFromDelete(
    stmt: DeleteNode,
    references: ExtractedReference[]
): void {
    addObjectReference(stmt.target, references, 'delete-target');

    for (const table of stmt.from ?? []) {
        collectReferencesFromTableReference(table, references, 'from');
    }

    collectReferencesFromExpression(stmt.where, references);
    collectReferencesFromOutput(stmt.output, references);
}

function collectReferencesFromExecute(
    stmt: ExecuteNode,
    references: ExtractedReference[]
): void {
    addObjectReference(stmt.target, references, 'execute-target');

    for (const arg of stmt.args ?? []) {
        collectReferencesFromExpression(arg.value, references);
    }
}

function collectReferencesFromOutput(
    output: OutputClauseNode | undefined,
    references: ExtractedReference[]
): void {
    if (!output) return;

    addObjectReference(output.intoTable, references, 'output-into');

    for (const col of output.columns) {
        if (col.sourceTable) {
            const expr = col.column.expression;
            let member = col.column.outputName;

            if (expr.type === 'Identifier' && expr.parts.length > 0) {
                member = expr.parts[expr.parts.length - 1];
            } else if (col.column.wildcard) {
                member = '*';
            }

            const qualifiedName = `${col.sourceTable}.${member}`;
            references.push({
                kind: 'column',
                context: 'expression',
                name: qualifiedName,
                normalizedName: normalizeName(qualifiedName),
                location: col.sourceLocation ?? expr,
                parts: [col.sourceTable, member]
            });
        }

        collectReferencesFromExpression(col.column.expression, references);
    }
}

function collectReferencesFromTableReference(
    ref: TableReference,
    references: ExtractedReference[],
    context: ExtractedReferenceContext
): void {
    if (ref.table?.type === 'TableReference') {
        collectReferencesFromTableReference(ref.table, references, context);
    } else {
        addObjectReference(ref.table, references, context);
    }

    if (ref.table?.type === 'SubqueryExpression') {
        collectReferencesFromQuery(ref.table.query, references);
    }

    for (const join of ref.joins) {
        if (join.table?.type === 'TableReference') {
            collectReferencesFromTableReference(join.table, references, 'join');
        } else {
            addObjectReference(join.table, references, 'join');
        }

        if (join.table?.type === 'SubqueryExpression') {
            collectReferencesFromQuery(join.table.query, references);
        }

        collectReferencesFromExpression(join.on, references);
    }
}

function collectReferencesFromExpression(
    expr: Expression | null | undefined,
    references: ExtractedReference[]
): void {
    if (!expr) return;

    switch (expr.type) {
        case 'Identifier':
            addIdentifierReference(expr, references, inferIdentifierKind(expr), 'expression');
            return;

        case 'Variable':
            references.push({
                kind: 'variable',
                context: 'expression',
                name: expr.name,
                normalizedName: normalizeName(expr.name),
                location: expr
            });
            return;

        case 'FunctionCall':
            references.push({
                kind: 'function',
                context: 'expression',
                name: expr.name,
                normalizedName: normalizeName(expr.name),
                location: expr
            });
            for (const arg of expr.args) {
                collectReferencesFromExpression(arg, references);
            }
            return;

        case 'BinaryExpression':
            collectReferencesFromExpression(expr.left, references);
            collectReferencesFromExpression(expr.right, references);
            return;

        case 'UnaryExpression':
            collectReferencesFromExpression(expr.right, references);
            return;

        case 'GroupingExpression':
            collectReferencesFromExpression(expr.expression, references);
            return;

        case 'SubqueryExpression':
            collectReferencesFromQuery(expr.query, references);
            return;

        case 'ValuesTableExpression':
            for (const row of expr.rows) {
                for (const value of row) {
                    collectReferencesFromExpression(value, references);
                }
            }
            return;

        case 'OverExpression':
            collectReferencesFromExpression(expr.expression, references);
            for (const partition of expr.window.partitionBy ?? []) {
                collectReferencesFromExpression(partition, references);
            }
            for (const order of expr.window.orderBy ?? []) {
                collectReferencesFromExpression(order.expression, references);
            }
            return;

        case 'MemberExpression':
            collectReferencesFromExpression(expr.object, references);
            return;

        case 'WildcardExpression':
            if (expr.tablePrefix) {
                addIdentifierReference(expr.tablePrefix, references, 'unknown', 'expression');
            }
            return;

        case 'CaseExpression':
            collectReferencesFromExpression(expr.input, references);
            for (const branch of expr.branches) {
                collectReferencesFromExpression(branch.when, references);
                collectReferencesFromExpression(branch.then, references);
            }
            collectReferencesFromExpression(expr.elseBranch, references);
            return;

        case 'InExpression':
            collectReferencesFromExpression(expr.left, references);
            for (const item of expr.list ?? []) {
                collectReferencesFromExpression(item, references);
            }
            collectReferencesFromQuery(expr.subquery, references);
            return;

        case 'BetweenExpression':
            collectReferencesFromExpression(expr.left, references);
            collectReferencesFromExpression(expr.lowerBound, references);
            collectReferencesFromExpression(expr.upperBound, references);
            return;

        case 'Literal':
            return;
    }
}

function addObjectReference(
    expr: Expression | null | undefined,
    references: ExtractedReference[],
    context: ExtractedReferenceContext
): void {
    if (!expr) return;

    if (expr.type === 'Identifier') {
        addIdentifierReference(expr, references, 'table', context);
        return;
    }

    collectReferencesFromExpression(expr, references);
}

function addIdentifierReference(
    expr: IdentifierNode,
    references: ExtractedReference[],
    kind: ExtractedReferenceKind,
    context: ExtractedReferenceContext
): void {
    references.push({
        kind,
        context,
        name: expr.name,
        normalizedName: normalizeName(expr.name),
        location: expr,
        parts: expr.parts
    });
}

function collectCreateLocalNames(
    stmt: CreateNode,
    localNames: Set<string>
): void {
    for (const param of stmt.parameters ?? []) {
        localNames.add(normalizeName(param.name));
    }

    for (const column of stmt.columns ?? []) {
        localNames.add(normalizeName(column.name));
    }

    for (const child of extractDeclarationsFromCreateBody(stmt)) {
        if (child.kind === 'cte' || child.kind === 'variable') {
            localNames.add(child.normalizedName);
        }
    }
}

function extractDeclarationsFromCreateBody(
    stmt: CreateNode
): ExtractedDeclaration[] {
    const declarations: ExtractedDeclaration[] = [];

    if (Array.isArray(stmt.body)) {
        for (const child of stmt.body) {
            collectDeclarationsFromStatement(child, declarations);
        }
    } else if (stmt.body) {
        collectDeclarationsFromStatement(stmt.body, declarations);
    }

    return declarations;
}

function createDeclarationKind(stmt: CreateNode): ExtractedDeclarationKind {
    switch (stmt.objectType) {
        case 'VIEW':
            return 'view';
        case 'PROCEDURE':
            return 'procedure';
        case 'FUNCTION':
            return 'function';
        case 'TYPE':
            return 'type';
        case 'TABLE':
        default:
            return 'table';
    }
}

function inferIdentifierKind(expr: IdentifierNode): ExtractedReferenceKind {
    if (expr.parts.length > 1) return 'column';
    return 'unknown';
}

function normalizeName(name: string): string {
    return name
        .split('.')
        .map(part => part.replace(/^\[|\]$/g, '').toLowerCase())
        .join('.');
}

function uniqueReferences(
    references: ExtractedReference[]
): ExtractedReference[] {
    const seen = new Set<string>();
    const unique: ExtractedReference[] = [];

    for (const ref of references) {
        const key = [
            ref.kind,
            ref.context,
            ref.normalizedName,
            ref.location.start,
            ref.location.end
        ].join('|');

        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(ref);
    }

    return unique;
}

function uniqueDependencies(
    dependencies: ExtractedDependency[]
): ExtractedDependency[] {
    const seen = new Set<string>();
    const unique: ExtractedDependency[] = [];

    for (const dep of dependencies) {
        const key = [
            dep.normalizedFrom ?? '',
            dep.normalizedTo,
            dep.kind,
            dep.context
        ].join('|');

        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(dep);
    }

    return unique;
}

function shouldSkipDependency(
    ref: ExtractedReference,
    localNames: Set<string>
): boolean {
    return (
        ref.kind === 'variable' ||
        ref.kind === 'column' ||
        ref.kind === 'unknown' ||
        localNames.has(ref.normalizedName)
    );
}
