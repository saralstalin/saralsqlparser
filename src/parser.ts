import { Lexer, Token, TokenType } from './lexer';

export type NodeLocation = {
    start: number;
    end: number;
};

export interface ParseIssue {
    code: string;
    start: number;
    end: number;
}

export interface Recoverable {
    /**
     * True when parser intentionally emitted a partial node
     * instead of failing the whole statement.
     */
    incomplete?: boolean;

    /**
     * Optional lightweight parse issues attached to this node.
     * Keep human-readable.
     */
    errors?: string[];
}

export interface BinaryExpression extends NodeLocation, Recoverable {
    type: 'BinaryExpression';
    left: Expression;
    operator: string;
    right: Expression | null;   // recoverable
}

export interface LiteralNode extends NodeLocation {
    type: 'Literal';
    value: string | number | null;
    variant: 'string' | 'number' | 'null';
}

export interface FunctionCallNode extends NodeLocation, Recoverable {
    type: 'FunctionCall';
    name: string;
    args: Expression[];
}

export interface CaseBranch {
    when: Expression | null;   // recoverable
    then: Expression | null;   // recoverable
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

export interface GroupingExpression extends NodeLocation, Recoverable {
    type: 'GroupingExpression';
    expression: Expression | null;   // recoverable
}

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
    | MemberExpression;

export interface JoinNode extends NodeLocation, Recoverable {
    type: JoinType;
    rawType: string; // The actual keyword(s) by user (e.g., "LEFT JOIN", "JOIN")
    table: Expression | null; // Can be null if the join clause is incomplete
    on: Expression | null;
    hints?: string[];
    alias?: string;
}

export interface PrintNode extends NodeLocation, Recoverable {
    type: 'PrintStatement';
    value: Expression | null; // recoverable
}

export interface ColumnNode extends NodeLocation {
    type: 'Column';
    expression: Expression;
    tablePrefix?: Expression;
    name: string;
    alias?: string;
}

export interface IfNode extends NodeLocation {
    type: 'IfStatement';
    condition: Expression;
    thenBranch: Statement | Statement[];
    elseBranch?: Statement | Statement[];
}

export interface BlockNode extends NodeLocation {
    type: 'BlockStatement';
    body: Statement[];
}

export interface UnaryExpression extends NodeLocation, Recoverable {
    type: 'UnaryExpression';
    operator: string;
    right: Expression | null;    // recoverable
}

// Fix naming collision: Bound expressions vs Node offsets
export interface BetweenExpression extends NodeLocation {
    type: 'BetweenExpression';
    left: Expression;
    lowerBound: Expression; // Renamed from start
    upperBound: Expression; // Renamed from end
    isNot: boolean;
}

export interface SubqueryExpression extends NodeLocation {
    type: 'SubqueryExpression';
    query: QueryStatement;
}

export interface MemberExpression extends NodeLocation {
    type: 'MemberExpression';
    object: Expression;
    property: string;
    name: string; // The flattened string (e.g., "dbo.Table")
}
export type QueryStatement = SelectNode | SetOperatorNode;
export type Statement = (QueryStatement | InsertNode | UpdateNode | DeleteNode | DeclareNode | SetNode | CreateNode | IfNode | BlockNode | WithNode | PrintNode | ErrorNode) & NodeLocation;

export interface Program {
    type: 'Program';
    body: Statement[];
}

export interface TableReference extends NodeLocation, Recoverable {
    type: 'TableReference';
    table: Expression | null;
    alias?: string;
    schema?: string;
    hints?: string[];   // T-SQL hints like NOLOCK, ROWLOCK
    joins: JoinNode[];
}

export interface SelectNode extends NodeLocation, Recoverable {
    type: 'SelectStatement';
    distinct: boolean;
    top: string | null;
    columns: ColumnNode[];
    from: TableReference[] | null;
    where: Expression | null;
    groupBy: Expression[] | null;
    having: Expression | null;
    orderBy: OrderByNode[] | null;
}

export interface InsertNode extends NodeLocation, Recoverable {
    type: 'InsertStatement';
    table: Expression | null;
    columns: string[] | null;
    values: Expression[][] | null;
    selectQuery: SelectNode | SetOperatorNode | null;
}

export interface UpdateAssignment {
    column: string;
    value: Expression | null;
}

export interface UpdateNode extends NodeLocation, Recoverable {
    type: 'UpdateStatement';
    target: Expression | null;
    assignments: UpdateAssignment[] | null;
    from: TableReference[] | null;
    where: Expression | null;
}

export interface DeleteNode extends NodeLocation, Recoverable {
    type: 'DeleteStatement';
    target: Expression | null;         // The table or alias being deleted from
    from: TableReference[] | null;
    where: Expression | null;
}

export interface VariableDeclaration extends NodeLocation {
    name: string;        // e.g., "@BatchID"
    dataType: string;    // e.g., "INT" or "VARCHAR(MAX)"
    initialValue?: Expression; // Optional initial value (e.g., "10" or "@ID + 1")
    columns?: ColumnDefinition[] | null; // For table variables
}

export interface ParseResult {
    ast: Program;
}

export interface DeclareNode extends NodeLocation, Recoverable {
    type: 'DeclareStatement';
    variables: VariableDeclaration[];
}

export interface SetNode extends NodeLocation, Recoverable {
    type: 'SetStatement';
    variable: string; // e.g., "@ID"
    value: Expression | null;    // e.g., "10" or "@ID + 1"
}

export interface OrderByNode extends NodeLocation {
    expression: Expression;
    direction: 'ASC' | 'DESC';
}

export interface SetOperatorNode extends NodeLocation {
    type: 'SetOperator';
    operator: 'UNION' | 'UNION ALL' | 'EXCEPT' | 'INTERSECT';
    left: QueryStatement;  // Changed from Statement
    right: QueryStatement; // Changed from Statement
}

export interface ColumnDefinition extends NodeLocation {
    name: string;
    dataType: string;
    constraints?: string[]; // e.g., ["PRIMARY KEY", "NOT NULL"]
}

export interface ParameterDefinition extends NodeLocation {
    name: string;
    dataType: string;
    defaultValue?: string;
    isOutput: boolean;
}

export interface CreateNode extends NodeLocation {
    type: 'CreateStatement';
    objectType: 'TABLE' | 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TYPE';
    name: string;
    columns?: ColumnDefinition[]; // For Tables
    parameters?: ParameterDefinition[]; // For Procs/Functions
    body?: Statement | Statement[]; // The code inside
    isTableType?: boolean; // For CREATE TYPE ... AS TABLE
}

export interface CTENode extends NodeLocation {
    name: string;
    columns?: string[];
    query: QueryStatement;
}

export interface WithNode extends NodeLocation {
    type: 'WithStatement';
    ctes: CTENode[];
    body: Statement;
}

export interface WindowDefinition extends NodeLocation {
    type: 'WindowDefinition';
    partitionBy?: Expression[];
    orderBy?: OrderByNode[];
}

export interface OverExpression extends NodeLocation {
    type: 'OverExpression';
    expression: Expression; // The underlying FunctionCall
    window: WindowDefinition;
}

export interface IdentifierNode extends NodeLocation, Recoverable {
    type: 'Identifier';
    name: string;
    parts: string[];
    tablePrefix?: string;
}

export interface ErrorNode extends NodeLocation {
    type: 'ErrorStatement';
    message: string;
}

export interface VariableNode extends NodeLocation {
    type: 'Variable';
    name: string;
}
export const JoinKeywords = {
    JOIN: 'JOIN',
    INNER: 'INNER',
    LEFT: 'LEFT',
    RIGHT: 'RIGHT',
    FULL: 'FULL',
    CROSS: 'CROSS',
    OUTER: 'OUTER',
    APPLY: 'APPLY'
} as const;

export type JoinKeyword =
    typeof JoinKeywords[keyof typeof JoinKeywords];

export const JoinTypes = {
    INNER: 'INNER JOIN',
    LEFT_OUTER: 'LEFT OUTER JOIN',
    RIGHT_OUTER: 'RIGHT OUTER JOIN',
    FULL_OUTER: 'FULL OUTER JOIN',
    CROSS: 'CROSS JOIN',
    CROSS_APPLY: 'CROSS APPLY',
    OUTER_APPLY: 'OUTER APPLY',
} as const;

export type JoinType =
    typeof JoinTypes[keyof typeof JoinTypes];

enum Precedence {
    LOWEST,
    OR,
    AND,
    NOT,     // Infix NOT (NOT IN, NOT LIKE)
    COMPARE, // =, <>, <, >, <=, >=
    SUM,     // +, -
    PRODUCT, // *, /, %
    PREFIX,  // -X, NOT X  
    UNARY,   // +X (unary plus), -X (unary minus) 
    CALL     // Function calls
}

const STRUCTURAL_KEYWORDS = new Set([
    'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN',
    'WHERE', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'ALL',
    'ON', 'APPLY', 'OUTER', 'EXCEPT', 'INTERSECT', 'WITH',
    'FOR', 'TABLESAMPLE', 'PIVOT', 'UNPIVOT'
]);

const RESYNC_KEYWORDS = new Set([
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SET',
    'DECLARE', 'IF', 'BEGIN', 'CREATE', 'WITH', 'GO',
    'WHEN', 'THEN', 'ELSE', 'END'
]);

const CREATE_OBJECT_TYPES: Record<string, CreateNode['objectType']> = {
    TABLE: 'TABLE', VIEW: 'VIEW', PROCEDURE: 'PROCEDURE',
    FUNCTION: 'FUNCTION', TYPE: 'TYPE', PROC: 'PROCEDURE'
};

// Precedence mapping for operators
const PRECEDENCE_MAP: Record<string, Precedence> = {
    '.': Precedence.CALL,
    'OR': Precedence.OR,
    'AND': Precedence.AND,
    'NOT': Precedence.NOT,
    'IS': Precedence.COMPARE,
    'IN': Precedence.COMPARE,
    'BETWEEN': Precedence.COMPARE,
    'LIKE': Precedence.COMPARE,
    '=': Precedence.COMPARE,
    '<>': Precedence.COMPARE,
    '!=': Precedence.COMPARE,
    '<': Precedence.COMPARE,
    '>': Precedence.COMPARE,
    '>=': Precedence.COMPARE,
    '<=': Precedence.COMPARE,

    // Bitwise (Essential for the negative/bitwise tests)
    '&': Precedence.SUM,
    '|': Precedence.SUM,
    '^': Precedence.SUM,

    '+': Precedence.SUM,
    '-': Precedence.SUM,

    '*': Precedence.PRODUCT,
    '/': Precedence.PRODUCT,
    '%': Precedence.PRODUCT, // Modulo support

    // High Precedence
    'COLLATE': Precedence.CALL,
    '(': Precedence.CALL,
};


export class Parser {
    private tokens: Token[] = [];
    private pos = 0;

