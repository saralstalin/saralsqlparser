import { Lexer, Token, TokenType } from './lexer';

export type NodeLocation = {
    start: number;
    end: number;
};

export type Expression =
    | { type: 'BinaryExpression'; left: Expression; operator: string; right: Expression } & NodeLocation
    | UnaryExpression & NodeLocation
    | { type: 'Literal'; value: string | number | null; variant: 'string' | 'number' | 'null' } & NodeLocation
    | { type: 'Identifier'; name: string; parts: string[]; tablePrefix?: string } & NodeLocation
    | { type: 'Variable'; name: string } & NodeLocation
    | { type: 'FunctionCall'; name: string; args: Expression[] } & NodeLocation
    | { type: 'CaseExpression'; input?: Expression; branches: { when: Expression, then: Expression }[]; elseBranch?: Expression } & NodeLocation
    | { type: 'InExpression'; left: Expression; list?: Expression[]; subquery?: QueryStatement; isNot: boolean } & NodeLocation
    | BetweenExpression & NodeLocation
    | { type: 'GroupingExpression'; expression: Expression } & NodeLocation
    | SubqueryExpression & NodeLocation
    | OverExpression & NodeLocation;


export interface JoinNode extends NodeLocation {
    type: string;
    table: string | Expression;
    on: Expression | null;
    hints?: string[];
    alias?: string;
}


export interface ColumnNode extends NodeLocation {
    type: 'Column';
    expression: Expression;
    tablePrefix?: string;
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

export interface UnaryExpression extends NodeLocation {
    type: 'UnaryExpression';
    operator: string;
    right: Expression;
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


// Add this near your other type definitions
export type QueryStatement = SelectNode | SetOperatorNode;

// Update your Statement union to include Insert
export type Statement = (QueryStatement | InsertNode | UpdateNode | DeleteNode | DeclareNode | SetNode | CreateNode | IfNode | BlockNode | WithNode | { type: 'PrintStatement', value: Expression }) & NodeLocation;

export interface Program {
    type: 'Program';
    body: Statement[]; // Update this from any[]
}

export interface TableReference extends NodeLocation {
    type: 'TableReference';
    // Keeping your structure: string for tables, SubqueryExpression for derived tables
    table: string | SubqueryExpression;
    alias?: string;
    schema?: string;    // Highly recommended for LSP (e.g., 'dbo')
    hints?: string[];   // T-SQL hints like NOLOCK, ROWLOCK
    joins: JoinNode[];
}

export interface SelectNode extends NodeLocation {
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

export interface InsertNode extends NodeLocation {
    type: 'InsertStatement';
    table: string;
    columns: string[] | null;
    values: Expression | null;
    selectQuery: SelectNode | SetOperatorNode | null;
}

export interface UpdateNode extends NodeLocation {
    type: 'UpdateStatement';
    target: string;        // The table or alias being updated
    assignments: { column: string, value: Expression }[];
    from: TableReference | null;
    where: Expression | null;
}

export interface DeleteNode extends NodeLocation {
    type: 'DeleteStatement';
    target: string;         // The table or alias being deleted from
    from: TableReference | null;
    where: Expression | null;
}

export interface VariableDeclaration extends NodeLocation {
    name: string;        // e.g., "@BatchID"
    dataType: string;    // e.g., "INT" or "VARCHAR(MAX)"
    initialValue?: Expression; // Optional initial value (e.g., "10" or "@ID + 1")
}

export interface DeclareNode extends NodeLocation {
    type: 'DeclareStatement';
    variables: VariableDeclaration[];
}

export interface SetNode extends NodeLocation {
    type: 'SetStatement';
    variable: string; // e.g., "@ID"
    value: Expression;    // e.g., "10" or "@ID + 1"
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

