// ===============================
// Core Contracts
// ===============================

export type NodeLocation = {
    start: number;
    end: number;
};

export interface ASTNode extends NodeLocation {
    type: string;
}

export interface Recoverable {
    incomplete?: boolean;
    errors?: string[];
}

export interface ParseIssue {
    code: string;
    message: string;
    start: number;
    end: number;
}

// ===============================
// Program Root
// ===============================

export interface Program extends NodeLocation {
    type: 'Program';
    body: Statement[];
}

export interface ParseResult {
    ast: Program;
    issues?: ParseIssue[];
}

// ===============================
// Expressions
// ===============================

export type Expression =
    | BinaryExpression
    | UnaryExpression
    | LiteralNode
    | IdentifierNode
    | VariableNode
    | FunctionCallNode
    | CaseExpression
    | InExpression
    | BetweenExpression
    | GroupingExpression
    | SubqueryExpression
    | OverExpression
    | MemberExpression
    | WildcardExpression
    | CastExpression;

export interface BinaryExpression extends NodeLocation, Recoverable {
    type: 'BinaryExpression';
    left: Expression;
    operator: string;
    right: Expression | null;
}

export interface UnaryExpression extends NodeLocation, Recoverable {
    type: 'UnaryExpression';
    operator: string;
    right: Expression | null;
}

export interface LiteralNode extends NodeLocation {
    type: 'Literal';
    value: string | number | null;
    variant: 'string' | 'number' | 'null';
}

export interface IdentifierNode extends NodeLocation, Recoverable {
    type: 'Identifier';
    name: string;
    parts: string[];
    tablePrefix?: string;
}

export interface VariableNode extends NodeLocation {
    type: 'Variable';
    name: string;
}

export interface FunctionCallNode extends NodeLocation, Recoverable {
    type: 'FunctionCall';
    name: string;
    args: Expression[];
}

export interface CaseBranch {
    when: Expression | null;
    then: Expression | null;
}

export interface CaseExpression extends NodeLocation, Recoverable {
    type: 'CaseExpression';
    input?: Expression;
    branches: CaseBranch[];
    elseBranch?: Expression;
}

export interface InExpression extends NodeLocation, Recoverable {
    type: 'InExpression';
    left: Expression;
    list?: Expression[];
    subquery?: QueryStatement;
    isNot: boolean;
}

export interface BetweenExpression extends NodeLocation {
    type: 'BetweenExpression';
    left: Expression;
    lowerBound: Expression;
    upperBound: Expression;
    isNot: boolean;
}

export interface GroupingExpression extends NodeLocation, Recoverable {
    type: 'GroupingExpression';
    expression: Expression | null;
}

export interface SubqueryExpression extends NodeLocation {
    type: 'SubqueryExpression';
    query: QueryStatement;
}

export interface MemberExpression extends NodeLocation {
    type: 'MemberExpression';
    object: Expression;
    property: string;
    name: string;
}

export interface WildcardExpression extends NodeLocation {
    type: 'WildcardExpression';
    tablePrefix?: IdentifierNode;
}

// ===============================
// Window / OVER
// ===============================

export interface WindowDefinition extends NodeLocation, Recoverable {
    type: 'WindowDefinition';
    partitionBy?: Expression[];
    orderBy?: OrderByNode[];
}

export interface OverExpression extends NodeLocation {
    type: 'OverExpression';
    expression: Expression;
    window: WindowDefinition;
}

// ===============================
// Query & Statements
// ===============================

export type QueryStatement = SelectNode | SetOperatorNode;

export type Statement = (
    QueryStatement |
    InsertNode |
    UpdateNode |
    DeleteNode |
    MergeNode |
    DeclareNode |
    SetNode |
    CreateNode |
    DropNode |
    IfNode |
    BlockNode |
    WithNode |
    PrintNode |
    ErrorNode |
    ReturnNode |
    RaiseErrorNode |
    ExecuteNode
) & NodeLocation;

// ===============================
// SELECT
// ===============================

