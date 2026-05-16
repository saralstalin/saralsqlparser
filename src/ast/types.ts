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
    | CastExpression
    | ExistsExpression
    | ValuesTableExpression;

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
    withinGroup?: OrderByNode[];
    openJsonWith?: OpenJsonColumnDefinition[];
}

export interface PivotClause extends NodeLocation, Recoverable {
    type: 'PivotClause';
    aggregate: Expression | null;
    forColumn: IdentifierNode | null;
    inColumns: IdentifierNode[];
    sourceAlias?: string;
}

export interface UnpivotClause extends NodeLocation, Recoverable {
    type: 'UnpivotClause';
    valueColumn: IdentifierNode | null;
    forColumn: IdentifierNode | null;
    inColumns: IdentifierNode[];
    sourceAlias?: string;
}

export interface OpenJsonColumnDefinition extends NodeLocation, Recoverable {
    name: string;
    dataType: string;
    path?: string;
    asJson?: boolean;
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

export interface ValuesTableExpression extends NodeLocation, Recoverable {
    type: 'ValuesTableExpression';
    rows: Expression[][];
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
    frame?: FrameClause | null;
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
    ExecuteNode |
    WhileNode |
    TryCatchNode |   
    ThrowNode | 
    BreakNode | 
    ContinueNode |
    GotoNode |
    LabelNode |
    WaitForNode |
    DeclareCursorNode |
    OpenCursorNode |
    FetchCursorNode |
    CloseCursorNode |
    DeallocateCursorNode |
    CreateIndexNode |
    TransactionNode |
    AlterTableNode |
    TruncateNode
) & NodeLocation;

// ===============================
// SELECT
// ===============================

export interface SelectNode extends NodeLocation, Recoverable {
    type: 'SelectStatement';
    distinct: boolean;
    top: TopClause  | null;
    columns: ColumnNode[];
    into?: IdentifierNode | null;
    from: TableReference[] | null;
    where: Expression | null;
    groupBy: Expression[] | null;
    having: Expression | null;
    orderBy: OrderByNode[] | null;

    offset?: Expression | null;
    fetch?: Expression | null;
    forClause?: ForClause | null;
    optionClause?: OptionClause | null;
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
    top?: TopClause | null;
    target: Expression | null;
    assignments: UpdateAssignment[] | null;
    output?: OutputClauseNode;
    from: TableReference[] | null;
    where: Expression | null;
    optionClause?: OptionClause | null;
}

export interface DeleteNode extends NodeLocation, Recoverable {
    type: 'DeleteStatement';
    top?: TopClause | null;
    target: Expression | null;
    output?: OutputClauseNode;
    from: TableReference[] | null;
    where: Expression | null;
    optionClause?: OptionClause | null;
}

// ===============================
// MERGE
// ===============================

export type MergeMatchType =
    | 'MATCHED'
    | 'NOT MATCHED'
    | 'NOT MATCHED BY SOURCE'
    | 'NOT MATCHED BY TARGET';

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
    top?: TopClause | null;
    target: Expression | null;
    targetAlias?: string;
    using: TableReference | null;
    on: Expression | null;
    whenClauses: MergeWhenClause[];
    output?: OutputClauseNode;
    optionClause?: OptionClause | null;
}

// ===============================
// DECLARE / SET
// ===============================

export interface VariableDeclaration extends NodeLocation {
    name: string;
    dataType: string;
    columns?: ColumnDefinition[] | null;
    constraints?: ConstraintNode[];
    initialValue?: Expression;
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
    computedExpression?: Expression | null;
    persisted?: boolean;
    constraints?: ConstraintNode[];
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
    constraints?: ConstraintNode[];
    parameters?: ParameterDefinition[];
    body?: Statement | Statement[];
    isTableType?: boolean;
}

// ===============================
// DROP
// ===============================

export interface DropNode extends NodeLocation, Recoverable {
    type: 'DropStatement';
    ifExists?: boolean;
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
    aliasColumns?: string[];
    schema?: string;
    hints?: string[];
    pivot?: PivotClause | null;
    unpivot?: UnpivotClause | null;
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

export type JoinHint = 'HASH' | 'MERGE' | 'LOOP';

export interface JoinNode extends NodeLocation, Recoverable {
    type: JoinType;
    rawType: string;
    joinHint?: JoinHint;
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
    isOutput?: boolean;
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

export interface ConstraintNode extends NodeLocation, Recoverable {
    name?: string;

