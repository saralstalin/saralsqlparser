import { Lexer, Token, TokenType } from './lexer';


export type Expression =
    | { type: 'BinaryExpression'; left: Expression; operator: string; right: Expression }
    | UnaryExpression
    | { type: 'Literal'; value: string | number | null; variant: 'string' | 'number' | 'null' }
    | { type: 'Identifier'; name: string; tablePrefix?: string }
    | { type: 'Variable'; name: string }
    | { type: 'FunctionCall'; name: string; args: Expression[] }
    | { type: 'CaseExpression'; input?: Expression; branches: { when: Expression, then: Expression }[]; elseBranch?: Expression }
    | { type: 'InExpression'; left: Expression; list?: Expression[]; subquery?: QueryStatement; isNot: boolean }
    | { type: 'BetweenExpression'; left: Expression; start: Expression; end: Expression; isNot: boolean }
    | { type: 'GroupingExpression'; expression: Expression }
    | SubqueryExpression;


export interface JoinNode {
    type: string;
    table: string | Expression;
    on: Expression | null;
    alias?: string;
}


export interface ColumnNode {
    type: 'Column';
    expression: Expression;
    tablePrefix?: string;
    name: string;
    alias?: string;
}

export interface IfNode {
    type: 'IfStatement';
    condition: Expression;
    thenBranch: Statement | Statement[];
    elseBranch?: Statement | Statement[];
}

export interface BlockNode {
    type: 'BlockStatement';
    body: Statement[];
}

export interface UnaryExpression {
    type: 'UnaryExpression';
    operator: string;
    right: Expression;
}

export interface SubqueryExpression {
    type: 'SubqueryExpression';
    query: QueryStatement;
}

// Add this near your other type definitions
export type QueryStatement = SelectNode | SetOperatorNode;

// Update your Statement union to include Insert
export type Statement = QueryStatement | InsertNode | UpdateNode | DeleteNode | DeclareNode | SetNode | CreateNode | IfNode | BlockNode | WithNode | { type: 'PrintStatement', value: Expression };

export interface Program {
    type: 'Program';
    body: Statement[]; // Update this from any[]
}

export interface TableReference {
    table: string | SubqueryExpression; // Can be a string for simple tables or an Expression for subqueries
    alias?: string;
    joins: JoinNode[];
}

export interface SelectNode {
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

export interface InsertNode {
    type: 'InsertStatement';
    table: string;
    columns: string[] | null;
    values: Expression | null;
    selectQuery: SelectNode | SetOperatorNode | null;
}

export interface UpdateNode {
    type: 'UpdateStatement';
    target: string;        // The table or alias being updated
    assignments: { column: string, value: Expression }[];
    from: TableReference | null;
    where: Expression | null;
}

export interface DeleteNode {
    type: 'DeleteStatement';
    target: string;         // The table or alias being deleted from
    from: TableReference | null;
    where: Expression | null;
}

export interface VariableDeclaration {
    name: string;        // e.g., "@BatchID"
    dataType: string;    // e.g., "INT" or "VARCHAR(MAX)"
    initialValue?: Expression; // Optional initial value (e.g., "10" or "@ID + 1")
}

export interface DeclareNode {
    type: 'DeclareStatement';
    variables: VariableDeclaration[];
}

export interface SetNode {
    type: 'SetStatement';
    variable: string; // e.g., "@ID"
    value: Expression;    // e.g., "10" or "@ID + 1"
}

export interface OrderByNode {
    expression: Expression;
    direction: 'ASC' | 'DESC';
}

export interface SetOperatorNode {
    type: 'SetOperator';
    operator: 'UNION' | 'UNION ALL' | 'EXCEPT' | 'INTERSECT';
    left: QueryStatement;  // Changed from Statement
    right: QueryStatement; // Changed from Statement
}

export interface ColumnDefinition {
    name: string;
    dataType: string;
    constraints?: string[]; // e.g., ["PRIMARY KEY", "NOT NULL"]
}

export interface ParameterDefinition {
    name: string;
    dataType: string;
    defaultValue?: string;
    isOutput: boolean;
}

export interface CreateNode {
    type: 'CreateStatement';
    objectType: 'TABLE' | 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TYPE';
    name: string;
    columns?: ColumnDefinition[]; // For Tables
    parameters?: ParameterDefinition[]; // For Procs/Functions
    body?: Statement | Statement[]; // The code inside
    isTableType?: boolean; // For CREATE TYPE ... AS TABLE
}

export interface CTENode {
    name: string;
    columns?: string[];
    query: QueryStatement;
}

export interface WithNode {
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