    constructor(private lexer: Lexer) {
        let t;
        while ((t = lexer.nextToken()).type !== TokenType.EOF) {
            this.tokens.push(t);
        }
    }

    private peek(offset: number = 0) {
        return this.tokens[this.pos + offset];
    }

    private consume() { return this.tokens[this.pos++]; }

    /**
     * Ensures the current token is of a specific type and consumes it.
     * If not, it throws a helpful error.
     */
    private match(...types: TokenType[]): Token {
        const token = this.peek();
        if (token && types.includes(token.type)) {
            return this.consume();
        }
        const expected = types.map(t => TokenType[t]).join(' or ');
        throw new Error(`Expected ${expected} but found ${token?.value} at line ${token?.line}`);
    }

    /**
     * Ensures the current token has a specific value (case-sensitive) and consumes it.
     * Perfect for keywords like 'AND' in the BETWEEN clause.
     */
    private matchValue(value: string): Token {
        const token = this.peek();
        if (!token || token.value !== value) {
            throw new Error(`Expected '${value}' at line ${token?.line}, but found '${token?.value}'`);
        }
        return this.consume();
    }

    public parse(): ParseResult {
        const statements: Statement[] = [];

        while (this.pos < this.tokens.length) {
            const token = this.peek();

            // Handle T-SQL Batch Separator 'GO'
            if (token?.value === 'GO') {
                this.consume();
                continue;
            }

            let stmt: Statement | null = this.parseStatement();

            if (stmt) {
                statements.push(stmt);
            }

            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
            }
        }

        const ast: Program = { type: 'Program', body: statements };

        return {
            ast: ast
        };
    }

    private parseMultipartIdentifier(): IdentifierNode {
        const segments: Token[] = [];

        // first segment must be identifier-like
        const first = this.match(
            TokenType.Identifier,
            TokenType.Keyword,
            TokenType.Variable,
            TokenType.TempTable
        );

        // reject structural keywords
        if (
            first.type === TokenType.Keyword &&
            this.isStructuralKeyword(first.value)
        ) {
            throw new Error(
                `Expected identifier but found ${first.value}`
            );
        }

        segments.push(first);

        // multipart:
        // dbo.Table
        // db.schema.table
        // @t.col
        while (this.peek()?.type === TokenType.Dot) {
            const dot = this.consume();

            try {
                const next = this.match(
                    TokenType.Identifier,
                    TokenType.Keyword,
                    TokenType.Variable,
                    TokenType.TempTable
                );

                // reject structural keyword segment
                if (
                    next.type === TokenType.Keyword &&
                    this.isStructuralKeyword(next.value)
                ) {
                    throw new Error(
                        `Expected identifier after dot but found ${next.value}`
                    );
                }

                segments.push(next);

            } catch {
                // recover:
                // dbo.
                // alias.
                const name =
                    segments.map(t => t.value).join('.') + '.';

                return {
                    type: 'Identifier',
                    name,
                    parts: [...segments.map(t => t.value), ''],
                    start: segments[0].offset,
                    end: dot.offset + dot.value.length,
                    incomplete: true,
                    errors: ['Expected identifier after dot']
                };
            }
        }

        const last = segments[segments.length - 1];

        return {
            type: 'Identifier',
            name: segments.map(t => t.value).join('.'),
            parts: segments.map(t => t.value),
            start: segments[0].offset,
            end: last.offset + last.value.length
        };
    }

    private parseSetOperation(left: QueryStatement): SetOperatorNode {
        const operatorToken = this.consume(); // UNION, EXCEPT, INTERSECT
        let type = operatorToken.value.toUpperCase();

        // Handle UNION ALL
        if (type === 'UNION' && this.peek()?.value === 'ALL') {
            this.consume();
            type = 'UNION ALL';
        }

        const right = this.parseSelect();

        // The range starts where the left query starts and ends where the right query ends
        const node: SetOperatorNode = {
            type: 'SetOperator',
            operator: type as 'UNION' | 'UNION ALL' | 'EXCEPT' | 'INTERSECT',
            left: left,
            right: right,
            start: left.start,
            end: right.end
        };

        // Check for chained operations
        const next = this.peek()?.value;
        if (next && ['UNION', 'EXCEPT', 'INTERSECT'].includes(next)) {
            // The recursive call will correctly wrap the current 'node' 
            // into a new parent SetOperatorNode with updated offsets.
            return this.parseSetOperation(node);
        }

        return node;
    }

    private parseStatement(): Statement | null {
        const token = this.peek();
        if (!token) return null;

        let stmt: Statement | null = null;
        const startOffset = token.offset;

        try {
            const val = token.value;

            switch (val) {
                case 'SELECT': stmt = this.parseQueryExpression(); break;
                case 'INSERT': stmt = this.parseInsert(); break;
                case 'UPDATE': stmt = this.parseUpdate(); break;
                case 'DELETE': stmt = this.parseDelete(); break;
                case 'DECLARE': stmt = this.parseDeclare(); break;
                case 'SET': stmt = this.parseSet(); break;
                case 'CREATE': stmt = this.parseCreate(); break;
                case 'IF': stmt = this.parseIf(); break;
                case 'BEGIN': stmt = this.parseBlock(); break;

                case 'WITH':
                    stmt = this.parseWith();
                    break;

                case 'PRINT': {
                    const printToken = this.consume();

                    let value: Expression | null = null;
                    let endOffset = printToken.offset + printToken.value.length;
                    let incomplete = false;
                    const errors: string[] = [];

                    try {
                        const next = this.peek();

                        if (
                            !next ||
                            this.isStructuralKeyword(next.value) ||
                            next.type === TokenType.Semicolon
                        ) {
                            incomplete = true;
                            errors.push('Expected PRINT expression');
                        } else {
                            value = this.parseExpression();
                            endOffset = value.end;
                        }

                    } catch (e) {
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );
                    }

                    stmt = {
                        type: 'PrintStatement',
                        value,
                        start: startOffset,
                        end: endOffset,
                        ...(incomplete ? { incomplete: true } : {}),
                        ...(errors.length ? { errors } : {})
                    } as PrintNode;

                    break;
                }

                case 'GO':
                    this.consume(); // Batch separator
                    return null;

                case 'WHEN':
                case 'THEN':
                case 'ELSE':
                case 'END':
                    throw new Error(`Unexpected keyword: ${token.value}. This must be part of an expression.`);

                default:
                    if (token.type === TokenType.Semicolon) {
                        this.consume();
                        return null;
                    }
                    throw new Error(`Unexpected token: ${token.value}`);
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);

            const errorEnd = this.peek() ? this.peek()!.offset + this.peek()!.value.length : startOffset + 1;
            this.resync();

            return {
                type: 'ErrorStatement',
                message: errorMsg,
                start: startOffset,
                end: errorEnd
            } as ErrorNode;
        }

        /**
         * FIX: Precise Range Logic
         * Consume the semicolon if it exists so the parser moves forward,
         * but DO NOT update stmt.end. This keeps the statement bounds 
         * limited to the actual SQL text (excluding the punctuation).
         */
        if (stmt && this.peek()?.type === TokenType.Semicolon) {
            this.consume();
        }