    kind:
    | 'PRIMARY KEY'
    | 'FOREIGN KEY'
    | 'UNIQUE'
    | 'CHECK'
    | 'DEFAULT'
    | 'NOT NULL'
    | 'NULL'
    | 'IDENTITY';

    columns?: string[];
    expression?: Expression | null;

    referencesTable?: string;
    referencesColumns?: string[];

    seed?: number;
    increment?: number;
    missingLeadingComma?: boolean;
}

export interface WhileNode extends NodeLocation, Recoverable {
    type: 'WhileStatement';
    condition: Expression | null;
    body: Statement | null;
}

// Index column with optional direction
export interface IndexColumnNode extends NodeLocation {
    type: 'IndexColumn';
    name: string;
    nameNode: IdentifierNode;
    direction: 'ASC' | 'DESC';
}

// WITH option: ONLINE = ON, FILLFACTOR = 80, etc.
export interface IndexOptionNode extends NodeLocation {
    type: 'IndexOption';
    name: string;
    value: string;  // raw string — ON/OFF/number
}

// Index creation statement
export interface CreateIndexNode extends NodeLocation, Recoverable {
    type: 'CreateIndexStatement';
    unique: boolean;
    clustered: 'CLUSTERED' | 'NONCLUSTERED' | null;
    name: string;
    nameNode: IdentifierNode;
    table: IdentifierNode;
    columns: IndexColumnNode[];
    include?: IdentifierNode[];
    where?: Expression;
    options?: IndexOptionNode[];
}

// ===============================
// TRY / CATCH
// ===============================

export interface TryCatchNode extends NodeLocation, Recoverable {
    type: 'TryCatchStatement';
    tryBlock: BlockNode;
    catchBlock: BlockNode;
}

// ===============================
// THROW
// ===============================

export interface ThrowNode extends NodeLocation, Recoverable {
    type: 'ThrowStatement';
    // Arguments are optional — bare THROW re-throws inside a CATCH
    errorNumber?: Expression | null;
    message?: Expression | null;
    state?: Expression | null;
}

// ===============================
// BREAK / CONTINUE
// ===============================

export interface BreakNode extends NodeLocation {
    type: 'BreakStatement';
}

export interface ContinueNode extends NodeLocation {
    type: 'ContinueStatement';
}

export interface GotoNode extends NodeLocation, Recoverable {
    type: 'GotoStatement';
    label: string | null;
}

export interface LabelNode extends NodeLocation {
    type: 'LabelStatement';
    name: string;
}

export interface WaitForNode extends NodeLocation, Recoverable {
    type: 'WaitForStatement';
    kind: 'TIME' | 'DELAY' | null;
    value: Expression | null;
}

export interface DeclareCursorNode extends NodeLocation, Recoverable {
    type: 'DeclareCursorStatement';
    name: string | null;
    options?: string[];
    query: QueryStatement | null;
}

export interface OpenCursorNode extends NodeLocation, Recoverable {
    type: 'OpenCursorStatement';
    name: string | null;
}

export interface FetchCursorNode extends NodeLocation, Recoverable {
    type: 'FetchCursorStatement';
    direction?: string;
    offset?: Expression | null;
    name: string | null;
    into?: string[];
}

export interface CloseCursorNode extends NodeLocation, Recoverable {
    type: 'CloseCursorStatement';
    name: string | null;
}

export interface DeallocateCursorNode extends NodeLocation, Recoverable {
    type: 'DeallocateCursorStatement';
    name: string | null;
}

export type ForJsonDirective =
    | 'AUTO'
    | 'PATH';

export type ForXmlDirective =
    | 'AUTO'
    | 'PATH'
    | 'RAW'
    | 'EXPLICIT';

export type ForJsonOption =
    | { kind: 'ROOT'; value?: string }
    | { kind: 'INCLUDE_NULL_VALUES' }
    | { kind: 'WITHOUT_ARRAY_WRAPPER' }
    | { kind: 'UNKNOWN'; value: string };

export type ForXmlOption =
    | { kind: 'TYPE' }
    | { kind: 'ELEMENTS'; xsinil?: boolean }
    | { kind: 'ROOT'; value?: string }
    | { kind: 'BINARY_BASE64' }
    | { kind: 'XMLSCHEMA' }
    | { kind: 'XMLDATA' }
    | { kind: 'UNKNOWN'; value: string };

export type ForClause =
    | {
        mode: 'JSON';
        directive: ForJsonDirective;
        options?: ForJsonOption[];
    }
    | {
        mode: 'XML';
        directive: ForXmlDirective;
        argument?: string;
        options?: ForXmlOption[];
    };

export type QueryHint =
    | { kind: 'RECOMPILE'; raw: string }
    | { kind: 'HASH_JOIN'; raw: string }
    | { kind: 'MERGE_JOIN'; raw: string }
    | { kind: 'LOOP_JOIN'; raw: string }
    | { kind: 'HASH_GROUP'; raw: string }
    | { kind: 'ORDER_GROUP'; raw: string }
    | { kind: 'MERGE_UNION'; raw: string }
    | { kind: 'CONCAT_UNION'; raw: string }
    | { kind: 'FORCE_ORDER'; raw: string }
    | { kind: 'KEEP_PLAN'; raw: string }
    | { kind: 'KEEPFIXED_PLAN'; raw: string }
    | { kind: 'ROBUST_PLAN'; raw: string }
    | { kind: 'MAXDOP'; raw: string; value: number }
    | { kind: 'FAST'; raw: string; value: number }
    | { kind: 'MAXRECURSION'; raw: string; value: number }
    | { kind: 'PARAMETERIZATION'; raw: string; value: 'SIMPLE' | 'FORCED' }
    | { kind: 'OPTIMIZE_FOR'; raw: string; value: string }
    | { kind: 'USE_HINT'; raw: string; value: string }
    | { kind: 'UNKNOWN'; raw: string };

export interface OptionClause extends NodeLocation, Recoverable {
    type: 'OptionClause';
    hints: QueryHint[];
}

// ===============================
// TRANSACTIONS
// ===============================

export type TransactionAction =
    | 'BEGIN'
    | 'COMMIT'
    | 'ROLLBACK'
    | 'SAVE';

export interface TransactionNode extends NodeLocation, Recoverable {
    type: 'TransactionStatement';
    action: TransactionAction;
    name?: string;        // optional for BEGIN/COMMIT/ROLLBACK, required for SAVE
    distributed?: boolean; // BEGIN DISTRIBUTED TRANSACTION
}

export interface TopClause extends NodeLocation, Recoverable {
    type: 'TopClause';
    quantity: Expression | null;
    percent: boolean;
    withTies: boolean;
}

export type FrameUnit = 'ROWS' | 'RANGE';

export type FrameBoundary =
    | { type: 'UNBOUNDED_PRECEDING' }
    | { type: 'UNBOUNDED_FOLLOWING' }
    | { type: 'CURRENT_ROW' }
    | { type: 'PRECEDING'; value: Expression }
    | { type: 'FOLLOWING'; value: Expression };

export interface FrameClause extends NodeLocation, Recoverable {
    type: 'FrameClause';
    unit: FrameUnit;
    start: number;
    end: number;
    from: FrameBoundary | null;
    to?: FrameBoundary;  // present when BETWEEN ... AND ... form
}



    // ALTER TABLE
export type AlterTableAction =
    | { kind: 'ADD_COLUMN'; column: ColumnDefinition }
    | { kind: 'DROP_COLUMN'; name: string, ifExists?: boolean }
    | { kind: 'ADD_CONSTRAINT'; constraint: ConstraintNode }
    | { kind: 'DROP_CONSTRAINT'; name: string, ifExists?: boolean }
    | { kind: 'ALTER_COLUMN'; column: ColumnDefinition }; 

export interface AlterTableNode extends NodeLocation, Recoverable {
    type: 'AlterTableStatement';
    table: IdentifierNode;
    action: AlterTableAction | null;
}

// TRUNCATE
export interface TruncateNode extends NodeLocation, Recoverable {
    type: 'TruncateStatement';
    table: IdentifierNode | null;
}

export interface ExistsExpression
    extends NodeLocation, Recoverable {
    type: 'ExistsExpression';
    query: QueryStatement;
}