    private parseSetOperation(left: QueryStatement): SetOperatorNode {
        const operatorToken = this.consume(); // UNION, EXCEPT, INTERSECT
        let type = operatorToken.value.toUpperCase();

        // Handle UNION ALL
        if (type === 'UNION' && this.peek()?.value.toLowerCase() === 'all') {
            this.consume();
            type = 'UNION ALL';
        }

        const right = this.parseSelect();

        const node: SetOperatorNode = {
            type: 'SetOperator',
            operator: type as 'UNION' | 'UNION ALL' | 'EXCEPT' | 'INTERSECT',
            left: left,
            right: right
        };

        // Check for chained operations (e.g., SELECT... UNION SELECT... UNION SELECT...)
        const next = this.peek()?.value.toLowerCase();
        if (next && ['union', 'except', 'intersect'].includes(next)) {
            return this.parseSetOperation(node);
        }

        return node;
    }

    private parseStatement(): Statement | null {
        const token = this.peek();
        if (!token) return null;

        let stmt: Statement | null = null;

        try {
            const val = token.value.toLowerCase();

            switch (val) {
                case 'select':
                    stmt = this.parseSelect();
                    // Handle Set Operators (UNION/EXCEPT/INTERSECT) at the statement level
                    let next = this.peek()?.value.toLowerCase();
                    while (next && ['union', 'except', 'intersect'].includes(next)) {
                        stmt = this.parseSetOperation(stmt as QueryStatement);
                        next = this.peek()?.value.toLowerCase();
                    }
                    break;

                case 'insert':
                    stmt = this.parseInsert();
                    break;

                case 'update':
                    stmt = this.parseUpdate();
                    break;

                case 'delete':
                    stmt = this.parseDelete();
                    break;

                case 'declare':
                    stmt = this.parseDeclare();
                    break;

                case 'set':
                    stmt = this.parseSet();
                    break;

                case 'create':
                    stmt = this.parseCreate();
                    break;

                case 'if':
                    stmt = this.parseIf();
                    break;

                case 'begin':
                    stmt = this.parseBlock();
                    break;

                case 'with':
                    stmt = this.parseWith();
                    break;

                case 'print':
                    this.consume(); // PRINT
                    const message = this.parseExpression();
                    stmt = { type: 'PrintStatement', value: message } as any;
                    break;

                case 'go':
                    this.consume(); // Batch separator
                    return null;

                // FIX: Explicitly handle internal expression keywords that appear at statement start
                case 'when':
                case 'then':
                case 'else':
                case 'end':
                    throw new Error(`Unexpected token: ${token.value}. This keyword must be part of an expression.`);

                default:
                    // Skip standalone semicolons
                    if (token.type === TokenType.Semicolon) {
                        this.consume();
                        return null;
                    }
                    throw new Error(`Unexpected token: ${token.value}`);
            }
        } catch (e) {
            console.error(e);

            // recovery: move cursor to next valid statement boundary (SELECT, INSERT, etc.)
            this.resync();

            // Return a dummy ErrorStatement to keep the AST body length > 0
            return {
                type: 'ErrorStatement',
                message: e instanceof Error ? e.message : String(e)
            } as any;
        }

        // Standard semicolon consumption after a successful statement
        if (this.peek()?.type === TokenType.Semicolon) {
            this.consume();
        }

        return stmt;
    }



    private parseSelect(): SelectNode {
        this.consume(); // SELECT

        // 1. Handle DISTINCT / ALL
        let distinct = false;
        if (this.peek()?.value.toLowerCase() === 'distinct') {
            this.consume();
            distinct = true;
        } else if (this.peek()?.value.toLowerCase() === 'all') {
            this.consume();
        }

        // 2. Handle TOP
        let top: string | null = null;
        if (this.peek()?.value.toLowerCase() === 'top') {
            this.consume();
            // Handle parentheses if present: TOP (10)
            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            top = this.consume().value;

            if (hasParens) this.match(TokenType.CloseParen);

            // Handle PERCENT if present
            if (this.peek()?.value.toLowerCase() === 'percent') {
                top += ' PERCENT';
                this.consume();
            }
        }

        // 3. Handle Column List
        const columns = this.parseList(() => this.parseColumn());

        // 4. Handle FROM (using our new centralized parseFrom)
        let from: TableReference | null = null;
        if (this.peek()?.value.toLowerCase() === 'from') {
            from = this.parseFrom();
        }

        // 5. Handle WHERE
        let where: Expression | null = null;
        if (this.peek()?.value.toLowerCase() === 'where') {
            this.consume();
            where = this.parseExpression();
        }

        // 6. Handle GROUP BY
        let groupBy: Expression[] | null = null;
        if (this.peek()?.value.toLowerCase() === 'group') {
            this.consume();
            this.matchValue('by');
            groupBy = this.parseList(() => this.parseExpression()); // Return Expression objects directly
        }

        // 7. Handle HAVING
        let having: Expression | null = null;
        if (this.peek()?.value.toLowerCase() === 'having') {
            this.consume();
            having = this.parseExpression();
        }

        // 8. Handle ORDER BY
        let orderBy: OrderByNode[] | null = null;
        if (this.peek()?.value.toLowerCase() === 'order') {
            this.consume(); // order
            this.matchValue('by');
            orderBy = this.parseList(() => {
                const column = this.consume().value;
                let direction: 'ASC' | 'DESC' = 'ASC';
                if (this.peek()?.value.toLowerCase() === 'desc') {
                    this.consume();
                    direction = 'DESC';
                } else if (this.peek()?.value.toLowerCase() === 'asc') {
                    this.consume();
                }
                return { column, direction };
            });
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
            orderBy
        };
    }