        return stmt;
    }

    private parseSelect(): SelectNode {
        const startToken = this.matchKeyword('SELECT');

        // 1. DISTINCT / ALL
        let distinct = false;

        if (this.peekKeyword('DISTINCT')) {
            this.consume();
            distinct = true;
        } else if (this.peekKeyword('ALL')) {
            this.consume();
        }

        // 2. TOP
        let top: string | null = null;

        if (this.peekKeyword('TOP')) {
            this.consume();

            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) {
                this.consume();
            }

            try {
                top = this.consume().value;
            } catch {
                top = null;
            }

            if (hasParens && this.peek()?.type === TokenType.CloseParen) {
                this.consume();
            }

            if (this.peekKeyword('PERCENT')) {
                top = (top ?? '') + ' PERCENT';
                this.consume();
            }
        }

        // Recovery state
        let incomplete = false;
        const errors: string[] = [];

        // 3. Columns
        let columns: ColumnNode[] = [];

        try {
            columns = this.parseList(() => this.parseColumn());

            if (columns.length === 0) {
                incomplete = true;
            }

        } catch (e) {
            columns = [];
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // Safe default end
        let endOffset =
            columns.length > 0
                ? columns[columns.length - 1].end
                : startToken.offset + startToken.value.length;

        // 4. FROM
        let from: TableReference[] | null = null;

        if (this.peekKeyword('FROM')) {
            try {
                from = this.parseFrom();

                if (from.length > 0) {
                    endOffset = from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;
                }

            } catch (e) {
                from = [];
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 5. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword('WHERE')) {
            const whereToken = this.consume();
            endOffset = whereToken.offset + whereToken.value.length;

            try {
                where = this.parseExpression();

                if (where) {
                    endOffset = where.end;
                }

            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 6. GROUP BY
        let groupBy: Expression[] | null = null;

        if (this.peekKeyword('GROUP')) {
            const groupToken = this.consume();
            endOffset = groupToken.offset + groupToken.value.length;

            let hasBy = false;

            try {
                this.matchKeyword('BY');
                endOffset = this.lastConsumedEnd();
                hasBy = true;
            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }

            if (hasBy) {
                try {
                    groupBy = this.parseList(() => this.parseExpression());

                    if (groupBy.length > 0) {
                        endOffset = groupBy[groupBy.length - 1].end;
                    } else {
                        groupBy = [];
                        incomplete = true;
                    }

                } catch (e) {
                    groupBy = [];
                    incomplete = true;

                    errors.push(
                        e instanceof Error ? e.message : String(e)
                    );
                }
            } else {
                groupBy = [];
            }
        }

        // 7. HAVING
        let having: Expression | null = null;

        if (this.peekKeyword('HAVING')) {
            const havingToken = this.consume();
            endOffset = havingToken.offset + havingToken.value.length;

            try {
                having = this.parseExpression();

                if (having) {
                    endOffset = having.end;
                }

            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 8. ORDER BY
        let orderBy: OrderByNode[] | null = null;

        if (this.peekKeyword('ORDER')) {
            const orderToken = this.consume();
            endOffset = orderToken.offset + orderToken.value.length;

            let hasBy = false;

            try {
                this.matchKeyword('BY');
                endOffset = this.lastConsumedEnd();
                hasBy = true;
            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }

            if (hasBy) {
                try {
                    orderBy = this.parseList(() => {
                        const expr = this.parseExpression();

                        let direction: 'ASC' | 'DESC' = 'ASC';
                        let itemEnd = expr.end;

                        if (this.peekKeyword('DESC')) {
                            const dirToken = this.consume();
                            direction = 'DESC';
                            itemEnd =
                                dirToken.offset + dirToken.value.length;
                        } else if (this.peekKeyword('ASC')) {
                            const dirToken = this.consume();
                            direction = 'ASC';
                            itemEnd =
                                dirToken.offset + dirToken.value.length;
                        }

                        return {
                            expression: expr,
                            direction,
                            start: expr.start,
                            end: itemEnd
                        } as OrderByNode;
                    });

                    if (orderBy.length > 0) {
                        endOffset = orderBy[orderBy.length - 1].end;
                    } else {
                        orderBy = [];
                        incomplete = true;
                    }

                } catch (e) {
                    orderBy = [];
                    incomplete = true;

                    errors.push(
                        e instanceof Error ? e.message : String(e)
                    );
                }
            } else {
                orderBy = [];
            }
        }

        return {
            type: 'SelectStatement',
            distinct,
            top,
            columns,
            from,
            where,
            groupBy,
            having,
            orderBy,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseInsert(): InsertNode {
        const startToken = this.matchKeyword('INSERT');

        let incomplete = false;
        const errors: string[] = [];

        if (this.peekKeyword('INTO')) {
            this.consume();
        }

        // 1. Target table (recoverable)
        let tableNode: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value) &&
                next.type !== TokenType.OpenParen
            ) {
                tableNode = this.parseMultipartIdentifier();
                endOffset = tableNode.end;
            } else {
                incomplete = true;
                errors.push('Expected target table');
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 2. Column list
        let columns: string[] | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            const openParen = this.consume();
            endOffset = openParen.offset + openParen.value.length;

            try {
                // FIX: parse identifiers, not raw tokens
                if (this.peek()?.type !== TokenType.CloseParen) {
                    columns = this.parseList(() =>
                        this.parseMultipartIdentifier().name
                    );
                } else {
                    columns = [];
                }

                const closeParen = this.match(TokenType.CloseParen);
                endOffset = closeParen.offset + closeParen.value.length;

            } catch (e) {
                columns = [];
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );

                // recover to ')'
                while (
                    this.peek() &&
                    this.peek()!.type !== TokenType.CloseParen &&
                    this.peek()!.value !== 'VALUES' &&
                    this.peek()!.value !== 'SELECT' &&
                    this.peek()!.value !== 'WITH'
                ) {
                    this.consume();
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    const closeParen = this.consume();
                    endOffset = closeParen.offset + closeParen.value.length;
                }
            }
        }

        // 3. VALUES / SELECT
        let values: Expression[][] | null = null;
        let selectQuery: QueryStatement | null = null;

        const nextVal = this.peek()?.value?.toUpperCase();

        // INSERT ... VALUES
        if (nextVal === 'VALUES') {
            const valuesToken = this.consume();
            endOffset = valuesToken.offset + valuesToken.value.length;

            try {
                values = this.parseList(() => {
                    const openParen = this.match(TokenType.OpenParen);
                    endOffset = openParen.offset + openParen.value.length;

                    let rowValues: Expression[] = [];

                    try {
                        // allow VALUES ()
                        if (this.peek()?.type !== TokenType.CloseParen) {
                            rowValues = this.parseList(() =>
                                this.parseExpression(Precedence.LOWEST)
                            );
                        }

                        if (rowValues.length > 0) {
                            endOffset = rowValues[rowValues.length - 1].end;
                        }

                    } catch (e) {
                        rowValues = [];
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );

                        // recover to ')'
                        while (
                            this.peek() &&
                            this.peek()!.type !== TokenType.CloseParen &&
                            this.peek()!.type !== TokenType.Comma
                        ) {
                            this.consume();
                        }
                    }

                    try {
                        const closeParen = this.match(TokenType.CloseParen);
                        endOffset =
                            closeParen.offset + closeParen.value.length;
                    } catch (e) {
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );
                    }

                    return rowValues;
                });

            } catch (e) {
                values = [];
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // INSERT ... SELECT / WITH
        else if (
            nextVal === 'SELECT' ||
            nextVal === 'WITH'
        ) {
            try {
                selectQuery = this.parseQueryExpression();
                endOffset = selectQuery.end;

            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        return {
            type: 'InsertStatement',
            table: tableNode,
            columns,
            values,
            selectQuery,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseUpdate(): UpdateNode {
        const startToken = this.matchKeyword('UPDATE');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        // 1. Target
        let targetNode: Expression | null = null;

        try {
            const next = this.peek();

            if (next && !this.isStructuralKeyword(next.value)) {
                targetNode = this.parseMultipartIdentifier();
                endOffset = targetNode.end;
            } else {
                incomplete = true;
                errors.push('Expected update target');
            }
        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 2. SET
        let sawSet = false;

        try {
            this.matchKeyword('SET');
            endOffset = this.lastConsumedEnd();
            sawSet = true;
        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 3. Assignments
        let assignments: UpdateAssignment[] = [];

        if (sawSet) {
            try {
                assignments = this.parseList(() => {
                    let columnName = '';
                    let value: Expression | null = null;

                    // 1. column
                    try {
                        const next = this.peek();

                        if (!next || this.isStructuralKeyword(next.value)) {
                            incomplete = true;
                            errors.push('Expected assignment column');

                            return {
                                column: '',
                                value: null
                            };
                        }

                        const columnNode = this.parseMultipartIdentifier();
                        columnName = columnNode.name;
                        endOffset = columnNode.end;

                    } catch (e) {
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );

                        return {
                            column: '',
                            value: null
                        };
                    }

                    // 2. =
                    if (this.peek()?.value !== '=') {
                        incomplete = true;
                        errors.push('Expected =');

                        return {
                            column: columnName,
                            value: null
                        };
                    }

                    const eqToken = this.consume();
                    endOffset = eqToken.offset + eqToken.value.length;

                    // 3. value
                    try {
                        const next = this.peek();

                        if (
                            !next ||
                            this.isStructuralKeyword(next.value) ||
                            next.type === TokenType.Comma
                        ) {
                            incomplete = true;
                            errors.push('Expected expression');

                            return {
                                column: columnName,
                                value: null
                            };
                        }

                        value = this.parseExpression();

                        if (value) {
                            endOffset = value.end;
                        }

                    } catch (e) {
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );
                    }

                    return {
                        column: columnName,
                        value
                    };
                });

                if (assignments.length === 0) {
                    incomplete = true;
                }

            } catch (e) {
                assignments = [];
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 4. FROM
        let from: TableReference[] | null = null;

        if (this.peekKeyword('FROM')) {
            try {
                from = this.parseFrom();

                if (from.length > 0) {
                    endOffset = from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;
                }

            } catch (e) {
                from = [];
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 5. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword('WHERE')) {
            const whereToken = this.consume();
            endOffset = whereToken.offset + whereToken.value.length;

            try {
                const next = this.peek();

                if (
                    next &&
                    !this.isStructuralKeyword(next.value) &&
                    next.type !== TokenType.Comma
                ) {
                    where = this.parseExpression();

                    if (where) {
                        endOffset = where.end;
                    }
                } else {
                    incomplete = true;
                    errors.push('Expected WHERE expression');
                }

            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        return {
            type: 'UpdateStatement',
            target: targetNode,
            assignments,
            from,
            where,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseFrom(): TableReference[] {
        const fromToken = this.matchKeyword('FROM');

        try {
            const refs = this.parseList(() =>
                this.parseTableSource(fromToken.offset)
            );

            if (refs.length > 0) {
                return refs;
            }

        } catch {
            // fall through to recovery
        }

        // Recover:
        // SELECT * FROM
        // SELECT * FROM ,
        // SELECT * FROM WHERE ...
        return [
            {
                type: 'TableReference',
                table: null,
                joins: [],
                start: fromToken.offset,
                end: fromToken.offset + fromToken.value.length,
                incomplete: true,
                errors: ['Expected table source after FROM']
            }
        ];
    }

    private parseTableSource(forcedStart?: number): TableReference {
        let incomplete = false;
        const errors: string[] = [];

        let source: Expression | null = null;
        let alias: string | null = null;
        let hints: string[] | undefined;

        const startToken = this.peek();
        const startOffset = forcedStart ?? startToken?.offset ?? 0;
        let endOffset = startOffset;

        // 1. Parse source (subquery / identifier)
        try {
            const next = this.peek();
            const nextNext = this.peek(1);

            if (
                next?.type === TokenType.OpenParen &&
                (nextNext?.value === 'SELECT' || nextNext?.value === 'WITH')
            ) {
                const openParen = this.match(TokenType.OpenParen);
                endOffset = openParen.offset + openParen.value.length;

                const subquery = this.parseQueryExpression();

                const closeParen = this.match(TokenType.CloseParen);

                source = {
                    type: 'SubqueryExpression',
                    query: subquery,
                    start: openParen.offset,
                    end: closeParen.offset + closeParen.value.length
                };

                endOffset = source.end;
            }
            else {
                source = this.parseMultipartIdentifier();
                endOffset = source.end;
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 2. Alias
        const aliasToken = this.peek();

        try {
            if (source && aliasToken?.value === 'AS') {
                this.consume();

                const aliasNode = this.parseMultipartIdentifier();
                alias = aliasNode.name;
                endOffset = aliasNode.end;
            }
            else if (
                source &&
                aliasToken &&
                (
                    aliasToken.type === TokenType.Identifier ||
                    aliasToken.type === TokenType.Keyword
                ) &&
                !this.isStructuralKeyword(aliasToken.value)
            ) {
                const aliasNode = this.parseMultipartIdentifier();
                alias = aliasNode.name;
                endOffset = aliasNode.end;
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 3. Hints
        try {
            if (source?.type === 'Identifier') {
                const nextToken = this.peek();

                if (
                    nextToken?.value === 'WITH' ||
                    (nextToken?.type === TokenType.OpenParen && alias)
                ) {
                    hints = this.parseTableHints();
                    endOffset = this.lastConsumedEnd();
                }
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 4. Joins
        const joins: JoinNode[] = [];

        try {
            while (this.isJoinToken(this.peek())) {
                const join = this.parseJoin();
                joins.push(join);
                endOffset = join.end;
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        return {
            type: 'TableReference',
            table: source,
            alias: alias || undefined,
            hints,
            joins,
            start: startOffset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    /**
     * Gold Standard Helper: Centralizes keywords that terminate a table reference.
     * Prevents "Select col NEW_KEYWORD" from breaking if NEW_KEYWORD is added to T-SQL.
     */
    private isStructuralKeyword(value: string): boolean {
        return STRUCTURAL_KEYWORDS.has(value); // O(1), no allocation, no toUpperCase
    }

    private parseTableHints(): string[] {
        const hints: string[] = [];

        // optional WITH
        if (this.peekKeyword('WITH')) {
            this.consume();
        }

        // must have (
        if (this.peek()?.type !== TokenType.OpenParen) {
            return hints;
        }

        this.consume(); // (

        while (this.peek()) {
            const token = this.peek()!;

            // normal close
            if (token.type === TokenType.CloseParen) {
                this.consume();
                break;
            }

            // stop at clause boundary
            if (
                token.type === TokenType.Keyword &&
                this.isStructuralKeyword(token.value)
            ) {
                break;
            }

            // Parse one hint, preserving nested parens:
            // NOLOCK
            // INDEX(PK_Products)
            // FORCESEEK(IndexA(col1,col2))
            const parts: string[] = [];
            let depth = 0;

            while (this.peek()) {
                const t = this.peek()!;

                // close outer WITH(...)
                if (
                    depth === 0 &&
                    t.type === TokenType.CloseParen
                ) {
                    break;
                }

                // comma separates hints only at top level
                if (
                    depth === 0 &&
                    t.type === TokenType.Comma
                ) {
                    break;
                }

                // clause boundary only at top level
                if (
                    depth === 0 &&
                    t.type === TokenType.Keyword &&
                    this.isStructuralKeyword(t.value)
                ) {
                    break;
                }

                this.consume();
                parts.push(t.value);

                if (t.type === TokenType.OpenParen) depth++;
                if (t.type === TokenType.CloseParen) depth--;
            }

            const hint = parts.join('').trim();
            if (hint) {
                hints.push(hint);
            }

            // optional comma
            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
            }
        }

        // consume final ) if present
        if (this.peek()?.type === TokenType.CloseParen) {
            this.consume();
        }

        return hints;
    }

    private parseJoin(): JoinNode {
        const startToken = this.peek()!;

        let incomplete = false;
        const errors: string[] = [];

        // safe defaults
        let type: JoinType = JoinTypes.INNER;
        let rawType = startToken.value.toUpperCase();
        let endOffset = startToken.offset + startToken.value.length;

        // 1. Determine canonical Join Type
        const firstToken = this.consume();
        const first = firstToken.value.toUpperCase();
        endOffset = firstToken.offset + firstToken.value.length;

        try {
            switch (first) {
                case JoinKeywords.JOIN:
                    rawType = JoinKeywords.JOIN;
                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.INNER:
                    rawType = 'INNER JOIN';

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push('Expected JOIN after INNER');
                    }

                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.LEFT:
                    if (this.peekKeyword(JoinKeywords.OUTER)) {
                        const outerToken = this.consume();
                        endOffset = outerToken.offset + outerToken.value.length;
                        rawType = 'LEFT OUTER JOIN';
                    } else {
                        rawType = 'LEFT JOIN';
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push('Expected JOIN after LEFT');
                    }

                    type = JoinTypes.LEFT_OUTER;
                    break;

                case JoinKeywords.RIGHT:
                    if (this.peekKeyword(JoinKeywords.OUTER)) {
                        const outerToken = this.consume();
                        endOffset = outerToken.offset + outerToken.value.length;
                        rawType = 'RIGHT OUTER JOIN';
                    } else {
                        rawType = 'RIGHT JOIN';
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push('Expected JOIN after RIGHT');
                    }

                    type = JoinTypes.RIGHT_OUTER;
                    break;

                case JoinKeywords.FULL:
                    if (this.peekKeyword(JoinKeywords.OUTER)) {
                        const outerToken = this.consume();
                        endOffset = outerToken.offset + outerToken.value.length;
                        rawType = 'FULL OUTER JOIN';
                    } else {
                        rawType = 'FULL JOIN';
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push('Expected JOIN after FULL');
                    }

                    type = JoinTypes.FULL_OUTER;
                    break;

                case JoinKeywords.CROSS: {
                    const next = this.peek()?.value?.toUpperCase();

                    if (next === JoinKeywords.JOIN) {
                        const token = this.consume();
                        endOffset = token.offset + token.value.length;
                        rawType = 'CROSS JOIN';
                        type = JoinTypes.CROSS;
                    } else if (next === JoinKeywords.APPLY) {
                        const token = this.consume();
                        endOffset = token.offset + token.value.length;
                        rawType = 'CROSS APPLY';
                        type = JoinTypes.CROSS_APPLY;
                    } else {
                        incomplete = true;
                        errors.push('Expected JOIN or APPLY after CROSS');
                        rawType = 'CROSS';
                        type = JoinTypes.CROSS;
                    }

                    break;
                }

                case JoinKeywords.OUTER: {
                    const next = this.peek()?.value?.toUpperCase();

                    if (next === JoinKeywords.APPLY) {
                        const token = this.consume();
                        endOffset = token.offset + token.value.length;
                        rawType = 'OUTER APPLY';
                        type = JoinTypes.OUTER_APPLY;
                    } else {
                        incomplete = true;
                        errors.push('Expected APPLY after OUTER');
                        rawType = 'OUTER';
                        type = JoinTypes.OUTER_APPLY;
                    }

                    break;
                }

                default:
                    incomplete = true;
                    errors.push(`Unsupported join type: ${first}`);
                    break;
            }
        } catch (e) {
            incomplete = true;
            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 2. Join target
        let tableTarget: Expression | null = null;

        try {
            const nextToken = this.peek();

            if (!nextToken) {
                incomplete = true;
            }
            else if (
                nextToken.type === TokenType.OpenParen &&
                (
                    this.peek(1)?.value === 'SELECT' ||
                    this.peek(1)?.value === 'WITH'
                )
            ) {
                const openParen = this.consume();
                endOffset = openParen.offset + openParen.value.length;

                const subquery = this.parseQueryExpression();
                const closeParen = this.match(TokenType.CloseParen);

                tableTarget = {
                    type: 'SubqueryExpression',
                    query: subquery,
                    start: openParen.offset,
                    end: closeParen.offset + closeParen.value.length
                };

                endOffset = tableTarget.end;
            }
            else if (nextToken.type === TokenType.OpenParen) {
                tableTarget = this.parseExpression();
                endOffset = tableTarget.end;
            }
            else {
                tableTarget = this.parseMultipartIdentifier();
                endOffset = tableTarget.end;
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 3. Alias
        let alias: string | undefined;

        if (tableTarget) {
            try {
                if (this.peek()?.value === 'AS') {
                    const asToken = this.consume();
                    endOffset = asToken.offset + asToken.value.length;

                    const aliasNode = this.parseMultipartIdentifier();
                    alias = aliasNode.name;
                    endOffset = aliasNode.end;
                }
                else {
                    const potentialAlias = this.peek();

                    if (
                        potentialAlias &&
                        (
                            potentialAlias.type === TokenType.Identifier ||
                            potentialAlias.type === TokenType.Keyword
                        ) &&
                        !this.isStructuralKeyword(potentialAlias.value)
                    ) {
                        const aliasNode = this.parseMultipartIdentifier();
                        alias = aliasNode.name;
                        endOffset = aliasNode.end;
                    }
                }

            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 4. Hints
        let hints: string[] | undefined;

        if (
            tableTarget &&
            (
                this.peek()?.value === 'WITH' ||
                (this.peek()?.type === TokenType.OpenParen && alias)
            )
        ) {
            try {
                hints = this.parseTableHints();
                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 5. ON clause
        let on: Expression | null = null;

        if (this.peekKeyword('ON')) {
            const onToken = this.consume();
            endOffset = onToken.offset + onToken.value.length;

            try {
                on = this.parseExpression();

                if (on) {
                    endOffset = on.end;
                }
            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }
        else if (
            type !== JoinTypes.CROSS &&
            type !== JoinTypes.CROSS_APPLY &&
            type !== JoinTypes.OUTER_APPLY
        ) {
            incomplete = true;
            errors.push('Expected ON clause');
        }

        return {
            type,
            rawType,
            table: tableTarget,
            alias,
            hints,
            on,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDelete(): DeleteNode {
        const startToken = this.matchKeyword('DELETE');

        let incomplete = false;
        const errors: string[] = [];

        // Optional first FROM:
        // DELETE FROM T ...
        if (this.peekKeyword('FROM')) {
            this.consume();
        }

        // 1. Target
        let target: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        try {
            target = this.parseMultipartIdentifier();
            endOffset = target.end;
        } catch (e) {
            incomplete = true;
            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 2. Optional second FROM
        // DELETE Alias FROM TableSource ...
        let from: TableReference[] | null = null;

        if (this.peekKeyword('FROM')) {
            const fromToken = this.consume();
            endOffset = fromToken.offset + fromToken.value.length;

            try {
                from = this.parseList(() =>
                    this.parseTableSource(fromToken.offset)
                );

                if (from.length > 0) {
                    endOffset = from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;
                }

            } catch (e) {
                from = [];
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        // 3. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword('WHERE')) {
            const whereToken = this.consume();
            endOffset = whereToken.offset + whereToken.value.length;

            try {
                where = this.parseExpression();

                if (where) {
                    endOffset = where.end;
                }

            } catch (e) {
                incomplete = true;

                errors.push(
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        return {
            type: 'DeleteStatement',
            target,
            from,
            where,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDeclare(): DeclareNode {
        const startToken = this.matchKeyword('DECLARE');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        let variables: VariableDeclaration[] = [];

        try {
            variables = this.parseList<VariableDeclaration>(() => {
                const declStart = this.peek()?.offset ?? endOffset;

                let name = '';
                let dataType = '';
                let columns: ColumnDefinition[] | undefined;
                let initialValue: Expression | undefined;

                // 1. variable name
                try {
                    const nameToken = this.match(TokenType.Variable);
                    name = nameToken.value;
                    endOffset = nameToken.offset + nameToken.value.length;
                } catch (e) {
                    incomplete = true;

                    errors.push(
                        e instanceof Error ? e.message : String(e)
                    );
                }

                // 2. table variable
                if (this.peekKeyword('TABLE')) {
                    const tableToken = this.consume();
                    dataType = 'TABLE';
                    endOffset = tableToken.offset + tableToken.value.length;

                    try {
                        columns = this.parseTableColumns();
                        endOffset = this.lastConsumedEnd();
                    } catch (e) {
                        columns = [];
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );
                    }

                    return {
                        name,
                        dataType,
                        columns,
                        start: declStart,
                        end: endOffset
                    };
                }

                // 3. scalar datatype
                try {
                    const next = this.peek();

                    if (
                        next &&
                        next.type !== TokenType.Comma &&
                        next.type !== TokenType.Semicolon &&
                        next.value !== '='
                    ) {
                        dataType = this.parseDataType();
                        endOffset = this.lastConsumedEnd();
                    }
                } catch (e) {
                    incomplete = true;

                    errors.push(
                        e instanceof Error ? e.message : String(e)
                    );
                }

                // 4. initializer
                if (this.peek()?.value === '=') {
                    const eqToken = this.consume();
                    endOffset = eqToken.offset + eqToken.value.length;

                    try {
                        initialValue = this.parseExpression();

                        if (initialValue) {
                            endOffset = initialValue.end;
                        }
                    } catch (e) {
                        incomplete = true;

                        errors.push(
                            e instanceof Error ? e.message : String(e)
                        );
                    }
                }

                return {
                    name,
                    dataType,
                    initialValue,
                    start: declStart,
                    end: endOffset
                };
            });

            if (variables.length === 0) {
                incomplete = true;
            }

        } catch (e) {
            variables = [];
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        return {
            type: 'DeclareStatement',
            variables,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseSet(): SetNode {
        const startToken = this.matchKeyword('SET');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        let variable = '';
        let value: Expression | null = null;

        const first = this.peek();

        // CASE 1: variable assignment
        if (first?.type === TokenType.Variable) {
            const variableToken = this.consume();
            variable = variableToken.value;
            endOffset = variableToken.offset + variableToken.value.length;

            // expect =
            if (this.peek()?.value === '=') {
                const eqToken = this.consume();
                endOffset = eqToken.offset + eqToken.value.length;

                try {
                    const next = this.peek();

                    if (
                        next &&
                        next.type !== TokenType.Semicolon &&
                        next.type !== TokenType.Comma &&
                        !this.isStructuralKeyword(next.value)
                    ) {
                        value = this.parseExpression();

                        if (value) {
                            endOffset = value.end;
                        }
                    } else {
                        incomplete = true;
                        errors.push('Expected expression');
                    }

                } catch (e) {
                    incomplete = true;
                    errors.push(
                        e instanceof Error ? e.message : String(e)
                    );
                }
            } else {
                incomplete = true;
                errors.push('Expected =');
            }
        }
        // CASE 2: session option
        else {
            const parts: string[] = [];

            while (this.peek()) {
                const token = this.peek()!;

                if (
                    token.type === TokenType.Semicolon ||
                    token.type === TokenType.Comma
                ) {
                    break;
                }

                if (
                    parts.length > 0 &&
                    token.type === TokenType.Keyword &&
                    this.isStructuralKeyword(token.value)
                ) {
                    break;
                }

                parts.push(this.consume().value);
                endOffset = this.lastConsumedEnd();
            }

            variable = parts.join(' ').trim();

            if (!variable) {
                incomplete = true;
                errors.push('Expected SET target');
            }
        }

        return {
            type: 'SetStatement',
            variable,
            value,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    /**
     * Parses a comma-separated list of column definitions enclosed in parentheses.
     * Shared by CREATE TABLE and CREATE TYPE ... AS TABLE.
     */
    private parseTableColumns(): ColumnDefinition[] {
        const openParen = this.match(TokenType.OpenParen); // Standardized match

        const columns = this.parseList<ColumnDefinition>(() => {
            const startToken = this.peek()!;

            // 1. Column Name (Using the resolver for [bracketed] names)
            const nameNode = this.parseMultipartIdentifier();
            const name = nameNode.name;

            // 2. Data Type (e.g., nvarchar(max), decimal(18, 2))
            let dataType = this.consume().value;
            if (this.peek()?.type === TokenType.OpenParen) {
                dataType += this.consume().value; // (
                // Robust inner-paren consumption
                while (this.pos < this.tokens.length && this.peek()?.type !== TokenType.CloseParen) {
                    dataType += this.consume().value;
                }
                dataType += this.match(TokenType.CloseParen).value; // )
            }

            // 3. Constraint Parsing
            const constraints: string[] = [];
            // Use TokenType for structural checks
            while (this.pos < this.tokens.length) {
                const next = this.peek();
                if (!next || next.type === TokenType.Comma || next.type === TokenType.CloseParen) break;

                const upperVal = next.value; // Already normalized Upper by Lexer

                if (upperVal === 'PRIMARY' && this.peek(1)?.value === 'KEY') {
                    this.consume(); // PRIMARY
                    this.consume(); // KEY
                    constraints.push('PRIMARY KEY');
                } else if (upperVal === 'NOT' && this.peek(1)?.value === 'NULL') {
                    this.consume(); // NOT
                    this.consume(); // NULL
                    constraints.push('NOT NULL');
                } else if (upperVal === 'FOREIGN' && this.peek(1)?.value === 'KEY') {
                    this.consume(); // FOREIGN
                    this.consume(); // KEY
                    constraints.push('FOREIGN KEY');
                } else if (upperVal === 'DEFAULT') {
                    this.consume(); // DEFAULT
                    const defaultExpr = this.parseExpression(Precedence.LOWEST);
                    constraints.push('DEFAULT ' + this.stringifyExpression(defaultExpr));
                } else {
                    // Catch-all (IDENTITY, UNIQUE, NULL)
                    constraints.push(this.consume().value);
                }
            }


            return {
                name,
                dataType,
                constraints: constraints.length > 0 ? constraints : undefined,
                start: startToken.offset,
                end: this.lastConsumedEnd()
            };
        });

        this.match(TokenType.CloseParen);

        return columns;
    }

    private parseCreate(): CreateNode {
        const startToken = this.matchKeyword('CREATE');
        const rawType = this.consume().value.toUpperCase();

        let objectType = CREATE_OBJECT_TYPES[rawType];

        const nameNode = this.parseMultipartIdentifier();
        const name = nameNode.name;


        let columns: ColumnDefinition[] | undefined = undefined;
        let parameters: ParameterDefinition[] | undefined = undefined;
        let body: Statement | Statement[] | undefined = undefined;
        let isTableType: boolean | undefined = undefined;

        if (objectType === 'TYPE') {
            if (this.peekKeyword('AS')) {
                this.consume();
                if (this.peekKeyword('TABLE')) {
                    this.consume();
                    columns = this.parseTableColumns();
                    isTableType = true;
                }
            }
        }
        else if (objectType === 'TABLE') {
            columns = this.parseTableColumns();
        }
        else if (objectType === 'PROCEDURE' || objectType === 'FUNCTION') {
            // [SCOPE] Push a private scope for Procedure/Function


            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            if (this.peek()?.type === TokenType.Variable) {
                parameters = this.parseList<ParameterDefinition>(() => {
                    const paramToken = this.peek()!;
                    const pName = this.consume().value;

                    // Use our new helper
                    const pType = this.parseDataType();

                    let isOutput = false;
                    const nextToken = this.peek();
                    if (nextToken?.type === TokenType.Keyword && (nextToken.value === 'OUTPUT' || nextToken.value === 'OUT')) {
                        isOutput = true;
                        this.consume();
                    }

                    return {
                        name: pName,
                        dataType: pType,
                        isOutput,
                        start: paramToken.offset,
                        end: this.lastConsumedEnd()
                    };
                });
            }
            if (hasParens) this.match(TokenType.CloseParen);

            if (this.peekKeyword('AS')) {
                this.consume(); // AS
            }

            // Parse Body
            const statements: Statement[] = [];
            const stopKeywords = ['GO'];
            while (this.pos < this.tokens.length) {
                const nextToken = this.peek();
                if (!nextToken || stopKeywords.includes(nextToken.value)) break;

                const stmt = this.parseStatement();
                if (stmt) statements.push(stmt);
                else break;
            }
            body = statements;


        }
        else if (objectType === 'VIEW') {
            if (this.peekKeyword('AS')) {
                this.consume();
            }

            body = this.parseQueryExpression();
        }

        // ... endOffset calculation and return (same as your previous version)
        let endOffset = nameNode.end;
        if (Array.isArray(body) && body.length > 0) {
            endOffset = body[body.length - 1].end;
        } else if (body && !Array.isArray(body)) {
            endOffset = (body as Statement).end;
        } else if (columns) {
            endOffset = this.lastConsumedEnd();
        }

        return {
            type: 'CreateStatement',
            objectType,
            name,
            columns,
            parameters,
            body,
            isTableType,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseColumn(): ColumnNode {
        let alias: string | undefined = undefined;
        let expression: Expression;
        let tablePrefix: Expression | undefined = undefined; // Expression type
        let name: string = '';

        const STOP_KEYWORDS = ['FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'UNION', 'ALL', 'EXCEPT', 'INTERSECT', 'JOIN', 'ON', 'APPLY', 'INTO', 'OUTER', 'VALUES'];
        const startOffset = this.peek()?.offset ?? 0;

        // 1. Handle T-SQL Assignment Style (Alias = Expression)
        if (this.peek()?.type === TokenType.Identifier && this.peek(1)?.value === '=') {
            alias = this.consume().value;
            this.consume(); // consume '='
            expression = this.parseExpression();
        } else {
            // 2. Handle Standard Style (Expression [AS] Alias)
            expression = this.parseExpression();

            const nextToken = this.peek();
            const nextVal = nextToken?.value;

            if (nextVal === 'AS') {
                this.consume();
                alias = this.parseMultipartIdentifier().name;
            } else if (
                nextToken &&
                nextToken.type !== TokenType.Semicolon &&
                nextToken.type !== TokenType.Comma &&
                (nextToken.type === TokenType.Identifier || nextToken.type === TokenType.Keyword) &&
                !STOP_KEYWORDS.includes(nextVal!)
            ) {
                alias = this.parseMultipartIdentifier().name;
            }
        }

        // 3. Extraction logic for name and tablePrefix (Node-based)
        // Inside parseColumn -> Extraction logic for Identifier
        if (expression.type === 'Identifier') {
            if (expression.parts && expression.parts.length > 1) {
                name = expression.parts[expression.parts.length - 1];

                // Everything before the last part
                const prefixParts = expression.parts.slice(0, -1);

                tablePrefix = {
                    type: 'Identifier',
                    // FIX: Populate the name property here!
                    name: prefixParts.join('.'),
                    parts: prefixParts,
                    start: expression.start,
                    end: expression.end
                } as IdentifierNode;
            } else {
                name = expression.name;
            }
        } else if (expression.type === 'MemberExpression') {
            name = expression.property;
            // Directly use the object node as the prefix (e.g. 'u' in 'u.Name')
            tablePrefix = expression.object;
        } else if (expression.type === 'FunctionCall') {
            name = expression.name;
        } else if (expression.type === 'Literal') {
            name = String(expression.value);
        } else {
            name = 'expression';
        }

        // 4. Calculate end offset
        let endOffset = alias ? this.lastConsumedEnd() : expression.end;

        return {
            type: 'Column',
            expression,
            name,
            tablePrefix,
            alias,
            start: startOffset,
            end: endOffset
        };
    }

    private isJoinToken(token: Token | undefined): boolean {
        if (!token) return false;
        return Object.values(JoinKeywords).includes(token.value as JoinKeyword);
    }

    private parseExpression(precedence: Precedence = Precedence.LOWEST): Expression {
        let left = this.parsePrefix();

        while (this.pos < this.tokens.length) {
            const startPos = this.pos; // RULE #5: Infinite Loop Guard

            const nextToken = this.peek();
            if (!nextToken || nextToken.type === TokenType.Semicolon) break;

            // RULE #3 & #4: Handle normalized keywords and explicit Dot structural token
            // We map the Dot token to '.' so the PRECEDENCE_MAP can identify it.
            const val = nextToken.type === TokenType.Dot ? '.' : nextToken.value;

            const structuralStops = [
                'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING',
                'UNION', 'EXCEPT', 'INTERSECT', 'ON', 'JOIN'
            ];

            if (precedence === Precedence.LOWEST && structuralStops.includes(val)) {
                if (nextToken.type === TokenType.Keyword) break;
            }

            const nextPrecedence = PRECEDENCE_MAP[val] ?? Precedence.LOWEST;
            if (nextPrecedence <= precedence) break;

            // Consuming the operator/structural token
            const operatorToken = this.consume();
            const operator = operatorToken.value;

            if (val === 'IS') {
                let isNot = false;
                if (this.peek()?.value === 'NOT') {
                    this.consume();
                    isNot = true;
                }
                const nullToken = this.matchValue('NULL');
                left = {
                    type: 'UnaryExpression',
                    operator: isNot ? 'IS NOT NULL' : 'IS NULL',
                    right: left,
                    start: left.start,
                    end: nullToken.offset + nullToken.value.length
                };
            }
            // --- 3. Handle Multi-word NOT Operators ---
            else if (val === 'NOT') {
                const next = this.peek();
                const nextVal = next?.value;

                if (nextVal === 'IN') {
                    this.consume();
                    left = this.parseInExpression(left, true);
                } else if (nextVal === 'BETWEEN') {
                    this.consume();
                    left = this.parseBetweenExpression(left, true, nextPrecedence);
                } else if (nextVal === 'LIKE') {
                    this.consume();
                    const right = this.parseExpression(nextPrecedence);
                    left = {
                        type: 'BinaryExpression',
                        left,
                        operator: 'NOT LIKE',
                        right,
                        start: left.start,
                        end: right.end
                    };
                } else {
                    // Standard prefix NOT (e.g., WHERE NOT ID = 1)
                    const right = this.parseExpression(Precedence.PREFIX);
                    left = {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right,
                        start: operatorToken.offset,
                        end: right.end
                    };
                }
            }
            else if (val === 'BETWEEN') {
                left = this.parseBetweenExpression(left, false, nextPrecedence);
            }
            else if (val === 'IN') {
                left = this.parseInExpression(left, false);
            }
            else if (val === 'COLLATE') {
                const collationToken = this.consume();
                left = {
                    type: 'BinaryExpression',
                    left,
                    operator: 'COLLATE',
                    right: {
                        type: 'Literal',
                        value: collationToken.value,
                        variant: 'string',
                        start: collationToken.offset,
                        end: collationToken.offset + collationToken.value.length
                    },
                    start: left.start,
                    end: collationToken.offset + collationToken.value.length
                };
            }
            else {
                // Standard Binary Operators
                const right = this.parseExpression(nextPrecedence);
                left = {
                    type: 'BinaryExpression',
                    left,
                    operator: operator.toUpperCase(),
                    right,
                    start: left.start,
                    end: right.end
                };
            }

            // RULE #5: Progress Check
            if (this.pos === startPos) {
                throw new Error(`Parser stuck at token ${val} (offset: ${nextToken.offset}).`);
            }
        }
        return left;
    }

    /**
     * Helper to handle the common logic for IN and NOT IN
     */
    private parseInExpression(left: Expression, isNot: boolean): Expression {
        // 1. Consume the opening parenthesis
        this.match(TokenType.OpenParen);

        let subquery: QueryStatement | undefined = undefined;
        let list: Expression[] | undefined = undefined;

        // 2. Determine if it's a subquery or a literal list
        // Use parseQueryExpression to support UNION/EXCEPT inside IN clauses
        if (this.peekKeyword('SELECT')) {
            subquery = this.parseQueryExpression();
        } else {
            // Gold Standard: Use the centralized list helper for consistency
            list = this.parseList(() => this.parseExpression(Precedence.LOWEST));
        }

        // 3. Consume the closing parenthesis and capture it for the end offset
        const closeParen = this.match(TokenType.CloseParen);

        return {
            type: 'InExpression',
            left,
            list,
            subquery,
            isNot,
            // Range starts at the beginning of the subject (left) 
            // and ends at the closing paren of the IN clause
            start: left.start,
            end: closeParen.offset + closeParen.value.length
        };
    }

    /**
     * Helper to handle the common logic for BETWEEN and NOT BETWEEN
     */
    private parseBetweenExpression(left: Expression, isNot: boolean, precedence: number): Expression {
        const lowerBound = this.parseExpression(precedence);
        this.matchKeyword('AND');
        const upperBound = this.parseExpression(precedence);

        return {
            type: 'BetweenExpression',
            left,
            lowerBound,
            upperBound,
            isNot,
            start: left.start, // NodeLocation offset
            end: upperBound.end // NodeLocation offset
        };
    }

    private parsePrefix(): Expression {
        const token = this.consume();
        const value = token.value; // Already Normalized Upper if Keyword
        const start = token.offset;

        switch (token.type) {
            case TokenType.Number:
                return { type: 'Literal', value: Number(value), variant: 'number', start, end: start + value.length };

            case TokenType.Variable:
                return { type: 'Variable', name: value, start, end: start + value.length };

            case TokenType.String: {
                const content = value.startsWith("'") && value.endsWith("'")
                    ? value.substring(1, value.length - 1)
                    : value;
                return { type: 'Literal', value: content, variant: 'string', start, end: start + value.length };
            }

            case TokenType.TempTable:
                return this.parseMultipartIdentifier();

            case TokenType.Operator:
                // 1. Support for SELECT * (Wildcard)
                if (value === '*') {
                    return { type: 'Identifier', name: '*', parts: ['*'], start, end: start + value.length };
                }

                // 2. Rule #5: Fold negative numbers into a single Literal
                if (value === '-') {
                    const next = this.peek();
                    if (next?.type === TokenType.Number) {
                        const numToken = this.consume();
                        return {
                            type: 'Literal',
                            value: Number(`-${numToken.value}`),
                            variant: 'number',
                            start,
                            end: numToken.offset + numToken.value.length
                        };
                    }
                    // Fallback for standard unary minus -(x + y)
                    const right = this.parseExpression(Precedence.PREFIX);
                    return { type: 'UnaryExpression', operator: '-', right, start, end: right.end };
                }

                if (value === '~') {
                    const right = this.parseExpression(Precedence.PREFIX);
                    return { type: 'UnaryExpression', operator: '~', right, start, end: right.end };
                }

                throw new Error(`Unexpected operator in prefix position: ${value}`);

            case TokenType.Identifier:
            case TokenType.Keyword:
                // Rule #3: Comparisons use normalized Uppercase
                if (value === 'NULL') {
                    return { type: 'Literal', value: null, variant: 'null', start, end: start + value.length };
                }
                if (value === 'CASE') return this.parseCaseExpression();
                if (value === 'EXISTS') return this.parseExists(token);

                // Explicitly handle NOT as a prefix unary operator
                if (value === 'NOT') {
                    const right = this.parseExpression(Precedence.NOT);
                    return { type: 'UnaryExpression', operator: 'NOT', right, start, end: right.end };
                }

                // 3. Resolve Multipart Names and Functions
                // Backtrack because parseMultipartIdentifier expects to consume the first part
                this.pos--;
                const idNode = this.parseMultipartIdentifier();

                // Handle Function Calls (e.g., COUNT(*), ROW_NUMBER())
                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume(); // (
                    const args: Expression[] = [];

                    if (this.peek()?.value === 'SELECT') {
                        const subquery = this.parseSelect() as QueryStatement;
                        const closeParen = this.match(TokenType.CloseParen);
                        args.push({
                            type: 'SubqueryExpression',
                            query: subquery,
                            start: subquery.start,
                            end: closeParen.offset + closeParen.value.length
                        });
                    } else {
                        // Rule #1: Use resilient parseList
                        args.push(...this.parseList(() => this.parseExpression(Precedence.LOWEST)));
                    }

                    const closeParen = this.match(TokenType.CloseParen);

                    let result: Expression = {
                        type: 'FunctionCall',
                        name: idNode.name,
                        args,
                        start: idNode.start,
                        end: closeParen.offset + closeParen.value.length
                    };

                    // Window Function Support
                    if (this.peek()?.value === 'OVER') {
                        result = this.parseOverClause(result);
                    }

                    return result;
                }

                return idNode;

            case TokenType.OpenParen:
                if (this.peek()?.value === 'SELECT') {
                    const query = this.parseSelect() as QueryStatement;
                    const closeParen = this.match(TokenType.CloseParen);
                    return {
                        type: 'SubqueryExpression',
                        query,
                        start,
                        end: closeParen.offset + closeParen.value.length
                    } as any;
                } else {
                    const inner = this.parseExpression(Precedence.LOWEST);
                    const closeParen = this.match(TokenType.CloseParen);
                    return {
                        type: 'GroupingExpression',
                        expression: inner,
                        start,
                        end: closeParen.offset + closeParen.value.length
                    } as any;
                }

            default:
                throw new Error(`Unexpected token at line ${token.line}: ${token.value} (${TokenType[token.type]})`);
        }
    }

    /**
     * Helper to keep parsePrefix clean
     */
    private parseExists(existsToken: Token): Expression {
        // existsToken was already consumed by parsePrefix
        this.match(TokenType.OpenParen);
        const subquery = this.parseSelect() as QueryStatement;
        const closeParen = this.match(TokenType.CloseParen);

        return {
            type: 'UnaryExpression',
            operator: 'EXISTS',
            right: {
                type: 'SubqueryExpression',
                query: subquery,
                start: subquery.start,
                end: closeParen.offset + closeParen.value.length
            } as any,
            start: existsToken.offset,
            end: closeParen.offset + closeParen.value.length
        };
    }

    private matchKeyword(value: string): Token {
        const token = this.peek();
        // Lexer now returns keywords in UPPERCASE. 
        // We normalize the 'value' argument once to ensure a perfect match.
        if (token && token.type === TokenType.Keyword && token.value === value) {
            return this.consume();
        }

        throw new Error(`Expected keyword "${value.toUpperCase()}" but found "${token?.value}" at line ${token?.line}`);
    }

    private peekKeyword(value: string): boolean {
        const token = this.peek();
        // Compare against the Uppercase version since Lexer normalized it
        return token?.type === TokenType.Keyword && token.value === value;
    }

    private parseCaseExpression(): Expression {
        // 1. Capture the start offset from the 'CASE' token
        // Since parsePrefix already consumed 'CASE', we get the previous token's offset
        const startToken = this.tokens[this.pos - 1];
        const startOffset = startToken.offset;

        let input: Expression | undefined = undefined;

        // 2. Simple CASE vs. Searched CASE logic
        if (this.peek()?.value !== 'WHEN') {
            input = this.parseExpression(Precedence.LOWEST);
        }

        const branches: { when: Expression, then: Expression }[] = [];
        while (this.peek()?.value === 'WHEN') {
            this.consume(); // WHEN
            const when = this.parseExpression(Precedence.LOWEST);
            this.matchKeyword('THEN');
            const then = this.parseExpression(Precedence.LOWEST);
            branches.push({ when, then });
        }

        let elseBranch: Expression | undefined = undefined;
        if (this.peek()?.value === 'ELSE') {
            this.consume(); // ELSE
            elseBranch = this.parseExpression(Precedence.LOWEST);
        }

        // 3. Match 'END' and capture its full range for the end offset
        const endToken = this.matchKeyword('END');
        const endOffset = endToken.offset + endToken.value.length;

        return {
            type: 'CaseExpression',
            input,
            branches,
            elseBranch,
            start: startOffset,
            end: endOffset
        };
    }

    private parseList<T>(parserFn: () => T): T[] {
        const list: T[] = [];

        // Rule #1: Resilience. If the list is empty (e.g., FUNC()), return early.
        const next = this.peek();
        if (!next || next.type === TokenType.CloseParen || next.type === TokenType.Semicolon) {
            return list;
        }

        // Parse the first mandatory item
        list.push(parserFn());

        // Continue as long as we see a comma
        while (this.peek()?.type === TokenType.Comma) {
            this.consume(); // Consume ','

            // T-SQL "Gold Standard": Check for trailing comma or immediate close
            const afterComma = this.peek();
            if (!afterComma || afterComma.type === TokenType.CloseParen) {
                // Optional: You could log a warning here for better LSP diagnostics
                break;
            }

            list.push(parserFn());
        }

        return list;
    }

    private parseIf(): IfNode {
        const startToken = this.matchKeyword('IF');
        const condition = this.parseExpression();
        const thenBranch = this.parseStatement();

        let elseBranch: Statement | undefined = undefined;
        let endOffset = thenBranch ? thenBranch.end : condition.end;

        if (this.peekKeyword('ELSE')) {
            this.consume(); // ELSE
            const stmt = this.parseStatement();
            if (stmt) {
                elseBranch = stmt;
                endOffset = stmt.end;
            }
        }

        return {
            type: 'IfStatement',
            condition,
            thenBranch: thenBranch!,
            elseBranch,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseBlock(): BlockNode {
        const startToken = this.matchKeyword('BEGIN');
        const body: Statement[] = [];

        while (this.pos < this.tokens.length && !this.peekKeyword('END')) {
            const stmt = this.parseStatement();
            if (stmt) {
                body.push(stmt);
            } else {
                // Prevent infinite loop if parseStatement returns null on standalone semicolon
                if (this.peek()?.type === TokenType.Semicolon) this.consume();
                else break;
            }
        }

        const endToken = this.matchKeyword('END');
        return {
            type: 'BlockStatement',
            body,
            start: startToken.offset,
            end: endToken.offset + endToken.value.length
        };
    }

    private parseWith(): WithNode {
        // Capture the 'WITH' token that was just peeked/consumed
        const startToken = this.matchKeyword('WITH');
        const ctes: CTENode[] = [];

        while (true) {
            // Use the multipart identifier for the CTE name
            const nameNode = this.parseMultipartIdentifier();
            let columns: string[] | undefined = undefined;

            // Optional column list: WITH MyCTE (Col1, Col2)
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume();
                columns = this.parseList(() => this.consume().value);
                this.match(TokenType.CloseParen);
            }

            this.matchKeyword('AS');
            this.match(TokenType.OpenParen);

            // Parse the CTE query
            const query = this.parseQueryExpression() as QueryStatement;
            const closeParen = this.match(TokenType.CloseParen);

            ctes.push({
                name: nameNode.name,
                columns,
                query,
                start: nameNode.start,
                end: closeParen.offset + closeParen.value.length
            });

            // T-SQL allows multiple CTEs separated by commas
            if (this.peek()?.value === ',') {
                this.consume();
            } else {
                break;
            }
        }

        // The statement that follows the CTE (SELECT, INSERT, UPDATE, DELETE)
        const body = this.parseStatement();

        if (!body) {
            throw new Error("A Common Table Expression (CTE) must be followed by a query or DML statement.");
        }

        return {
            type: 'WithStatement',
            ctes,
            body,
            start: startToken.offset,
            end: body.end
        };
    }

    private parseOverClause(expr: Expression): OverExpression {
        const overToken = this.matchKeyword('OVER');
        this.match(TokenType.OpenParen);

        // Initialize WindowDefinition with the 'OVER' token's start
        const windowStart = overToken.offset;

        let partitionBy: Expression[] | undefined = undefined;
        if (this.peekKeyword('PARTITION')) {
            this.consume(); // PARTITION
            this.matchKeyword('BY');
            partitionBy = this.parseList(() => this.parseExpression());
        }

        let orderBy: OrderByNode[] | undefined = undefined;
        if (this.peekKeyword('ORDER')) {
            this.consume(); // ORDER
            this.matchKeyword('BY');
            orderBy = this.parseList(() => {
                const e = this.parseExpression();
                let direction: 'ASC' | 'DESC' = 'ASC';
                let itemEnd = e.end;

                if (this.peekKeyword('DESC')) {
                    const dirToken = this.consume();
                    direction = 'DESC';
                    itemEnd = dirToken.offset + dirToken.value.length;
                } else if (this.peekKeyword('ASC')) {
                    const dirToken = this.consume();
                    itemEnd = dirToken.offset + dirToken.value.length;
                }

                return {
                    expression: e,
                    direction,
                    start: e.start,
                    end: itemEnd
                } as OrderByNode;
            });
        }

        const closeParen = this.match(TokenType.CloseParen);
        const windowEnd = closeParen.offset + closeParen.value.length;

        const window: WindowDefinition = {
            type: 'WindowDefinition',
            partitionBy,
            orderBy,
            start: windowStart,
            end: windowEnd
        };

        return {
            type: 'OverExpression',
            expression: expr,
            window,
            start: expr.start, // The full expression starts at the function name (e.g., ROW_NUMBER)
            end: windowEnd     // And ends at the closing paren of the OVER clause
        };
    }

    private hasName(expr: Expression): expr is (IdentifierNode | MemberExpression) & Expression {
        return expr.type === 'Identifier' || expr.type === 'MemberExpression';
    }

    private lastConsumedEnd(): number {
        const last = this.tokens[this.pos - 1];
        if (!last) return 0;
        return last.offset + last.value.length;
    }

    private isSetOperator(token: Token | null): boolean {
        if (!token || token.type !== TokenType.Keyword) return false;
        const val = token.value; // Already Uppercase from Lexer
        return val === 'UNION' || val === 'EXCEPT' || val === 'INTERSECT';
    }

    private parseQueryExpression(): QueryStatement {
        // 1. Parse the base SELECT
        let query = this.parseSelect() as QueryStatement;

        // 2. Chain any set operations (UNION ALL, EXCEPT, etc.)
        // This allows CTEs and Subqueries to handle chained statements
        while (this.isSetOperator(this.peek())) {
            query = this.parseSetOperation(query);
        }

        return query;
    }

    private parseDataType(): string {
        let typeName = this.consume().value; // e.g., 'VARCHAR', 'INT', 'DECIMAL'

        // Handle types with length/precision: VARCHAR(50), DECIMAL(18,2)
        if (this.peek()?.type === TokenType.OpenParen) {
            typeName += this.consume().value; // '('

            while (this.pos < this.tokens.length && this.peek()?.type !== TokenType.CloseParen) {
                typeName += this.consume().value;
            }

            if (this.peek()?.type === TokenType.CloseParen) {
                typeName += this.consume().value; // ')'
            }
        }
        return typeName;
    }

    private stringifyExpression(expr: Expression | null): string {
        if (!expr) {
            return '<missing>';
        }

        switch (expr.type) {
            case 'Literal':
                return expr.variant === 'string'
                    ? `'${expr.value}'`
                    : String(expr.value);

            case 'Identifier':
                return expr.name;

            case 'Variable':
                return expr.name;

            case 'SubqueryExpression':
                return 'derived_table';

            case 'BinaryExpression': {
                const left = this.stringifyExpression(expr.left);
                const right = this.stringifyExpression(expr.right);

                // Recoverable AST support:
                // "Id =" instead of "Id = <missing>" if incomplete
                if (!expr.right && expr.incomplete) {
                    return `${left} ${expr.operator}`;
                }

                return `${left} ${expr.operator} ${right}`;
            }

            case 'UnaryExpression': {
                const rightSide = this.stringifyExpression(expr.right);
                const isPostfix =
                    ['IS NULL', 'IS NOT NULL']
                        .includes(expr.operator.toUpperCase());

                if (!expr.right && expr.incomplete) {
                    return isPostfix
                        ? expr.operator
                        : `${expr.operator}`;
                }

                return isPostfix
                    ? `${rightSide} ${expr.operator}`
                    : `${expr.operator} ${rightSide}`;
            }

            case 'BetweenExpression': {
                const left = this.stringifyExpression(expr.left);
                const lower = this.stringifyExpression(expr.lowerBound);
                const upper = this.stringifyExpression(expr.upperBound);

                return `${left} ${expr.isNot ? 'NOT ' : ''
                    }BETWEEN ${lower} AND ${upper}`;
            }

            case 'FunctionCall':
                return `${expr.name}(${expr.args
                    .map(a => this.stringifyExpression(a))
                    .join(', ')})`;

            case 'GroupingExpression':
                return `(${this.stringifyExpression(expr.expression)})`;

            case 'CaseExpression':
                return 'CASE ... END';

            case 'InExpression': {
                const left = this.stringifyExpression(expr.left);

                if (expr.subquery) {
                    return `${left} ${expr.isNot ? 'NOT ' : ''}IN (subquery)`;
                }

                const list = expr.list?.length
                    ? expr.list.map(x => this.stringifyExpression(x)).join(', ')
                    : '';

                return `${left} ${expr.isNot ? 'NOT ' : ''}IN (${list})`;
            }

            case 'MemberExpression':
                return expr.name ||
                    `${this.stringifyExpression(expr.object)}.${expr.property}`;

            case 'OverExpression':
                return `${this.stringifyExpression(expr.expression)} OVER (...)`;

            default:
                return '';
        }
    }

    private resync(): void {
        // 1. Always move forward at least one token to avoid infinite loops
        this.pos++;

        // 2. Skip tokens until we find a semicolon or a major statement keyword
        while (this.pos < this.tokens.length) {
            const val = this.peek()?.value;
            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
                break;
            }
            if (RESYNC_KEYWORDS.has(val!)) break;
            this.pos++;
        }
    }
}