    public parse(): Program {
        const statements: Statement[] = [];
        while (this.pos < this.tokens.length) {

            // 1. Allow the variable to be null initially
            let stmt: Statement | null = this.parseStatement();

            // 2. Only proceed if we actually got a statement
            if (stmt) {
                // Check for SET operators (UNION, EXCEPT, INTERSECT)
                if (stmt.type === 'SelectStatement' || stmt.type === 'SetOperator') {
                    while (this.pos < this.tokens.length) {
                        const nextVal = this.peek()?.value;
                        if (nextVal && ['UNION', 'EXCEPT', 'INTERSECT'].includes(nextVal)) {
                            // We cast to QueryStatement because we verified the type above
                            stmt = this.parseSetOperation(stmt as QueryStatement);
                        } else {
                            break;
                        }
                    }
                }

                // Now that we've processed potential SET operations, push the final stmt
                statements.push(stmt);
            }

            // Consume optional semicolon regardless of whether stmt was null
            if (this.peek()?.type === TokenType.Semicolon) this.consume();


        }
        return { type: 'Program', body: statements };
    }

    // Inside class Parser
    private parseMultipartIdentifier(): { type: 'Identifier'; name: string; parts: string[]; start: number; end: number } {
        const segments: Token[] = [];
        const first = this.consume();
        segments.push(first);

        // Rule #4: The Dot is now its own TokenType.Dot
        while (this.peek()?.type === TokenType.Dot) {
            this.consume(); // consume the '.' token

            const next = this.peek();
            if (
                next &&
                (next.type === TokenType.Identifier ||
                    next.type === TokenType.Keyword ||
                    next.type === TokenType.Variable ||
                    next.type === TokenType.TempTable)
            ) {
                segments.push(this.consume());
            } else {
                // Found a dot but no valid following segment; 
                // break to allow the error handler or resync to handle it.
                break;
            }
        }

        const lastSegment = segments[segments.length - 1];

        return {
            type: 'Identifier',
            name: segments.map(t => t.value).join('.'),
            parts: segments.map(t => t.value),
            start: segments[0].offset,
            end: lastSegment.offset + lastSegment.value.length
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
                case 'SELECT':
                    stmt = this.parseSelect();
                    // Handle Set Operators (UNION/EXCEPT/INTERSECT)
                    let next = this.peek()?.value;
                    while (next && ['UNION', 'EXCEPT', 'INTERSECT'].includes(next)) {
                        stmt = this.parseSetOperation(stmt as QueryStatement);
                        next = this.peek()?.value;
                    }
                    break;

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

                case 'PRINT':
                    this.consume();
                    const message = this.parseExpression();
                    stmt = {
                        type: 'PrintStatement',
                        value: message,
                        start: startOffset,
                        end: message.end
                    } as any;
                    break;

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
            console.error(errorMsg);

            const errorEnd = this.peek() ? this.peek()!.offset + this.peek()!.value.length : startOffset + 1;
            this.resync();

            return {
                type: 'ErrorStatement',
                message: errorMsg,
                start: startOffset,
                end: errorEnd
            } as any;
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
        const startToken = this.matchKeyword('SELECT'); // Start tracking from SELECT

        // 1. Handle DISTINCT / ALL
        let distinct = false;
        if (this.peekKeyword('DISTINCT')) {
            this.consume();
            distinct = true;
        } else if (this.peekKeyword('ALL')) {
            this.consume();
        }

        // 2. Handle TOP
        let top: string | null = null;
        if (this.peekKeyword('TOP')) {
            this.consume();
            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            top = this.consume().value;

            if (hasParens) this.match(TokenType.CloseParen);

            if (this.peekKeyword('PERCENT')) {
                top += ' PERCENT';
                this.consume();
            }
        }

        // 3. Handle Column List
        const columns = this.parseList(() => this.parseColumn());

        // Initialize endOffset with the end of the last column
        let endOffset = columns[columns.length - 1].end;

        // 4. Handle FROM
        let from: TableReference[] | null = null;
        if (this.peekKeyword('FROM')) {
            // We use parseList to handle: FROM Table1 WITH(NOLOCK), Table2
            from = this.parseList(() => this.parseFrom());
            endOffset = from[from.length - 1].end;
        }

        // 5. Handle WHERE
        let where: Expression | null = null;
        if (this.peekKeyword('WHERE')) {
            this.consume(); // WHERE
            where = this.parseExpression();
            endOffset = where.end;
        }

        // 6. Handle GROUP BY
        let groupBy: Expression[] | null = null;
        if (this.peekKeyword('GROUP')) {
            this.consume(); // GROUP
            this.matchKeyword('BY');
            groupBy = this.parseList(() => this.parseExpression());
            endOffset = groupBy[groupBy.length - 1].end;
        }

        // 7. Handle HAVING
        let having: Expression | null = null;
        if (this.peekKeyword('HAVING')) {
            this.consume(); // HAVING
            having = this.parseExpression();
            endOffset = having.end;
        }

        // 8. Handle ORDER BY
        // 8. Handle ORDER BY
        let orderBy: OrderByNode[] | null = null;
        if (this.peekKeyword('ORDER')) {
            this.consume(); // ORDER
            this.matchKeyword('BY');

            orderBy = this.parseList(() => {
                const expr = this.parseExpression(); // This is the 'Expression' object
                let direction: 'ASC' | 'DESC' = 'ASC';
                let itemEnd = expr.end;

                if (this.peekKeyword('DESC')) {
                    const dirToken = this.consume();
                    direction = 'DESC';
                    itemEnd = dirToken.offset + dirToken.value.length;
                } else if (this.peekKeyword('ASC')) {
                    const dirToken = this.consume();
                    direction = 'ASC';
                    itemEnd = dirToken.offset + dirToken.value.length;
                }

                // Fix: Include 'expression' and 'column' (as string) to satisfy the interface
                return {
                    column: this.stringifyExpression(expr),
                    expression: expr,
                    direction,
                    start: expr.start,
                    end: itemEnd
                } as OrderByNode;
            });

            if (orderBy.length > 0) {
                endOffset = orderBy[orderBy.length - 1].end;
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
            end: endOffset
        };
    }



    private parseInsert(): InsertNode {
        const startToken = this.matchKeyword('INSERT');

        if (this.peekKeyword('INTO')) {
            this.consume();
        }

        // 1. Gold Standard: Use the Multipart Identifier resolver
        const tableNode = this.parseMultipartIdentifier();

        let columns: string[] | null = null;
        if (this.peek()?.type === TokenType.OpenParen) {
            this.consume(); // (
            columns = this.parseList(() => this.consume().value);
            this.match(TokenType.CloseParen);
        }

        let values: Expression | null = null;
        let selectQuery: SelectNode | SetOperatorNode | null = null;
        let endOffset = tableNode.end;

        const nextVal = this.peek()?.value;

        // 2. Handle VALUES Clause
        if (nextVal === 'VALUES') {
            this.consume(); // VALUES
            this.match(TokenType.OpenParen);

            values = this.parseExpression();

            const closeParen = this.match(TokenType.CloseParen);
            endOffset = closeParen.offset + closeParen.value.length;
        }
        // 3. Handle INSERT INTO ... SELECT
        else if (nextVal === 'SELECT') {
            const query = this.parseSelect() as QueryStatement;
            selectQuery = query;
            endOffset = query.end;
        }

        // 4. Return with full NodeLocation (start/end)
        return {
            type: 'InsertStatement',
            table: tableNode.name,
            columns: columns,
            values: values,
            selectQuery: selectQuery,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseUpdate(): UpdateNode {
        const startToken = this.matchKeyword('UPDATE'); // Start tracking from UPDATE

        // 1. Gold Standard: Use Multipart Resolver for target table
        const targetNode = this.parseMultipartIdentifier();

        this.matchKeyword('SET');

        const assignments = this.parseList(() => {
            // Support multipart for column names (e.g., SET T.Name = ...)
            const columnNode = this.parseMultipartIdentifier();
            this.matchValue('=');
            const value = this.parseExpression();
            return {
                column: columnNode.name,
                value
            };
        });

        let from: TableReference | null = null;
        if (this.peekKeyword('FROM')) {
            from = this.parseFrom();
        }

        let where: Expression | null = null;
        let endOffset = assignments[assignments.length - 1].value.end;

        if (this.peekKeyword('WHERE')) {
            this.consume(); // WHERE
            where = this.parseExpression();
            endOffset = where.end;
        } else if (from) {
            // If no WHERE, end at the last table reference in FROM
            endOffset = (from as any).end || endOffset;
        }

        return {
            type: 'UpdateStatement',
            target: targetNode.name,
            assignments,
            from,
            where,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseFrom(): TableReference {
        const fromToken = this.matchKeyword('FROM');
        let source: Expression;
        let alias: string | null = null;
        let hints: string[] | undefined;

        // 1. Handle Subquery vs Table Reference
        const next = this.peek();
        const nextNext = this.peek(1);

        if (next?.type === TokenType.OpenParen && nextNext?.value === 'SELECT') {
            const openParen = this.match(TokenType.OpenParen);
            const subquery = this.parseSelect() as QueryStatement;
            const closeParen = this.match(TokenType.CloseParen);

            source = {
                type: 'SubqueryExpression',
                query: subquery,
                start: openParen.offset,
                end: closeParen.offset + closeParen.value.length
            };
        } else {
            source = this.parseMultipartIdentifier();
        }

        // 2. Capture Alias logic
        const stopKeywords = [
            'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN',
            'WHERE', 'GROUP', 'ORDER', 'UNION', 'ALL', 'ON',
            'APPLY', 'OUTER', 'EXCEPT', 'INTERSECT', 'WITH' // Added 'with' to stopKeywords for alias
        ];

        let endOffset = source.end;
        const aliasToken = this.peek();

        if (aliasToken?.value === 'AS') {
            this.consume();
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        } else if (
            aliasToken &&
            (aliasToken.type === TokenType.Identifier || aliasToken.type === TokenType.Keyword) &&
            !stopKeywords.includes(aliasToken.value)
        ) {
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        }

        // --- NEW: Parse Table Hints (T-SQL specific) ---
        // Hints only apply to physical tables, not subqueries
        if (source.type === 'Identifier') {
            const nextToken = this.peek();
            // Check for WITH (NOLOCK) or legacy (NOLOCK)
            if (nextToken?.value === 'WITH' ||
                (nextToken?.type === TokenType.OpenParen && alias)) {
                hints = this.parseTableHints();
                // Update endOffset to include the hint range
                const lastHintToken = this.tokens[this.pos - 1];
                endOffset = lastHintToken.offset + lastHintToken.value.length;
            }
        }
        // -----------------------------------------------

        // 3. Parse Join Sequence
        const joins: JoinNode[] = [];
        while (this.isJoinToken(this.peek())) {
            const join = this.parseJoin();
            joins.push(join);
            endOffset = join.end;
        }

        // 4. Resolve the table value for the AST
        let tableValue: string | SubqueryExpression;
        if (source.type === 'SubqueryExpression') {
            tableValue = source;
        } else if (source.type === 'Identifier') {
            tableValue = (source as any).name;
        } else {
            tableValue = this.stringifyExpression(source);
        }

        return {
            type: 'TableReference',
            table: tableValue as any,
            alias: alias || undefined,
            hints, // Added to return object
            joins,
            start: fromToken.offset,
            end: endOffset
        };
    }

    private parseTableHints(): string[] {
        // Optional 'WITH' keyword
        if (this.peekKeyword('WITH')) {
            this.consume();
        }

        this.match(TokenType.OpenParen);
        const hints = this.parseList(() => {
            let hint = this.consume().value;
            // Support nested parentheses for INDEX hints: INDEX(1) or INDEX(IX_Name)
            if (this.peek()?.type === TokenType.OpenParen) {
                hint += this.consume().value; // (
                hint += this.consume().value; // name/id
                hint += this.match(TokenType.CloseParen).value; // )
            }
            return hint;
        });
        this.match(TokenType.CloseParen);

        return hints;
    }

    private parseJoin(): JoinNode {
        const startToken = this.peek(); // Capture the start of the join sequence
        let type = '';

        // 1. Determine Join Type
        const first = this.consume().value.toUpperCase();

        if (['LEFT', 'RIGHT', 'FULL'].includes(first)) {
            if (this.peekKeyword('OUTER')) {
                this.consume();
                type = `${first} OUTER JOIN`;
            } else {
                type = `${first} JOIN`;
            }
            this.matchKeyword('JOIN');
        } else if (first === 'INNER') {
            this.matchKeyword('JOIN');
            type = 'INNER JOIN';
        } else if (first === 'CROSS') {
            const next = this.consume().value.toUpperCase();
            if (next === 'JOIN') {
                type = 'CROSS JOIN';
            } else if (next === 'APPLY') {
                type = 'CROSS APPLY';
            } else {
                type = `CROSS ${next}`;
            }
        } else if (first === 'OUTER') {
            const next = this.consume().value.toUpperCase();
            if (next === 'APPLY') {
                type = 'OUTER APPLY';
            } else {
                type = `OUTER ${next}`;
            }
        } else if (first === 'JOIN') {
            type = 'INNER JOIN';
        } else {
            type = `${first} JOIN`;
        }

        // 2. Parse the Join Target
        let tableTarget: Expression;
        const nextToken = this.peek();
        const nextNext = this.peek(1);

        if (nextToken?.type === TokenType.OpenParen && nextNext?.value === 'SELECT') {
            const openParen = this.match(TokenType.OpenParen);
            const subquery = this.parseSelect() as QueryStatement;
            const closeParen = this.match(TokenType.CloseParen);
            tableTarget = {
                type: 'SubqueryExpression',
                query: subquery,
                start: openParen.offset,
                end: closeParen.offset + closeParen.value.length
            };
        } else {
            tableTarget = this.parsePrefix();
        }

        // 3. Parse Alias
        let alias: string | null = null;
        // Added 'with' to stopKeywords to prevent it being treated as an alias
        const stopKeywords = ['ON', 'WHERE', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN', 'OUTER', 'UNION', 'EXCEPT', 'INTERSECT', 'WITH'];

        let endOffset = tableTarget.end;
        const potentialAlias = this.peek();

        if (potentialAlias?.value === 'AS') {
            this.consume(); // as
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        } else if (
            potentialAlias &&
            (potentialAlias.type === TokenType.Identifier || potentialAlias.type === TokenType.Keyword) &&
            !stopKeywords.includes(potentialAlias.value)
        ) {
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        }

        // --- NEW: Parse Table Hints for Joined Table ---
        let hints: string[] | undefined;
        if (tableTarget.type === 'Identifier') {
            const hintNext = this.peek();
            if (hintNext?.value === 'WITH' ||
                (hintNext?.type === TokenType.OpenParen && alias)) {
                hints = this.parseTableHints();
                const lastHintToken = this.tokens[this.pos - 1];
                endOffset = lastHintToken.offset + lastHintToken.value.length;
            }
        }
        // ------------------------------------------------

        // 4. Parse ON condition
        let on: Expression | null = null;
        if (this.peekKeyword('ON')) {
            this.consume(); // ON
            on = this.parseExpression();
            endOffset = on.end;
        }

        return {
            type: type.trim(),
            table: tableTarget.type === 'Identifier' ? (tableTarget as any).name : (tableTarget as any),
            alias: alias || undefined,
            hints, // Include the hints in the returned JoinNode
            on,
            start: startToken!.offset,
            end: endOffset
        } as any;
    }

    private parseDelete(): DeleteNode {
        const startToken = this.matchKeyword('DELETE');

        // T-SQL: DELETE [FROM] target ...
        if (this.peekKeyword('FROM')) {
            this.consume();
        }

        // Gold Standard: Capture the target name explicitly
        const targetNode = this.parseMultipartIdentifier();
        const target = targetNode.name; // This will capture 'u'
        let endOffset = targetNode.end;

        // Check if another FROM follows (DELETE u FROM ...)
        if (this.peekKeyword('FROM')) {
            this.consume();
        }

        let from: TableReference | null = null;
        const next = this.peek()?.value;
        // Only parseFrom if we aren't hitting a WHERE or statement end
        if (next && !['WHERE', ';', 'GO'].includes(next)) {
            from = this.parseFrom();
            endOffset = from.end;
        }

        let where: Expression | null = null;
        if (this.peekKeyword('WHERE')) {
            this.consume();
            where = this.parseExpression();
            endOffset = where.end;
        }

        return {
            type: 'DeleteStatement',
            target, // Ensures 'u' is returned to the test
            from,
            where,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseDeclare(): DeclareNode {
        const startToken = this.matchKeyword('DECLARE'); // Normalized Uppercase match

        const variables = this.parseList<ParameterDefinition>(() => {
            const nameToken = this.match(TokenType.Variable);
            const name = nameToken.value;

            // 1. Parse Data Type (e.g., VARCHAR, INT, DECIMAL)
            let dataType = this.consume().value;

            // Handle length/precision (e.g., (MAX), (50), (18,2))
            if (this.peek()?.type === TokenType.OpenParen) {
                dataType += this.consume().value; // (
                while (this.pos < this.tokens.length && this.peek()?.type !== TokenType.CloseParen) {
                    dataType += this.consume().value;
                }
                dataType += this.match(TokenType.CloseParen).value; // )
            }

            // 2. Handle Initial Assignment (e.g., @Var INT = 10)
            let initialValue: Expression | null = null;
            // The Lexer now correctly identifies '=' as an Operator
            if (this.peek()?.type === TokenType.Operator && this.peek()?.value === '=') {
                this.consume(); // =
                initialValue = this.parseExpression();
            }

            const lastToken = this.tokens[this.pos - 1];

            return {
                name,
                dataType,
                initialValue,
                isOutput: false,
                start: nameToken.offset,
                // If we have an initialValue, use its end, otherwise use the data type's end
                end: initialValue ? initialValue.end : (lastToken.offset + lastToken.value.length)
            };
        });

        // 3. Calculate the exact end of the statement based on the last variable in the list
        const lastVar = variables[variables.length - 1];
        const endOffset = lastVar ? lastVar.end : (startToken.offset + startToken.value.length);

        return {
            type: 'DeclareStatement',
            variables,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseSet(): SetNode {
        const startToken = this.consume(); // SET

        // Capture the variable/option token
        const varToken = this.consume();
        const variable = varToken.value;

        // 1. Handle T-SQL Session Options (e.g., SET NOCOUNT ON)
        if (!variable.startsWith('@')) {
            const valToken = this.consume(); // ON, OFF, etc.

            return {
                type: 'SetStatement',
                variable,
                value: {
                    type: 'Literal',
                    value: valToken.value,
                    variant: 'string',
                    start: valToken.offset,
                    end: valToken.offset + valToken.value.length
                },
                start: startToken.offset,
                end: valToken.offset + valToken.value.length
            };
        }

        // 2. Handle Variable Assignment (e.g., SET @Var = 1)
        this.matchValue('=');
        const value = this.parseExpression();

        return {
            type: 'SetStatement',
            variable,
            value,
            start: startToken.offset,
            end: value.end // Use the end of the expression
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

            const lastToken = this.tokens[this.pos - 1];

            return {
                name,
                dataType,
                constraints: constraints.length > 0 ? constraints : undefined,
                start: startToken.offset,
                end: lastToken.offset + lastToken.value.length
            };
        });

        this.match(TokenType.CloseParen);

        return columns;
    }

    private parseCreate(): CreateNode {
        const startToken = this.matchKeyword('CREATE'); // Start tracking from CREATE
        const rawType = this.consume().value.toUpperCase();

        // 1. Standardize types for the AST
        let objectType: CreateNode['objectType'] = rawType as any;
        if (rawType === 'PROC') objectType = 'PROCEDURE';

        // 2. Gold Standard: Use Multipart Resolver for name
        // This correctly handles [dbo].[MyTable] and returns start/end for the name
        const nameNode = this.parseMultipartIdentifier();
        const name = nameNode.name;

        let columns: ColumnDefinition[] | undefined = undefined;
        let parameters: ParameterDefinition[] | undefined = undefined;
        let body: Statement | Statement[] | undefined = undefined;
        let isTableType: boolean | undefined = undefined;

        // 3. Handle CREATE TYPE ... AS TABLE
        if (objectType === 'TYPE') {
            if (this.peekKeyword('AS')) {
                this.consume(); // AS
                if (this.peekKeyword('TABLE')) {
                    this.consume(); // TABLE
                    columns = this.parseTableColumns();
                    isTableType = true;
                }
            }
        }

        // 4. Handle CREATE TABLE
        else if (objectType === 'TABLE') {
            columns = this.parseTableColumns();
        }

        // 5. Handle Parameters for Procedures/Functions
        else if (objectType === 'PROCEDURE' || objectType === 'FUNCTION') {
            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            // Rule #1: Use the improved parseList logic
            if (this.peek()?.type === TokenType.Variable) {
                parameters = this.parseList<ParameterDefinition>(() => {
                    const startToken = this.peek()!;
                    const pName = this.consume().value; // @Param

                    // Parse Type (handles VARCHAR(MAX), DECIMAL(18,2) etc)
                    let pType = this.consume().value;
                    if (this.peek()?.type === TokenType.OpenParen) {
                        pType += this.consume().value; // (
                        while (this.pos < this.tokens.length && this.peek()?.type !== TokenType.CloseParen) {
                            pType += this.consume().value;
                        }
                        pType += this.match(TokenType.CloseParen).value; // )
                    }

                    let isOutput = false;
                    // Rule #3: Lexer now provides Uppercase keywords
                    const nextToken = this.peek();
                    if (nextToken?.type === TokenType.Keyword && (nextToken.value === 'OUTPUT' || nextToken.value === 'OUT')) {
                        isOutput = true;
                        this.consume();
                    }

                    const lastToken = this.tokens[this.pos - 1];

                    // Return the full ParameterDefinition matching the interface
                    return {
                        name: pName,
                        dataType: pType,
                        isOutput,
                        start: startToken.offset,
                        end: lastToken.offset + lastToken.value.length
                    };
                });
            }
            if (hasParens) this.match(TokenType.CloseParen);
        }

        // 6. Handle the Body (AS SELECT... or Statement Blocks)
        if (this.peekKeyword('AS')) {
            this.consume(); // AS
        }

        if (objectType === 'VIEW') {
            body = this.parseSelect() as QueryStatement;
        } else if (['PROCEDURE', 'FUNCTION'].includes(objectType)) {
            const statements: Statement[] = [];
            const stopKeywords = ['GO'];

            while (this.pos < this.tokens.length) {
                const nextToken = this.peek();
                if (!nextToken || stopKeywords.includes(nextToken.value)) break;

                const stmt = this.parseStatement();
                if (stmt) {
                    statements.push(stmt);
                } else {
                    break;
                }
            }
            body = statements;
        }

        // 7. Calculate End Offset for the whole CREATE statement
        let endOffset = nameNode.end;
        if (Array.isArray(body) && body.length > 0) {
            endOffset = body[body.length - 1].end;
        } else if (body && !Array.isArray(body)) {
            endOffset = (body as Statement).end;
        } else if (columns) {
            // Find the offset of the last token (usually the closing paren of the column list)
            const lastToken = this.tokens[this.pos - 1];
            endOffset = lastToken.offset + lastToken.value.length;
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
        let tablePrefix: string | undefined = undefined;
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
                // Use Multipart here in case alias is bracketed like: AS [User Name]
                alias = this.parseMultipartIdentifier().name;
            } else if (
                nextToken &&
                nextToken.type !== TokenType.Semicolon &&
                nextToken.type !== TokenType.Comma &&
                (nextToken.type === TokenType.Identifier || nextToken.type === TokenType.Keyword) &&
                !STOP_KEYWORDS.includes(nextVal!)
            ) {
                // Implicit alias: SELECT Col AliasName
                alias = this.parseMultipartIdentifier().name;
            }
        }

        // 3. Extraction logic for name and tablePrefix
        if (expression.type === 'Identifier') {
            const parts = expression.parts || [];
            if (parts.length > 1) {
                name = parts[parts.length - 1];
                tablePrefix = parts.slice(0, -1).join('.');
            } else {
                name = expression.name;
            }
        } else if (expression.type === 'FunctionCall') {
            name = expression.name;
        } else if (expression.type === 'Literal') {
            name = String(expression.value);
        } else {
            name = 'expression';
        }

        // 4. Calculate end offset based on whether an alias exists
        let endOffset = expression.end;
        if (alias) {
            // If an alias exists, the column definition ends at the last token consumed
            const lastToken = this.tokens[this.pos - 1];
            endOffset = lastToken.offset + lastToken.value.length;
        }

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
        const val = token.value;
        return ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'FULL'].includes(val);
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

            // --- 1. Handle Structural Dot (.) ---
            if (operatorToken.type === TokenType.Dot) {
                const rightToken = this.match(TokenType.Identifier, TokenType.Keyword);
                // Transform into a multipart-style identifier or member access
                left = {
                    type: 'Identifier',
                    parts: left.type === 'Identifier' ? [...(left as any).parts, rightToken.value] : [this.stringifyExpression(left), rightToken.value],
                    name: left.type === 'Identifier' ? `${(left as any).name}.${rightToken.value}` : `${this.stringifyExpression(left)}.${rightToken.value}`,
                    start: left.start,
                    end: rightToken.offset + rightToken.value.length
                } as any;
            }
            // --- 2. Handle IS / IS NOT NULL ---
            else if (val === 'IS') {
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
                } as any;
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
        if (this.peekKeyword('SELECT')) {
            subquery = this.parseSelect() as QueryStatement;
        } else {
            list = [];
            // Use parseList helper if available, or this manual loop
            while (this.pos < this.tokens.length && this.peek()?.type !== TokenType.CloseParen) {
                list.push(this.parseExpression(Precedence.LOWEST));
                if (this.peek()?.value === ',') {
                    this.consume();
                } else {
                    break;
                }
            }
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
                return { type: 'Identifier', name: value, parts: [value], start, end: start + value.length };

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
                        } as any);
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
        if (token && token.type === TokenType.Keyword && token.value === value.toUpperCase()) {
            return this.consume();
        }

        throw new Error(`Expected keyword "${value.toUpperCase()}" but found "${token?.value}" at line ${token?.line}`);
    }

    private peekKeyword(value: string): boolean {
        const token = this.peek();
        // Compare against the Uppercase version since Lexer normalized it
        return token?.type === TokenType.Keyword && token.value === value.toUpperCase();
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
            this.matchValue('THEN');
            const then = this.parseExpression(Precedence.LOWEST);
            branches.push({ when, then });
        }

        let elseBranch: Expression | undefined = undefined;
        if (this.peek()?.value === 'ELSE') {
            this.consume(); // ELSE
            elseBranch = this.parseExpression(Precedence.LOWEST);
        }

        // 3. Match 'END' and capture its full range for the end offset
        const endToken = this.matchValue('END');
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
        const startToken = this.consume();
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
            const query = this.parseSelect() as QueryStatement;
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
                    column: this.stringifyExpression(e),
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

    private stringifyExpression(expr: Expression): string {
        switch (expr.type) {
            case 'Literal':
                return expr.variant === 'string' ? `'${expr.value}'` : String(expr.value);
            case 'Identifier':
                return expr.tablePrefix ? `${expr.tablePrefix}.${expr.name}` : expr.name;
            case 'Variable':
                return expr.name;
            case 'SubqueryExpression':
                return 'derived_table';
            case 'BinaryExpression':
                return `${this.stringifyExpression(expr.left)} ${expr.operator} ${this.stringifyExpression(expr.right)}`;
            case 'UnaryExpression': {
                const isPostfix = ['IS NULL', 'IS NOT NULL'].includes(expr.operator.toUpperCase());
                const rightSide = this.stringifyExpression(expr.right);
                return isPostfix
                    ? `${rightSide} ${expr.operator}`
                    : `${expr.operator} ${rightSide}`;
            }
            case 'BetweenExpression':
                return `${this.stringifyExpression(expr.left)} ${expr.isNot ? 'NOT ' : ''}BETWEEN ${this.stringifyExpression(expr.lowerBound)} AND ${this.stringifyExpression(expr.upperBound)}`;
            case 'FunctionCall':
                return `${expr.name}(${expr.args.map(a => this.stringifyExpression(a)).join(', ')})`;
            default: return '';
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
            if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'DECLARE', 'IF', 'BEGIN', 'CREATE', 'WITH', 'GO', 'WHEN', 'THEN', 'ELSE', 'END'].includes(val!)) {
                break;
            }
            this.pos++;
        }
    }
}