    private parseInsert(): InsertNode {
        this.consume(); // INSERT
        if (this.peek()?.value.toLowerCase() === 'into') this.consume();

        const table = this.consume().value;
        let columns: string[] | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            this.consume();
            columns = this.parseList(() => this.consume().value);
            this.match(TokenType.CloseParen);
        }

        let values: Expression | null = null;
        let selectQuery: SelectNode | SetOperatorNode | null = null;

        const next = this.peek()?.value.toLowerCase();
        if (next === 'values') {
            this.consume();
            this.match(TokenType.OpenParen);
            // This is simplified; technically VALUES can have multiple rows
            // For now, we capture the expression list as a single "Expression" node 
            // Or we could update the interface to Expression[]
            values = this.parseExpression();
            this.match(TokenType.CloseParen);
        } else if (next === 'select') {
            selectQuery = this.parseSelect() as QueryStatement;
        }

        return { type: 'InsertStatement', table, columns, values, selectQuery };
    }

    private parseUpdate(): UpdateNode {
        this.consume(); // UPDATE
        const target = this.consume().value;
        this.matchValue('set');

        const assignments = this.parseList(() => {
            const column = this.consume().value;
            this.matchValue('=');
            const value = this.parseExpression();
            return { column, value };
        });

        let from: TableReference | null = null;
        // Check for FROM clause
        if (this.peek()?.value.toLowerCase() === 'from') {
            from = this.parseFrom();
        }

        let where: Expression | null = null;
        if (this.peek()?.value.toLowerCase() === 'where') {
            this.consume(); // WHERE
            where = this.parseExpression();
        }

        return { type: 'UpdateStatement', target, assignments, from, where };
    }

    private parseFrom(): TableReference {
        this.consume(); // FROM

        let source: Expression;
        let alias: string | undefined = undefined;

        // 1. Handle Subquery vs Table Reference
        // We check for '(' followed by 'SELECT' to identify a derived table
        const next = this.peek();
        const nextNext = this.peek(1);

        if (next?.type === TokenType.OpenParen && nextNext?.value.toLowerCase() === 'select') {
            this.consume(); // (
            const subquery = this.parseSelect() as QueryStatement;
            this.match(TokenType.CloseParen);

            // Structured Object: Essential for Column Lineage/Scope Analysis
            source = {
                type: 'SubqueryExpression',
                query: subquery
            };
        } else {
            // Use Pratt Parser (Precedence.CALL) to handle multipart names [dbo].[Table]
            // or Table-Valued Functions naturally.
            source = this.parseExpression(Precedence.CALL);
        }

        // 2. Capture Alias logic
        // We avoid swallowing T-SQL keywords that signal the start of a new clause
        const stopKeywords = [
            'inner', 'left', 'right', 'full', 'cross', 'join',
            'where', 'group', 'order', 'union', 'all', 'on',
            'apply', 'outer', 'except', 'intersect'
        ];

        const aliasToken = this.peek();
        if (aliasToken?.value.toLowerCase() === 'as') {
            this.consume(); // AS
            alias = this.consume().value;
        } else if (
            aliasToken &&
            aliasToken.type === TokenType.Identifier &&
            !stopKeywords.includes(aliasToken.value.toLowerCase())
        ) {
            alias = this.consume().value;
        }

        // 3. Parse Join Sequence
        const joins: JoinNode[] = [];
        while (this.isJoinToken(this.peek())) {
            joins.push(this.parseJoin());
        }

        /**
         * Architectural Bridge:
         * We determine if 'table' should be the raw string name or the Subquery Object.
         * If your TableReference interface still requires a string for 'table', 
         * we use 'derived_table' as the bridge for your tests.
         */
        let tableValue: string | SubqueryExpression;

        if (source.type === 'SubqueryExpression') {
            // If your interface is: table: string | SubqueryExpression
            tableValue = source;

            // Note: If your interface is still strictly: table: string
            // Use: tableValue = 'derived_table';
        } else {
            tableValue = this.stringifyExpression(source);
        }

        return {
            table: tableValue as any, // Cast only if transitioning interfaces
            alias,
            joins
        };
    }

