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
    | SubqueryExpression & NodeLocation;


export interface JoinNode extends NodeLocation {
    type: string;
    table: string | Expression;
    on: Expression | null;
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
    table: string | SubqueryExpression; // Can be a string for simple tables or an Expression for subqueries
    alias?: string;
    joins: JoinNode[];
}

export interface SelectNode extends NodeLocation {
    type: 'SelectStatement';
    distinct: boolean;
    top: string | null;
    columns: ColumnNode[];
    from: TableReference | null;
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
    'or': Precedence.OR,
    'and': Precedence.AND,
    'not': Precedence.NOT,
    'is': Precedence.COMPARE,
    'in': Precedence.COMPARE,
    'between': Precedence.COMPARE,
    'like': Precedence.COMPARE,
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
    'collate': Precedence.CALL,
    '(': Precedence.CALL,
    '.': Precedence.CALL  // Added for schema.table.column resolution
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
    private match(type: TokenType): Token {
        const token = this.peek();
        if (!token || token.type !== type) {
            throw new Error(`Expected token type ${TokenType[type]} at line ${token?.line}, but found ${token?.value}`);
        }
        return this.consume();
    }

    /**
     * Ensures the current token has a specific value (case-insensitive) and consumes it.
     * Perfect for keywords like 'AND' in the BETWEEN clause.
     */
    private matchValue(value: string): Token {
        const token = this.peek();
        if (!token || token.value.toLowerCase() !== value.toLowerCase()) {
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
                        const nextVal = this.peek()?.value.toLowerCase();
                        if (nextVal && ['union', 'except', 'intersect'].includes(nextVal)) {
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

        while (this.peek()?.type === TokenType.Operator && this.peek()?.value === '.') {
            this.consume(); // consume '.'
            if (this.peek()?.type === TokenType.Identifier || this.peek()?.type === TokenType.Keyword) {
                segments.push(this.consume());
            } else {
                break;
            }
        }

        return {
            type: 'Identifier',
            name: segments.map(t => t.value).join('.'),
            parts: segments.map(t => t.value),
            start: segments[0].offset,
            end: segments[segments.length - 1].offset + segments[segments.length - 1].value.length
        };
    }

    private parseSetOperation(left: QueryStatement): SetOperatorNode {
        const operatorToken = this.consume(); // UNION, EXCEPT, INTERSECT
        let type = operatorToken.value.toUpperCase();

        // Handle UNION ALL
        if (type === 'UNION' && this.peek()?.value.toLowerCase() === 'all') {
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
        const next = this.peek()?.value.toLowerCase();
        if (next && ['union', 'except', 'intersect'].includes(next)) {
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
            const val = token.value.toLowerCase();

            switch (val) {
                case 'select':
                    stmt = this.parseSelect();
                    // Handle Set Operators (UNION/EXCEPT/INTERSECT)
                    let next = this.peek()?.value.toLowerCase();
                    while (next && ['union', 'except', 'intersect'].includes(next)) {
                        stmt = this.parseSetOperation(stmt as QueryStatement);
                        next = this.peek()?.value.toLowerCase();
                    }
                    break;

                case 'insert': stmt = this.parseInsert(); break;
                case 'update': stmt = this.parseUpdate(); break;
                case 'delete': stmt = this.parseDelete(); break;
                case 'declare': stmt = this.parseDeclare(); break;
                case 'set': stmt = this.parseSet(); break;
                case 'create': stmt = this.parseCreate(); break;
                case 'if': stmt = this.parseIf(); break;
                case 'begin': stmt = this.parseBlock(); break;

                case 'with':
                    stmt = this.parseWith();
                    break;

                case 'print':
                    this.consume(); // PRINT
                    const message = this.parseExpression();
                    stmt = {
                        type: 'PrintStatement',
                        value: message,
                        start: startOffset,
                        end: message.end
                    } as any;
                    break;

                case 'go':
                    this.consume(); // Batch separator
                    return null;

                case 'when':
                case 'then':
                case 'else':
                case 'end':
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
        const startToken = this.matchKeyword('select'); // Start tracking from SELECT

        // 1. Handle DISTINCT / ALL
        let distinct = false;
        if (this.peekKeyword('distinct')) {
            this.consume();
            distinct = true;
        } else if (this.peekKeyword('all')) {
            this.consume();
        }

        // 2. Handle TOP
        let top: string | null = null;
        if (this.peekKeyword('top')) {
            this.consume();
            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            top = this.consume().value;

            if (hasParens) this.match(TokenType.CloseParen);

            if (this.peekKeyword('percent')) {
                top += ' PERCENT';
                this.consume();
            }
        }

        // 3. Handle Column List
        const columns = this.parseList(() => this.parseColumn());

        // Initialize endOffset with the end of the last column
        let endOffset = columns[columns.length - 1].end;

        // 4. Handle FROM
        let from: TableReference | null = null;
        if (this.peekKeyword('from')) {
            from = this.parseFrom();
            endOffset = from.end;
        }

        // 5. Handle WHERE
        let where: Expression | null = null;
        if (this.peekKeyword('where')) {
            this.consume(); // WHERE
            where = this.parseExpression();
            endOffset = where.end;
        }

        // 6. Handle GROUP BY
        let groupBy: Expression[] | null = null;
        if (this.peekKeyword('group')) {
            this.consume(); // GROUP
            this.matchKeyword('by');
            groupBy = this.parseList(() => this.parseExpression());
            endOffset = groupBy[groupBy.length - 1].end;
        }

        // 7. Handle HAVING
        let having: Expression | null = null;
        if (this.peekKeyword('having')) {
            this.consume(); // HAVING
            having = this.parseExpression();
            endOffset = having.end;
        }

        // 8. Handle ORDER BY
        // 8. Handle ORDER BY
        let orderBy: OrderByNode[] | null = null;
        if (this.peekKeyword('order')) {
            this.consume(); // order
            this.matchKeyword('by');

            orderBy = this.parseList(() => {
                const expr = this.parseExpression(); // This is the 'Expression' object
                let direction: 'ASC' | 'DESC' = 'ASC';
                let itemEnd = expr.end;

                if (this.peekKeyword('desc')) {
                    const dirToken = this.consume();
                    direction = 'DESC';
                    itemEnd = dirToken.offset + dirToken.value.length;
                } else if (this.peekKeyword('asc')) {
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
        const startToken = this.matchKeyword('insert');

        if (this.peekKeyword('into')) {
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

        const nextVal = this.peek()?.value.toLowerCase();

        // 2. Handle VALUES Clause
        if (nextVal === 'values') {
            this.consume(); // VALUES
            this.match(TokenType.OpenParen);

            values = this.parseExpression();

            const closeParen = this.match(TokenType.CloseParen);
            endOffset = closeParen.offset + closeParen.value.length;
        }
        // 3. Handle INSERT INTO ... SELECT
        else if (nextVal === 'select') {
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
        const startToken = this.matchKeyword('update'); // Start tracking from UPDATE

        // 1. Gold Standard: Use Multipart Resolver for target table
        const targetNode = this.parseMultipartIdentifier();

        this.matchKeyword('set');

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
        if (this.peekKeyword('from')) {
            from = this.parseFrom();
        }

        let where: Expression | null = null;
        let endOffset = assignments[assignments.length - 1].value.end;

        if (this.peekKeyword('where')) {
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
        const fromToken = this.matchKeyword('from'); // Start tracking from FROM

        let source: Expression;
        let alias: string | null = null; // Use null to match your common interface style

        // 1. Handle Subquery vs Table Reference
        const next = this.peek();
        const nextNext = this.peek(1);

        if (next?.type === TokenType.OpenParen && nextNext?.value.toLowerCase() === 'select') {
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
            // T-SQL Gold Standard: Use the multipart resolver for table names
            source = this.parseMultipartIdentifier();
        }

        // 2. Capture Alias logic
        const stopKeywords = [
            'inner', 'left', 'right', 'full', 'cross', 'join',
            'where', 'group', 'order', 'union', 'all', 'on',
            'apply', 'outer', 'except', 'intersect'
        ];

        let endOffset = source.end;
        const aliasToken = this.peek();

        if (aliasToken?.value.toLowerCase() === 'as') {
            this.consume(); // AS
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        } else if (
            aliasToken &&
            (aliasToken.type === TokenType.Identifier || aliasToken.type === TokenType.Keyword) &&
            !stopKeywords.includes(aliasToken.value.toLowerCase())
        ) {
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        }

        // 3. Parse Join Sequence
        const joins: JoinNode[] = [];
        while (this.isJoinToken(this.peek())) {
            const join = this.parseJoin();
            joins.push(join);
            endOffset = join.end; // Update end to include the furthest join
        }

        // 4. Resolve the table value for the AST
        let tableValue: string | SubqueryExpression;
        if (source.type === 'SubqueryExpression') {
            tableValue = source;
        } else if (source.type === 'Identifier') {
            tableValue = source.name;
        } else {
            tableValue = this.stringifyExpression(source);
        }

        return {
            table: tableValue as any,
            alias: alias || undefined, // Convert back to undefined if your interface uses '?'
            joins,
            start: fromToken.offset,
            end: endOffset
        };
    }

    private parseJoin(): JoinNode {
        const startToken = this.peek(); // Capture the start of the join sequence
        let type = '';

        // 1. Determine Join Type
        const first = this.consume().value.toUpperCase();

        if (['LEFT', 'RIGHT', 'FULL'].includes(first)) {
            if (this.peekKeyword('outer')) {
                this.consume();
                type = `${first} OUTER JOIN`;
            } else {
                type = `${first} JOIN`;
            }
            this.matchKeyword('join');
        } else if (first === 'INNER') {
            this.matchKeyword('join');
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

        if (nextToken?.type === TokenType.OpenParen && nextNext?.value.toLowerCase() === 'select') {
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
            // Gold Standard: Handles [Schema].[Table] or FunctionCall(args)
            tableTarget = this.parsePrefix();
        }

        // 3. Parse Alias
        let alias: string | null = null;
        const stopKeywords = ['on', 'where', 'inner', 'left', 'right', 'full', 'cross', 'join', 'outer', 'union', 'except', 'intersect'];

        let endOffset = tableTarget.end;
        const potentialAlias = this.peek();

        if (potentialAlias?.value.toLowerCase() === 'as') {
            this.consume(); // as
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        } else if (
            potentialAlias &&
            (potentialAlias.type === TokenType.Identifier || potentialAlias.type === TokenType.Keyword) &&
            !stopKeywords.includes(potentialAlias.value.toLowerCase())
        ) {
            const aliasNode = this.parseMultipartIdentifier();
            alias = aliasNode.name;
            endOffset = aliasNode.end;
        }

        // 4. Parse ON condition
        let on: Expression | null = null;
        if (this.peekKeyword('on')) {
            this.consume(); // on
            on = this.parseExpression();
            endOffset = on.end;
        }

        return {
            type: type.trim(),
            // Pass the actual Expression node if your interface allows it, 
            // otherwise stringify using the node name.
            table: tableTarget.type === 'Identifier' ? tableTarget.name : (tableTarget as any),
            alias: alias || undefined,
            on,
            start: startToken.offset,
            end: endOffset
        };
    }

    private parseDelete(): DeleteNode {
        const startToken = this.matchKeyword('delete');

        // T-SQL: DELETE [FROM] target ...
        if (this.peekKeyword('from')) {
            this.consume();
        }

        // Gold Standard: Capture the target name explicitly
        const targetNode = this.parseMultipartIdentifier();
        const target = targetNode.name; // This will capture 'u'
        let endOffset = targetNode.end;

        // Check if another FROM follows (DELETE u FROM ...)
        if (this.peekKeyword('from')) {
            this.consume();
        }

        let from: TableReference | null = null;
        const next = this.peek()?.value.toLowerCase();
        // Only parseFrom if we aren't hitting a WHERE or statement end
        if (next && !['where', ';', 'go'].includes(next)) {
            from = this.parseFrom();
            endOffset = from.end;
        }

        let where: Expression | null = null;
        if (this.peekKeyword('where')) {
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
        const startToken = this.matchKeyword('declare'); // Start tracking from DECLARE

        const variables = this.parseList(() => {
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
            if (this.peek()?.value === '=') {
                this.consume(); // =
                initialValue = this.parseExpression();
            }

            return { name, dataType, initialValue };
        });

        // 3. Calculate the exact end of the statement
        // If the last variable has an initialValue, use its end. Otherwise, use the last token.
        const lastVar = variables[variables.length - 1];
        let endOffset = startToken.offset + startToken.value.length;

        if (lastVar.initialValue) {
            endOffset = lastVar.initialValue.end;
        } else {
            const lastToken = this.tokens[this.pos - 1];
            endOffset = lastToken.offset + lastToken.value.length;
        }

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
        if (this.peek()?.value !== '(') {
            throw new Error(`Expected '(' at start of column list, found ${this.peek()?.value}`);
        }
        this.consume(); // (

        const columns = this.parseList(() => {
            // 1. Column Name
            const name = this.consume().value;

            // 2. Data Type (e.g., nvarchar(max), decimal(18, 2))
            let dataType = this.consume().value;
            if (this.peek()?.value === '(') {
                dataType += this.consume().value; // (
                dataType += this.consume().value; // size/max
                if (this.peek()?.value === ',') {
                    dataType += this.consume().value; // ,
                    dataType += this.consume().value; // scale
                }
                if (this.peek()?.value === ')') {
                    dataType += this.consume().value; // )
                }
            }

            // 3. Constraint Parsing
            const constraints: string[] = [];
            const stopWords = [',', ')'];

            while (this.pos < this.tokens.length && !stopWords.includes(this.peek()?.value || '')) {
                const currentToken = this.peek();
                if (!currentToken) break;

                const upperVal = currentToken.value.toUpperCase();

                if (upperVal === 'PRIMARY' && this.peek(1)?.value.toUpperCase() === 'KEY') {
                    this.consume(); // PRIMARY
                    this.consume(); // KEY
                    constraints.push('PRIMARY KEY');
                } else if (upperVal === 'NOT' && this.peek(1)?.value.toUpperCase() === 'NULL') {
                    this.consume(); // NOT
                    this.consume(); // NULL
                    constraints.push('NOT NULL');
                } else if (upperVal === 'FOREIGN' && this.peek(1)?.value.toUpperCase() === 'KEY') {
                    this.consume(); // FOREIGN
                    this.consume(); // KEY
                    constraints.push('FOREIGN KEY');
                } else if (upperVal === 'DEFAULT') {
                    this.consume(); // DEFAULT
                    // Parse the default value as a full expression and stringify for the AST
                    const defaultExpr = this.parseExpression(Precedence.LOWEST);
                    constraints.push('DEFAULT ' + this.stringifyExpression(defaultExpr));
                } else {
                    // Catch-all for other keywords like UNIQUE, NULL, IDENTITY, etc.
                    constraints.push(this.consume().value.toUpperCase());
                }
            }

            return {
                name,
                dataType,
                constraints: constraints.length > 0 ? constraints : undefined
            };
        });

        this.match(TokenType.CloseParen); // Standardized match for ')'

        return columns;
    }

    private parseCreate(): CreateNode {
        const startToken = this.matchKeyword('create'); // Start tracking from CREATE
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
            if (this.peekKeyword('as')) {
                this.consume(); // AS
                if (this.peekKeyword('table')) {
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
        else if (['PROCEDURE', 'FUNCTION'].includes(objectType)) {
            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            if (this.peek()?.type === TokenType.Variable) {
                parameters = this.parseList(() => {
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
                    const nextVal = this.peek()?.value.toUpperCase();
                    if (nextVal === 'OUTPUT' || nextVal === 'OUT') {
                        isOutput = true;
                        this.consume();
                    }
                    return { name: pName, dataType: pType, isOutput };
                });
            }
            if (hasParens) this.match(TokenType.CloseParen);
        }

        // 6. Handle the Body (AS SELECT... or Statement Blocks)
        if (this.peekKeyword('as')) {
            this.consume(); // AS
        }

        if (objectType === 'VIEW') {
            body = this.parseSelect() as QueryStatement;
        } else if (['PROCEDURE', 'FUNCTION'].includes(objectType)) {
            const statements: Statement[] = [];
            const stopKeywords = ['go'];

            while (this.pos < this.tokens.length) {
                const nextToken = this.peek();
                if (!nextToken || stopKeywords.includes(nextToken.value.toLowerCase())) break;

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

        const STOP_KEYWORDS = ['from', 'where', 'group', 'order', 'having', 'union', 'all', 'except', 'intersect', 'join', 'on', 'apply', 'into', 'outer', 'values'];

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
            const nextVal = nextToken?.value.toLowerCase();

            if (nextVal === 'as') {
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
        const val = token.value.toLowerCase();
        return ['join', 'inner', 'left', 'right', 'cross', 'full'].includes(val);
    }

    private parseExpression(precedence: Precedence = Precedence.LOWEST): Expression {
        let left = this.parsePrefix();

        while (this.pos < this.tokens.length) {
            const nextToken = this.peek();
            if (!nextToken || nextToken.type === TokenType.Semicolon) break;

            const val = nextToken.value.toLowerCase();
            const structuralStops = [
                'from', 'where', 'group', 'order', 'having',
                'union', 'except', 'intersect', 'on', 'join'
            ];

            if (precedence === Precedence.LOWEST && structuralStops.includes(val)) {
                if (nextToken.type === TokenType.Keyword) break;
            }

            const nextPrecedence = PRECEDENCE_MAP[val] ?? Precedence.LOWEST;
            if (nextPrecedence <= precedence) break;

            const operatorToken = this.consume();
            let operator = operatorToken.value;

            // --- FIX 1: Composite Operator Logic (>=, <=, <>, !=) ---
            const peekNext = this.peek();
            if (peekNext && (operator === '>' || operator === '<' || operator === '!') && peekNext.value === '=') {
                operator += this.consume().value;
            } else if (operator === '<' && peekNext?.value === '>') {
                operator += this.consume().value;
            }
            // -------------------------------------------------------

            if (val === 'is') {
                let isNot = false;
                if (this.peek()?.value.toUpperCase() === 'NOT') {
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
            else if (val === 'not') {
                const innerOpToken = this.consume();
                const innerOp = innerOpToken.value.toLowerCase();

                if (innerOp === 'in') {
                    left = this.parseInExpression(left, true);
                } else if (innerOp === 'between') {
                    left = this.parseBetweenExpression(left, true, nextPrecedence);
                } else if (innerOp === 'like') {
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
                    const right = this.parseExpression(nextPrecedence);
                    left = {
                        type: 'BinaryExpression',
                        left,
                        operator: `NOT ${innerOp.toUpperCase()}`,
                        right,
                        start: left.start,
                        end: right.end
                    };
                }
            }
            else if (val === 'between') {
                left = this.parseBetweenExpression(left, false, nextPrecedence);
            }
            else if (val === 'in') {
                left = this.parseInExpression(left, false);
            }
            else if (val === 'collate') {
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
                // 4. Standard Binary Operators (Now using the merged operator)
                const right = this.parseExpression(nextPrecedence);
                left = {
                    type: 'BinaryExpression',
                    left,
                    operator: operator.toUpperCase(), // Use the merged string
                    right,
                    start: left.start,
                    end: right.end
                };
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
        if (this.peekKeyword('select')) {
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
        this.matchKeyword('and');
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
        const value = token.value;
        const lowerValue = value.toLowerCase();

        // Standardize location for simple tokens
        const start = token.offset;
        const end = token.offset + value.length;

        switch (token.type) {
            case TokenType.Number:
                return { type: 'Literal', value: Number(value), variant: 'number', start, end };

            case TokenType.Variable:
                return { type: 'Variable', name: value, start, end };

            case TokenType.String:
                const content = value.startsWith("'") && value.endsWith("'")
                    ? value.substring(1, value.length - 1)
                    : value;
                return { type: 'Literal', value: content, variant: 'string', start, end };

            case TokenType.TempTable:
                return { type: 'Identifier', name: value, parts: [value], start, end };

            case TokenType.Operator:
                // 1. Support for SELECT * (Wildcard)
                if (value === '*') {
                    return { type: 'Identifier', name: '*', parts: ['*'], start, end };
                }

                /**
                 * FIX: Handle '=' in prefix position.
                 * In T-SQL, '=' is primarily infix, but to prevent the parser from crashing 
                 * during complex expression recovery or assignment-style column parsing,
                 * we return it as a simple identifier node rather than throwing an error.
                 */
                if (value === '=') {
                    return { type: 'Identifier', name: '=', parts: ['='], start, end };
                }

                // 2. Unary operators (-, ~, NOT)
                if (lowerValue === 'not' || value === '-' || value === '~') {
                    // Use specific precedence for unary ops to ensure they bind tighter than binary ops
                    const opPrecedence = lowerValue === 'not' ? Precedence.NOT : Precedence.UNARY;
                    const right = this.parseExpression(opPrecedence);

                    return {
                        type: 'UnaryExpression',
                        operator: value.toUpperCase(),
                        right,
                        start,
                        end: right.end
                    };
                }

                throw new Error(`Unexpected operator in prefix position: ${value}`);

            case TokenType.Identifier:
            case TokenType.Keyword:
                if (lowerValue === 'null') {
                    return { type: 'Literal', value: null, variant: 'null', start, end };
                }
                if (lowerValue === 'case') return this.parseCaseExpression();
                if (lowerValue === 'exists') return this.parseExists(token);

                // FIX: Explicitly handle NOT as a prefix unary operator
                if (lowerValue === 'not') {
                    const right = this.parseExpression(Precedence.NOT);
                    return {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right,
                        start,
                        end: right.end
                    };
                }

                // 1. Use the Multipart Resolver for Names and Functions
                // Backtrack because parseMultipartIdentifier expects to consume the first part
                this.pos--;
                const idNode = this.parseMultipartIdentifier();

                // 2. Handle Function Calls (e.g., COUNT(*), LEFT(name, 1))
                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume(); // (
                    const args: Expression[] = [];

                    if (this.peek()?.value.toLowerCase() === 'select') {
                        const subquery = this.parseSelect() as QueryStatement;
                        const closeParen = this.match(TokenType.CloseParen);
                        args.push({
                            type: 'SubqueryExpression',
                            query: subquery,
                            start: subquery.start,
                            end: closeParen.offset + closeParen.value.length
                        } as any);
                    } else if (this.peek()?.type !== TokenType.CloseParen) {
                        args.push(...this.parseList(() => this.parseExpression(Precedence.LOWEST)));
                    }

                    const closeParen = this.match(TokenType.CloseParen);
                    return {
                        type: 'FunctionCall',
                        name: idNode.name,
                        args,
                        start: idNode.start,
                        end: closeParen.offset + closeParen.value.length
                    };
                }

                return idNode;

            case TokenType.OpenParen:
                if (this.peek()?.value.toLowerCase() === 'select') {
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
                throw new Error(`Unexpected token at line ${token.line}: ${token.value} (${token.type})`);
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
        if (token && token.value.toLowerCase() === value.toLowerCase()) {
            return this.consume();
        }
        throw new Error(`Expected keyword "${value}" but found "${token?.value}" at line ${token?.line}`);
    }

    private peekKeyword(value: string): boolean {
        const token = this.peek();
        return !!token && token.value.toLowerCase() === value.toLowerCase();
    }

    private parseCaseExpression(): Expression {
        // 1. Capture the start offset from the 'CASE' token
        // Since parsePrefix already consumed 'CASE', we get the previous token's offset
        const startToken = this.tokens[this.pos - 1];
        const startOffset = startToken.offset;

        let input: Expression | undefined = undefined;

        // 2. Simple CASE vs. Searched CASE logic
        if (this.peek()?.value.toLowerCase() !== 'when') {
            input = this.parseExpression(Precedence.LOWEST);
        }

        const branches: { when: Expression, then: Expression }[] = [];
        while (this.peek()?.value.toLowerCase() === 'when') {
            this.consume(); // WHEN
            const when = this.parseExpression(Precedence.LOWEST);
            this.matchValue('then');
            const then = this.parseExpression(Precedence.LOWEST);
            branches.push({ when, then });
        }

        let elseBranch: Expression | undefined = undefined;
        if (this.peek()?.value.toLowerCase() === 'else') {
            this.consume(); // ELSE
            elseBranch = this.parseExpression(Precedence.LOWEST);
        }

        // 3. Match 'END' and capture its full range for the end offset
        const endToken = this.matchValue('end');
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

    private parseList(parserFn: () => any) {
        const list = [parserFn()];
        while (this.peek()?.value === ',') {
            this.consume(); // ,
            list.push(parserFn());
        }
        return list;
    }

    private parseIf(): IfNode {
        const startToken = this.matchKeyword('if');
        const condition = this.parseExpression();
        const thenBranch = this.parseStatement();

        let elseBranch: Statement | undefined = undefined;
        let endOffset = thenBranch ? thenBranch.end : condition.end;

        if (this.peekKeyword('else')) {
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
        const startToken = this.matchKeyword('begin');
        const body: Statement[] = [];

        while (this.pos < this.tokens.length && !this.peekKeyword('end')) {
            const stmt = this.parseStatement();
            if (stmt) {
                body.push(stmt);
            } else {
                // Prevent infinite loop if parseStatement returns null on standalone semicolon
                if (this.peek()?.type === TokenType.Semicolon) this.consume();
                else break;
            }
        }

        const endToken = this.matchKeyword('end');
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

            this.matchKeyword('as');
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
            const val = this.peek()?.value.toLowerCase();
            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
                break;
            }
            if (['select', 'insert', 'update', 'delete', 'set', 'declare', 'if', 'begin', 'create', 'with', 'go', 'when', 'then', 'else', 'end'].includes(val!)) {
                break;
            }
            this.pos++;
        }
    }
}