export interface SelectNode extends NodeLocation, Recoverable {
    type: 'SelectStatement';
    distinct: boolean;
    top: string | null;
    columns: ColumnNode[];
    into?: IdentifierNode | null;
    from: TableReference[] | null;
    where: Expression | null;
    groupBy: Expression[] | null;
    having: Expression | null;
    orderBy: OrderByNode[] | null;

    offset?: Expression | null;
    fetch?: Expression | null;
}

// ===============================
// Set Operators
// ===============================

export interface SetOperatorNode extends NodeLocation, Recoverable {
    type: 'SetOperator';
    operator: 'UNION' | 'UNION ALL' | 'EXCEPT' | 'INTERSECT';
    left: QueryStatement;
    right: QueryStatement;
}

// ===============================
// INSERT / UPDATE / DELETE
// ===============================

export interface InsertNode extends NodeLocation, Recoverable {
    type: 'InsertStatement';
    table: Expression | null;
    columns: string[] | null;
    columnNodes: IdentifierNode[] | null;
    output?: OutputClauseNode;
    values: Expression[][] | null;
    selectQuery: QueryStatement | null;
}

export interface UpdateAssignment extends NodeLocation {
    type: 'UpdateAssignment';
    column: string;
    columnNode: IdentifierNode | null;
    value: Expression | null;
}

export interface UpdateNode extends NodeLocation, Recoverable {
    type: 'UpdateStatement';
    target: Expression | null;
    assignments: UpdateAssignment[] | null;
    output?: OutputClauseNode;
    from: TableReference[] | null;
    where: Expression | null;
}

export interface DeleteNode extends NodeLocation, Recoverable {
    type: 'DeleteStatement';
    target: Expression | null;
    output?: OutputClauseNode;
    from: TableReference[] | null;
    where: Expression | null;
}

// ===============================
// MERGE
// ===============================

export type MergeMatchType =
    | 'MATCHED'
    | 'NOT MATCHED'
    | 'NOT MATCHED BY SOURCE';

export interface MergeInsertAction extends NodeLocation, Recoverable {
    type: 'MergeInsertAction';
    columns?: string[] | null;
    columnNodes?: IdentifierNode[] | null;
    values?: Expression[] | null;
    selectQuery?: QueryStatement | null;
}

export interface MergeUpdateAction extends NodeLocation, Recoverable {
    type: 'MergeUpdateAction';
    assignments: UpdateAssignment[] | null;
}

export interface MergeDeleteAction extends NodeLocation {
    type: 'MergeDeleteAction';
}

export type MergeAction =
    | MergeInsertAction
    | MergeUpdateAction
    | MergeDeleteAction;

export interface MergeWhenClause extends NodeLocation, Recoverable {
    type: 'MergeWhenClause';
    condition: MergeMatchType;
    predicate?: Expression | null;
    action: MergeAction;
}

export interface MergeNode extends NodeLocation, Recoverable {
    type: 'MergeStatement';
    top?: string | null;
    target: Expression | null;
    targetAlias?: string;
    using: TableReference | null;
    on: Expression | null;
    whenClauses: MergeWhenClause[];
    output?: OutputClauseNode;
}

// ===============================
// DECLARE / SET
// ===============================

export interface VariableDeclaration extends NodeLocation {
    name: string;
    dataType: string;
    initialValue?: Expression;
    columns?: ColumnDefinition[] | null;
}

export interface DeclareNode extends NodeLocation, Recoverable {
    type: 'DeclareStatement';
    variables: VariableDeclaration[];
}

export interface SetNode extends NodeLocation, Recoverable {
    type: 'SetStatement';
    variable: string;
    variableStart: number;
    variableEnd: number;
    value: Expression | null;
}

// ===============================
// CONTROL FLOW
// ===============================

export interface IfNode extends NodeLocation, Recoverable {
    type: 'IfStatement';
    condition: Expression;
    thenBranch: Statement | Statement[];
    elseBranch?: Statement | Statement[];
}

export interface BlockNode extends NodeLocation, Recoverable {
    type: 'BlockStatement';
    body: Statement[];
}