    private parseJoin(): JoinNode {
        let type = '';

        // 1. Determine Join Type (Handle complex prefixes: LEFT OUTER, CROSS APPLY, etc.)
        const first = this.consume().value.toUpperCase();

        if (['LEFT', 'RIGHT', 'FULL'].includes(first)) {
            // Optional 'OUTER' keyword
            if (this.peek()?.value.toLowerCase() === 'outer') {
                this.consume();
                type = `${first} OUTER JOIN`;
            } else {
                type = `${first} JOIN`;
            }
            this.matchValue('join');
        } else if (first === 'INNER') {
            this.matchValue('join');
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
            // Handle T-SQL OUTER APPLY
            const next = this.consume().value.toUpperCase();
            if (next === 'APPLY') {
                type = 'OUTER APPLY';
            } else {
                type = `OUTER ${next}`;
            }
        } else if (first === 'JOIN') {
            type = 'INNER JOIN'; // Bare JOIN defaults to INNER
        } else {
            // Fallback for unexpected join starts
            type = `${first} JOIN`;
        }

        // 2. Parse the Join Target (Table, Function, or Subquery)
        let tableTarget: Expression;
        if (this.peek()?.type === TokenType.OpenParen && this.peek(1)?.value.toLowerCase() === 'select') {
            this.consume(); // (
            const subquery = this.parseSelect() as QueryStatement;
            this.match(TokenType.CloseParen);
            tableTarget = { type: 'SubqueryExpression', query: subquery } as any;
        } else {
            // Use parseExpression with CALL precedence to capture multipart names 
            // and function calls, but stop before an 'ON' or alias
            tableTarget = this.parseExpression(Precedence.CALL);
        }

        // 3. Parse Alias
        let alias: string | undefined = undefined;
        const stopKeywords = ['on', 'where', 'inner', 'left', 'right', 'full', 'cross', 'join', 'outer', 'union', 'except', 'intersect'];
        const nextToken = this.peek();

        if (nextToken?.value.toLowerCase() === 'as') {
            this.consume(); // as
            alias = this.consume().value;
        } else if (
            nextToken &&
            nextToken.type === TokenType.Identifier &&
            !stopKeywords.includes(nextToken.value.toLowerCase())
        ) {
            alias = this.consume().value;
        }

        // 4. Parse ON condition (Required for JOINs, ignored for APPLY)
        let on: Expression | null = null;
        if (this.peek()?.value.toLowerCase() === 'on') {
            this.consume(); // on
            on = this.parseExpression();
        }

        return {
            type: type.trim(),
            // We use stringifyExpression here ONLY if your JoinNode.table interface is still a string.
            // If you updated the interface to 'table: string | Expression', pass tableTarget directly.
            table: this.stringifyExpression(tableTarget),
            alias,
            on
        };
    }

    private parseDelete(): DeleteNode {
        this.consume(); // DELETE

        let target = "";

        // T-SQL often allows 'DELETE FROM' or just 'DELETE'
        if (this.peek()?.value.toLowerCase() === 'from') {
            this.consume(); // Consume FROM
            target = this.consume().value;
            // Handle multipart target like dbo.Users
            while (this.peek()?.value === '.') {
                this.consume();
                target += '.' + this.consume().value;
            }
        } else {
            // Handle 'DELETE u FROM Users u' style
            target = this.consume().value;
            while (this.peek()?.value === '.') {
                this.consume();
                target += '.' + this.consume().value;
            }

            if (this.peek()?.value.toLowerCase() === 'from') {
                this.consume(); // Consume the second FROM in the T-SQL join syntax
            } else {
                // If there's no FROM after the target, it was a standard 'DELETE Users'
                // and we've already captured the target.
            }
        }

        // Now, if we are in a Join-style Delete, the next part is a TableReference
        let from: TableReference | null = null;
        // We check if the next token is an identifier and NOT 'WHERE' or ';'
        const nextVal = this.peek()?.value.toLowerCase();
        if (nextVal && nextVal !== 'where' && nextVal !== ';' && nextVal !== 'go') {
            from = this.parseFrom();
        }

        // Optional WHERE clause
        let where: Expression | null = null;
        if (this.peek()?.value.toLowerCase() === 'where') {
            this.consume();
            where = this.parseExpression();
        }

        return {
            type: 'DeleteStatement',
            target,
            from,
            where
        };
    }

    private parseDeclare(): DeclareNode {
        this.consume(); // DECLARE

        const variables = this.parseList(() => {
            const name = this.consume().value;
            let dataType = this.consume().value;

            // Handle (MAX) or (50, 2)
            if (this.peek()?.type === TokenType.OpenParen) {
                dataType += this.consume().value; // (
                dataType += this.consume().value; // size
                if (this.peek()?.value === ',') {
                    dataType += this.consume().value; // ,
                    dataType += this.consume().value; // scale
                }
                dataType += this.consume().value; // )
            }

            let initialValue: Expression | undefined = undefined;
            if (this.peek()?.value === '=') {
                this.consume(); // =
                initialValue = this.parseExpression();
            }

            return { name, dataType, initialValue };
        });

        return { type: 'DeclareStatement', variables };
    }