// ===============================
// CREATE / DDL
// ===============================

export interface ColumnDefinition extends NodeLocation {
    name: string;
    dataType: string;
    constraints?: string[];
}

export interface ParameterDefinition extends NodeLocation {
    name: string;
    dataType: string;
    defaultValue?: Expression | null;
    isOutput?: boolean;
    isReadOnly?: boolean;
}

export interface CreateNode extends NodeLocation, Recoverable {
    type: 'CreateStatement';
    objectType: 'TABLE' | 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TYPE';
    orAlter: boolean;
    name: string;
    nameNode: IdentifierNode;
    columns?: ColumnDefinition[];
    parameters?: ParameterDefinition[];
    body?: Statement | Statement[];
    isTableType?: boolean;
}

// ===============================
// DROP
// ===============================

export interface DropNode extends NodeLocation, Recoverable {
    type: 'DropStatement';
    objectType: 'TABLE' | 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'INDEX';
    target: IdentifierNode | null;
}

// ===============================
// WITH / CTE
// ===============================


export interface CTENode extends NodeLocation, Recoverable {
    name: string;
    columns?: string[];
    query: QueryStatement;
}

export interface WithNode extends NodeLocation, Recoverable {
    type: 'WithStatement';
    ctes: CTENode[];
    body: Statement;
}

// ===============================
// PRINT
// ===============================

export interface PrintNode extends NodeLocation, Recoverable {
    type: 'PrintStatement';
    value: Expression | null;
}

// ===============================
// ERROR
// ===============================

export interface ErrorNode extends NodeLocation {
    type: 'ErrorStatement';
    message: string;
}

// ===============================
// TABLE / JOIN / ORDER
// ===============================

export interface TableReference extends NodeLocation, Recoverable {
    type: 'TableReference';
    table: Expression | null;
    alias?: string;
    schema?: string;
    hints?: string[];
    joins: JoinNode[];
}

export type JoinType =
    | 'INNER JOIN'
    | 'LEFT OUTER JOIN'
    | 'RIGHT OUTER JOIN'
    | 'FULL OUTER JOIN'
    | 'CROSS JOIN'
    | 'CROSS APPLY'
    | 'OUTER APPLY';

export interface JoinNode extends NodeLocation, Recoverable {
    type: JoinType;
    rawType: string;
    table: Expression | null;
    on: Expression | null;
    hints?: string[];
    alias?: string;
}

export interface ColumnNode extends NodeLocation {
    type: 'Column';
    expression: Expression;
    sourceName?: string;
    alias?: string;
    outputName: string;
    wildcard?: boolean;
}

export interface OrderByNode extends NodeLocation {
    expression: Expression;
    direction: 'ASC' | 'DESC';
}

// ===============================
// OUTPUT
// ===============================

export interface OutputColumnNode extends NodeLocation {
    type: 'OutputColumn';
    sourceTable: 'INSERTED' | 'DELETED' | null;
    sourceLocation?: NodeLocation;
    column: ColumnNode;
}

export interface OutputClauseNode extends NodeLocation, Recoverable {
    type: 'OutputClause';
    columns: OutputColumnNode[];
    intoTable?: Expression;
    intoColumns?: string[];
    intoColumnNodes?: IdentifierNode[];
}

export interface ReturnNode extends NodeLocation, Recoverable {
    type: 'ReturnStatement';
    value?: Expression | null;
}

export interface RaiseErrorNode extends NodeLocation, Recoverable {
    type: 'RaiseErrorStatement';
    args: Expression[];
    options?: string[];
}

export type ExecArgument = {
    name?: string;
    value: Expression | null;
};

export interface ExecuteNode extends NodeLocation, Recoverable {
    type: 'ExecuteStatement';
    target: Expression | null;
    args: ExecArgument[];
}

export interface CastExpression extends NodeLocation, Recoverable {
    type: 'CastExpression';
    kind: 'CAST' | 'TRY_CAST' | 'CONVERT';
    expression: Expression;
    dataType: string;
}