    private parseSet(): SetNode {
        this.consume(); // SET
        const variable = this.consume().value;

        // If it doesn't start with @, it's a session option (e.g., SET NOCOUNT ON)
        if (!variable.startsWith('@')) {
            const optionValue = this.consume().value; // ON, OFF, etc.
            return {
                type: 'SetStatement',
                variable,
                value: {
                    type: 'Literal',
                    value: optionValue,
                    variant: 'string'
                } // Wrapped as an Expression object
            };
        }

        this.matchValue('=');
        const value = this.parseExpression(); // This already returns an Expression object

        return {
            type: 'SetStatement',
            variable,
            value
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
        this.consume(); // CREATE
        let rawType = this.consume().value.toUpperCase();

        // Standardize types for the AST and Tests
        let objectType: CreateNode['objectType'] = rawType as any;
        if (rawType === 'PROC') objectType = 'PROCEDURE';

        /**
         * FIX: Strategic Name Parsing
         * For TABLE and TYPE, we parse the name manually to prevent the Pratt Parser 
         * from seeing 'TableName (ID INT...)' as a 'FunctionCall(ID INT...)'.
         */
        let name: string;
        if (objectType === 'TABLE' || objectType === 'TYPE') {
            name = this.consume().value;
            while (this.peek()?.value === '.') {
                this.consume(); // .
                name += '.' + this.consume().value;
            }
        } else {
            // For Views and Procedures, it's safe to use the expression parser
            const nameNode = this.parseExpression(Precedence.CALL);
            name = this.stringifyExpression(nameNode);
        }

        // 1. Handle CREATE TYPE ... AS TABLE
        if (objectType === 'TYPE') {
            if (this.peek()?.value.toUpperCase() === 'AS') {
                this.consume(); // AS
                if (this.peek()?.value.toUpperCase() === 'TABLE') {
                    this.consume(); // TABLE
                    const columns = this.parseTableColumns();
                    return {
                        type: 'CreateStatement',
                        objectType: 'TYPE',
                        name,
                        columns,
                        isTableType: true
                    };
                }
            }
            return { type: 'CreateStatement', objectType: 'TYPE', name };
        }

        // 2. Handle CREATE TABLE
        if (objectType === 'TABLE') {
            const columns = this.parseTableColumns();
            return { type: 'CreateStatement', objectType: 'TABLE', name, columns };
        }

        // 3. Handle Parameters for Procedures/Functions
        let parameters: ParameterDefinition[] = [];
        const isProcOrFunc = ['PROCEDURE', 'FUNCTION'].includes(objectType);

        if (isProcOrFunc) {
            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            // Check for variable start (@)
            if (this.peek()?.type === TokenType.Variable) {
                parameters = this.parseList(() => {
                    const pName = this.consume().value; // @ID

                    // Get data type (e.g., VARCHAR(MAX))
                    let pType = this.consume().value;
                    if (this.peek()?.type === TokenType.OpenParen) {
                        pType += this.consume().value; // (
                        pType += this.consume().value; // size/max
                        if (this.peek()?.value === ',') {
                            pType += this.consume().value; // ,
                            pType += this.consume().value; // scale
                        }
                        pType += this.consume().value; // )
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

        // 4. Consume the 'AS' keyword before the body
        if (this.peek()?.value.toUpperCase() === 'AS') {
            this.consume();
        }

        // 5. Handle the Body
        let body: Statement | Statement[] | undefined;
        if (objectType === 'VIEW') {
            body = this.parseSelect() as QueryStatement;
        } else {
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

        return {
            type: 'CreateStatement',
            objectType,
            name,
            parameters,
            body
        };
    }

    private parseColumn(): ColumnNode {
        let alias: string | undefined = undefined;
        let expression: Expression;
        let tablePrefix: string | undefined = undefined;
        let name: string = '';

        const STOP_KEYWORDS = ['from', 'where', 'group', 'order', 'having', 'union', 'all', 'except', 'intersect', 'join', 'on', 'apply', 'into', 'outer', 'values'];

        // 1. Handle T-SQL Assignment Style (Alias = Expression)
        if (this.peek()?.type === TokenType.Identifier && this.peek(1)?.value === '=') {
            alias = this.consume().value;
            this.consume(); // =
            expression = this.parseExpression();
        } else {
            // 2. Handle Standard Style (Expression [AS] Alias)
            expression = this.parseExpression();

            const nextToken = this.peek();
            const nextVal = nextToken?.value.toLowerCase();

            if (nextVal === 'as') {
                this.consume();
                alias = this.consume().value;
            } else if (
                nextToken &&
                nextToken.type !== TokenType.Semicolon &&
                nextToken.type !== TokenType.Comma &&
                nextToken.type === TokenType.Identifier &&
                !STOP_KEYWORDS.includes(nextVal!)
            ) {
                alias = this.consume().value;
            }
        }

        // 3. Gold Standard Extraction: Extract name and prefix from the AST nodes
        if (expression.type === 'Identifier') {
            name = expression.name;
            tablePrefix = expression.tablePrefix;
        } else if (expression.type === 'FunctionCall') {
            name = expression.name; // e.g. "SUM" or "dbo.fn_GetDate"
        } else if (expression.type === 'Literal') {
            name = String(expression.value);
        } else {
            // For complex math or CASE, we don't have a simple "name"
            name = 'expression';
        }

        return {
            type: 'Column',
            expression,
            name,
            tablePrefix,
            alias
        };
    }

    private isJoinToken(token: Token | undefined): boolean {
        if (!token) return false;
        const val = token.value.toLowerCase();
        return ['join', 'inner', 'left', 'right', 'cross', 'full'].includes(val);
    }

    private parseExpression(precedence: Precedence = Precedence.LOWEST): Expression {
        // 1. Prefix Parse: Handles Literals, Unary operators, Parens, CASE, EXISTS, etc.
        let left = this.parsePrefix();

        // 2. The Infix Loop: Handles Binary operators, IN, BETWEEN, IS NULL, COLLATE, etc.
        while (this.pos < this.tokens.length) {
            const nextToken = this.peek();
            if (!nextToken || nextToken.type === TokenType.Semicolon) break;

            const val = nextToken.value.toLowerCase();

            /**
             * BOUNDARY PROTECTION:
             * We stop parsing the expression if we hit a major T-SQL clause boundary.
             * We only do this if precedence is LOWEST (meaning we are at the top level
             * and the current expression is complete) and the token is a Keyword.
             */
            const structuralStops = [
                'from', 'where', 'group', 'order', 'having',
                'union', 'except', 'intersect', 'on', 'join'
            ];

            if (precedence === Precedence.LOWEST && structuralStops.includes(val)) {
                if (nextToken.type === TokenType.Keyword) {
                    break;
                }
            }

            const nextPrecedence = PRECEDENCE_MAP[val] ?? Precedence.LOWEST;

            // Pratt Precedence Rule: If the next operator binds weaker or equal, 
            // this sub-tree is complete.
            if (nextPrecedence <= precedence) break;

            this.consume(); // Valid infix operator found

            // 3. Specialized T-SQL Infix Handlers

            // Handle "IS NULL" / "IS NOT NULL"
            if (val === 'is') {
                let isNot = false;
                let peekVal = this.peek()?.value.toUpperCase();

                if (peekVal === 'NOT') {
                    this.consume();
                    isNot = true;
                    peekVal = this.peek()?.value.toUpperCase();
                }

                if (peekVal === 'NULL') {
                    this.consume();
                    left = {
                        type: 'UnaryExpression',
                        operator: isNot ? 'IS NOT NULL' : 'IS NULL',
                        right: left // Postfix: the subject is stored on the 'right' property
                    };
                } else {
                    throw new Error(`Expected NULL after IS, found ${peekVal}`);
                }
            }

            // Handle "NOT IN" / "NOT LIKE" / "NOT BETWEEN"
            else if (val === 'not') {
                const innerOpToken = this.consume();
                const innerOp = innerOpToken.value.toLowerCase();

                if (innerOp === 'in') {
                    left = this.parseInExpression(left, true);
                } else if (innerOp === 'between') {
                    left = this.parseBetweenExpression(left, true, nextPrecedence);
                } else if (innerOp === 'like') {
                    const right = this.parseExpression(nextPrecedence);
                    left = { type: 'BinaryExpression', left, operator: 'NOT LIKE', right };
                } else {
                    // Handle cases like NOT = (valid in some SQL dialects) or fallback
                    const right = this.parseExpression(nextPrecedence);
                    left = { type: 'BinaryExpression', left, operator: `NOT ${innerOp.toUpperCase()}`, right };
                }
            }

            // Handle "BETWEEN"
            else if (val === 'between') {
                left = this.parseBetweenExpression(left, false, nextPrecedence);
            }

            // Handle "IN"
            else if (val === 'in') {
                left = this.parseInExpression(left, false);
            }

            // Handle "COLLATE" (treated as binary operator with high precedence)
            else if (val === 'collate') {
                const collation = this.consume().value;
                left = {
                    type: 'BinaryExpression',
                    left,
                    operator: 'COLLATE',
                    right: { type: 'Literal', value: collation, variant: 'string' }
                } as any;
            }

            // 4. Standard Binary Operators (+, -, *, /, AND, OR, =, <>, &, |, ^, %)
            else {
                const right = this.parseExpression(nextPrecedence);
                left = {
                    type: 'BinaryExpression',
                    left,
                    operator: val.toUpperCase(),
                    right
                };
            }
        }

        return left;
    }

    /**
     * Helper to handle the common logic for IN and NOT IN
     */
    private parseInExpression(left: Expression, isNot: boolean): Expression {
        this.match(TokenType.OpenParen);

        let subquery: QueryStatement | undefined;
        let list: Expression[] | undefined;

        if (this.peek()?.value.toLowerCase() === 'select') {
            subquery = this.parseSelect() as QueryStatement;
        } else {
            list = [];
            while (this.peek()?.type !== TokenType.CloseParen) {
                list.push(this.parseExpression(Precedence.LOWEST));
                if (this.peek()?.value === ',') this.consume();
                else break;
            }
        }

        this.match(TokenType.CloseParen);
        return { type: 'InExpression', left, list, subquery, isNot };
    }

    /**
     * Helper to handle the common logic for BETWEEN and NOT BETWEEN
     */
    private parseBetweenExpression(left: Expression, isNot: boolean, precedence: number): Expression {
        const start = this.parseExpression(precedence);
        this.matchValue('and');
        const end = this.parseExpression(precedence);
        return { type: 'BetweenExpression', left, start, end, isNot };
    }

    private parsePrefix(): Expression {
        const token = this.consume();
        const value = token.value;
        const lowerValue = value.toLowerCase();

        switch (token.type) {
            case TokenType.Number:
                return { type: 'Literal', value: Number(value), variant: 'number' };

            case TokenType.Variable:
                return { type: 'Variable', name: value };

            case TokenType.String:
                // Strip the single quotes for the AST value
                const content = value.startsWith("'") && value.endsWith("'")
                    ? value.substring(1, value.length - 1)
                    : value;
                return { type: 'Literal', value: content, variant: 'string' };

            case TokenType.TempTable:
                return { type: 'Identifier', name: value };

            case TokenType.Operator:
                // 1. Support for SELECT * (Wildcard)
                if (value === '*') {
                    return { type: 'Identifier', name: '*' };
                }

                // 2. Unary operators (-, ~, NOT)
                // Use Precedence.UNARY/NOT to ensure correct binding
                if (lowerValue === 'not') {
                    return {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right: this.parseExpression(Precedence.NOT)
                    };
                }
                if (value === '-' || value === '~') {
                    return {
                        type: 'UnaryExpression',
                        operator: value,
                        right: this.parseExpression(Precedence.UNARY)
                    };
                }
                throw new Error(`Unexpected operator in prefix position: ${value}`);

            case TokenType.Identifier:
                // Handle keywords that might be lexed as Identifiers
                if (lowerValue === 'case') return this.parseCaseExpression();
                if (lowerValue === 'exists') return this.parseExists();
                if (lowerValue === 'null') return { type: 'Literal', value: null, variant: 'null' };
                if (lowerValue === 'not') {
                    return {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right: this.parseExpression(Precedence.NOT)
                    };
                }

                let name = value;
                let tablePrefix: string | undefined = undefined;

                // 3. Handle Multipart Identifiers (e.g., dbo.Users, u.Name)
                if (this.peek()?.value === '.') {
                    this.consume(); // .
                    tablePrefix = name;
                    name = this.consume().value;
                }

                // 4. Handle Function Calls (e.g., SUM(Sales), GETDATE())
                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume(); // (
                    const args: Expression[] = [];

                    if (this.peek()?.value.toLowerCase() === 'select') {
                        const subquery = this.parseSelect() as QueryStatement;
                        args.push({ type: 'SubqueryExpression', query: subquery } as any);
                    } else {
                        // Standard argument list
                        if (this.peek()?.type !== TokenType.CloseParen) {
                            args.push(...this.parseList(() => this.parseExpression(Precedence.LOWEST)));
                        }
                    }
                    this.match(TokenType.CloseParen);
                    return { type: 'FunctionCall', name: tablePrefix ? `${tablePrefix}.${name}` : name, args };
                }
                return { type: 'Identifier', name, tablePrefix };

            case TokenType.OpenParen:
                // 5. Handle Subqueries vs Grouping (1 + 2)
                if (this.peek()?.value.toLowerCase() === 'select') {
                    const query = this.parseSelect() as QueryStatement;
                    this.match(TokenType.CloseParen);
                    return { type: 'SubqueryExpression', query } as any;
                } else {
                    const inner = this.parseExpression(Precedence.LOWEST);
                    this.match(TokenType.CloseParen);
                    return { type: 'GroupingExpression', expression: inner } as any;
                }

            case TokenType.Keyword:
                // Standardizing keyword-based prefix expressions
                if (lowerValue === 'null') return { type: 'Literal', value: null, variant: 'null' };
                if (lowerValue === 'case') return this.parseCaseExpression();
                if (lowerValue === 'exists') return this.parseExists();
                if (lowerValue === 'not') {
                    return {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right: this.parseExpression(Precedence.NOT)
                    };
                }
                throw new Error(`Unexpected keyword in expression: ${value}`);

            default:
                throw new Error(`Unexpected token at line ${token.line}: ${token.value} (${token.type})`);
        }
    }

    /**
     * Helper to keep parsePrefix clean
     */
    private parseExists(): UnaryExpression {
        this.match(TokenType.OpenParen);
        const query = this.parseSelect() as QueryStatement;
        this.match(TokenType.CloseParen);
        return {
            type: 'UnaryExpression',
            operator: 'EXISTS',
            right: { type: 'SubqueryExpression', query } as any
        } as any;
    }

    private parseCaseExpression(): Expression {
        let input: Expression | undefined = undefined;

        // If not followed by WHEN, it's a simple CASE (e.g., CASE @Var WHEN...)
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

        this.matchValue('end');
        return { type: 'CaseExpression', input, branches, elseBranch };
    }

    private parseGroupBy(): string[] {
        return this.parseList(() => {
            let identifier = this.consume().value;
            // Support multipart in GROUP BY (e.g., u.Category)
            while (this.peek()?.value === '.') {
                this.consume(); // .
                identifier += '.' + this.consume().value;
            }
            return identifier;
        });
    }

    private parseOrderBy(): OrderByNode[] {
        return this.parseList(() => {
            const columnToken = this.consume();
            let column = columnToken.value;

            // Handle multipart identifiers in ORDER BY (e.g., u.Name)
            while (this.peek()?.value === '.') {
                this.consume(); // .
                column += '.' + this.consume().value;
            }

            let direction: 'ASC' | 'DESC' = 'ASC';
            const next = this.peek()?.value.toLowerCase();

            if (next === 'asc') {
                this.consume();
            } else if (next === 'desc') {
                this.consume();
                direction = 'DESC';
            }

            return { column, direction };
        });
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
        this.consume(); // IF
        // Now returns the root of the expression tree
        const condition = this.parseExpression();

        const thenBranch = this.parseStatement();

        let elseBranch: Statement | Statement[] | undefined = undefined;
        if (this.peek()?.value.toLowerCase() === 'else') {
            this.consume(); // ELSE
            const stmt = this.parseStatement();
            if (stmt) elseBranch = stmt;
        }

        return {
            type: 'IfStatement',
            condition,
            thenBranch: thenBranch!,
            elseBranch
        };
    }

    private parseBlock(): BlockNode {
        this.consume(); // BEGIN
        const body: Statement[] = [];

        while (this.pos < this.tokens.length && this.peek()?.value.toLowerCase() !== 'end') {
            const stmt = this.parseStatement();
            if (stmt) body.push(stmt);

            // Consume optional semicolon after statements in a block
            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
            }
        }

        this.matchValue('end');
        return { type: 'BlockStatement', body };
    }

    private parseWith(): WithNode {
        this.consume(); // WITH

        const ctes: CTENode[] = [];

        // 1. Parse one or more CTE definitions
        while (true) {
            const name = this.consume().value;
            let columns: string[] | undefined = undefined;

            // Optional column list: WITH MyCTE (Col1, Col2)
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume();
                columns = this.parseList(() => this.consume().value);
                this.match(TokenType.CloseParen);
            }

            this.matchValue('as');
            this.match(TokenType.OpenParen);

            // CTEs are queries (SELECT or UNION of SELECTs)
            const query = this.parseSelect() as QueryStatement;

            this.match(TokenType.CloseParen);

            ctes.push({ name, columns, query });

            // Check for multiple CTEs: WITH CTE1 AS (...), CTE2 AS (...)
            if (this.peek()?.value === ',') {
                this.consume(); // Consume comma and continue loop
            } else {
                break;
            }
        }

        // 2. Fixed Body Logic (Claude Issue #3)
        // T-SQL allows WITH to precede SELECT, INSERT, UPDATE, or DELETE.
        // parseStatement handles all of these and correctly returns the specific Node.
        const body = this.parseStatement();

        if (!body) {
            throw new Error("A Common Table Expression (CTE) must be followed by a query or DML statement.");
        }

        return {
            type: 'WithStatement',
            ctes,
            body
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
                return `${this.stringifyExpression(expr.left)} ${expr.isNot ? 'NOT ' : ''}BETWEEN ${this.stringifyExpression(expr.start)} AND ${this.stringifyExpression(expr.end)}`;
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