import { Lexer, Token, TokenType } from './lexer';


export interface JoinNode {
    type: string;
    table: string;
    on: string | null;
    alias?: string;
}


export interface ColumnNode {
    type: 'Column';
    expression: string; // Add this
    tablePrefix?: string;
    name: string;
    alias?: string;
}

export interface IfNode {
    type: 'IfStatement';
    condition: string;
    thenBranch: Statement | Statement[];
    elseBranch?: Statement | Statement[];
}

export interface BlockNode {
    type: 'BlockStatement';
    body: Statement[];
}

// Add this near your other type definitions
export type QueryStatement = SelectNode | SetOperatorNode;

// Update your Statement union to include Insert
export type Statement = QueryStatement | InsertNode | UpdateNode | DeleteNode | DeclareNode | SetNode | CreateNode | IfNode | BlockNode | WithNode | { type: 'PrintStatement', value: string };

export interface Program {
    type: 'Program';
    body: Statement[]; // Update this from any[]
}

export interface TableReference {
    table: string;
    alias?: string;
    joins: JoinNode[];
}

export interface SelectNode {
    type: 'SelectStatement';
    distinct: boolean;
    top: string | null;
    columns: any[];
    from: TableReference | null;
    where: string | null;
    groupBy: string[] | null;
    having: string | null;
    orderBy: OrderByNode[] | null;
}

export interface InsertNode {
    type: 'InsertStatement';
    table: string;
    columns: string[] | null;
    values: string[][] | null;
    selectQuery: SelectNode | SetOperatorNode | null;
}

export interface UpdateNode {
    type: 'UpdateStatement';
    target: string;        // The table or alias being updated
    assignments: { column: string, value: string }[];
    from: TableReference | null;
    where: string | null;
}

export interface DeleteNode {
    type: 'DeleteStatement';
    target: string;         // The table or alias being deleted from
    from: TableReference | null;
    where: string | null;
}

export interface VariableDeclaration {
    name: string;        // e.g., "@BatchID"
    dataType: string;    // e.g., "INT" or "VARCHAR(MAX)"
    initialValue?: string;
}

export interface DeclareNode {
    type: 'DeclareStatement';
    variables: VariableDeclaration[];
}

export interface SetNode {
    type: 'SetStatement';
    variable: string; // e.g., "@ID"
    value: string;    // e.g., "10" or "@ID + 1"
}

export interface OrderByNode {
    column: string;
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
    COMPARE, // =, <>, <, >, <=, >=
    SUM,     // +, -
    PRODUCT, // *, /, %
    PREFIX,  // -X, NOT X
    CALL     // Function calls
}

// Precedence mapping for operators
const PRECEDENCE_MAP: Record<string, Precedence> = {
    'or': Precedence.OR,
    'and': Precedence.AND,
    'not': Precedence.AND,     // Infix NOT (NOT IN, NOT LIKE)
    'is': Precedence.COMPARE,  // IS NULL
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
    '+': Precedence.SUM,
    '-': Precedence.SUM,
    '*': Precedence.PRODUCT,
    '/': Precedence.PRODUCT,
    '(': Precedence.CALL
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
            try {
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

            } catch (e) {
                console.error(e);
                this.resync();
            }
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
            switch (token.value.toLowerCase()) {
                case 'select':
                    // Parse the initial SELECT
                    stmt = this.parseSelect();

                    // After a SELECT, check if it's followed by a SET operator
                    // This allows combining SELECTs via UNION, EXCEPT, INTERSECT
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
                // Add 'with' to your switch case:
                case 'with':
                    stmt = this.parseWith();
                    break;
                case 'print':
                    this.consume(); // consume 'PRINT'
                    const message = this.parseExpression();
                    return { type: 'PrintStatement', value: message } as any;

                default:
                    // Handle batch separators or unknown tokens
                    if (token.value.toLowerCase() === 'go') {
                        this.consume();
                        return null;
                    }
                    throw new Error(`Unexpected token: ${token.value}`);
            }
        } catch (e) {
            console.error(e);
            this.resync();
            return null;
        }

        // Consume optional semicolon
        if (this.peek()?.type === TokenType.Semicolon) {
            this.consume();
        }

        return stmt;
    }


    // Inside parser.ts
    private parseSelect(): SelectNode {
        this.consume(); // Consume 'SELECT'

        let top = null;
        let distinct = false;

        // 1. Handle DISTINCT or ALL keywords
        const nextVal = this.peek()?.value.toLowerCase();
        if (nextVal === 'distinct') {
            this.consume();
            distinct = true;
        } else if (nextVal === 'all') {
            this.consume(); // Consume 'ALL', distinct remains false (default)
        }

        // 2. Handle TOP clause
        if (this.peek()?.value.toLowerCase() === 'top') {
            this.consume();
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume(); // (
                top = this.consume().value;
                this.match(TokenType.CloseParen);
            } else {
                // Support 'TOP 10' without parentheses
                top = this.peek()?.type === TokenType.Number ? this.consume().value : null;
            }
        }

        // 3. Parse Column List
        const columns = this.parseList(() => this.parseColumn());

        // 4. Parse FROM Clause
        let from: TableReference | null = null;
        if (this.peek()?.value.toLowerCase() === 'from') {
            this.consume();
            from = this.parseTableReference();
        }

        // 5. Parse WHERE Clause
        let where = null;
        if (this.peek()?.value.toLowerCase() === 'where') {
            this.consume();
            // Pratt parser naturally stops at GROUP, ORDER, etc.
            where = this.parseExpression();
        }

        // 6. Parse GROUP BY Clause
        let groupBy: string[] | null = null;
        if (this.peek()?.value.toLowerCase() === 'group') {
            this.consume();
            this.matchValue('by');
            groupBy = this.parseGroupBy();
        }

        // 7. Parse HAVING Clause
        let having: string | null = null;
        if (this.peek()?.value.toLowerCase() === 'having') {
            this.consume();
            having = this.parseExpression();
        }

        // 8. Parse ORDER BY Clause
        let orderBy: OrderByNode[] | null = null;
        if (this.peek()?.value.toLowerCase() === 'order') {
            this.consume();
            this.matchValue('by');
            orderBy = this.parseOrderBy();
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
        if (this.peek()?.value.toLowerCase() === 'into') {
            this.consume(); // optional INTO
        }

        // 1. Target Table (Handling multipart dbo.Table)
        let table = this.consume().value;
        while (this.peek()?.value === '.') {
            this.consume();
            table += '.' + this.consume().value;
        }

        // 2. Optional Column List (e.g., INSERT INTO Table (Col1, Col2))
        let columns: string[] | null = null;
        if (this.peek()?.type === TokenType.OpenParen) {
            this.consume(); // (
            columns = this.parseList(() => this.consume().value);
            this.consume(); // )
        }

        let values: string[][] | null = null;
        let selectQuery: SelectNode | SetOperatorNode | null = null;

        const nextToken = this.peek()?.value.toLowerCase();

        // 3. Branch: VALUES vs SELECT
        if (nextToken === 'values') {
            this.consume(); // VALUES
            values = this.parseList(() => {
                this.consume(); // (
                //const row = this.parseList(() => this.parseExpression([',', ')']));
                const row = this.parseList(() => this.parseExpression());
                this.consume(); // )
                return row;
            });
        } else if (nextToken === 'select') {
            // RECURSION: Reuse your existing select parser!
            selectQuery = this.parseSelect();
        }

        return {
            type: 'InsertStatement',
            table,
            columns,
            values,
            selectQuery
        };
    }

    private parseUpdate(): UpdateNode {
        this.consume(); // UPDATE

        // 1. Get Target (Table name or Alias)
        let target = this.consume().value;
        while (this.peek()?.value === '.') {
            this.consume();
            target += '.' + this.consume().value;
        }

        // 2. Parse SET clause
        if (this.peek()?.value.toLowerCase() !== 'set') {
            throw new Error("Expected SET keyword in UPDATE statement");
        }
        this.consume(); // SET

        const assignments = this.parseList(() => {
            let col = this.consume().value;
            // Handle multipart col (e.g., t.Name)
            while (this.peek()?.value === '.') {
                this.consume();
                col += '.' + this.consume().value;
            }

            if (this.consume().value !== '=') throw new Error("Expected '=' in assignment");

            //const val = this.parseExpression([',', 'from', 'where']);
            const val = this.parseExpression();
            return { column: col, value: val };
        });

        // 3. Optional FROM clause (The T-SQL Join Syntax)
        let from: TableReference | null = null;
        if (this.peek()?.value.toLowerCase() === 'from') {
            this.consume();
            from = this.parseTableReference();
        }

        // 4. Optional WHERE clause
        let where: string | null = null;
        if (this.peek()?.value.toLowerCase() === 'where') {
            this.consume();
            where = this.parseExpression();
        }

        return {
            type: 'UpdateStatement',
            target,
            assignments,
            from,
            where
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
            from = this.parseTableReference();
        }

        // Optional WHERE clause
        let where: string | null = null;
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
            // 1. Variable Name (e.g., @ID)
            const name = this.consume().value;

            // 2. Data Type (e.g., VARCHAR(50) or INT)
            let dataType = this.consume().value;
            if (this.peek()?.type === TokenType.OpenParen) {
                dataType += this.consume().value; // (
                dataType += this.consume().value; // size/max
                if (this.peek()?.value === ',') {
                    dataType += this.consume().value; // ,
                    dataType += this.consume().value; // scale
                }
                dataType += this.consume().value; // )
            }

            // 3. Optional Assignment (e.g., @ID INT = 10)
            let initialValue: string | undefined = undefined;
            if (this.peek()?.value === '=') {
                this.consume(); // =
                //initialValue = this.parseExpression([',', ';', 'go']);
                initialValue = this.parseExpression();
            }

            return { name, dataType, initialValue };
        });

        return {
            type: 'DeclareStatement',
            variables
        };
    }

    private parseSet(): SetNode {
        this.consume(); // SET
        const variable = this.consume().value;

        // If it doesn't start with @, it might be a session option (SET NOCOUNT ON)
        if (!variable.startsWith('@')) {
            const optionValue = this.consume().value; // ON/OFF
            return {
                type: 'SetStatement',
                variable, // e.g., "NOCOUNT"
                value: optionValue // e.g., "ON"
            };
        }

        this.matchValue('=');
        const value = this.parseExpression();

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
        this.consume(); // Consume '('

        const columns = this.parseList(() => {
            // 1. Column Name (Handle bracketed or raw identifiers)
            const name = this.consume().value;

            // 2. Data Type parsing (e.g., nvarchar(max), decimal(18, 2))
            let dataType = this.consume().value;
            if (this.peek()?.value === '(') {
                dataType += this.consume().value; // (

                // Precision or MAX
                dataType += this.consume().value;

                // Scale (if exists, e.g. ,2)
                if (this.peek()?.value === ',') {
                    dataType += this.consume().value; // ,
                    dataType += this.consume().value; // scale
                }

                if (this.peek()?.value === ')') {
                    dataType += this.consume().value; // )
                }
            }

            // 3. Constraint Parsing logic
            const constraints: string[] = [];
            const stopWords = [',', ')'];

            while (this.pos < this.tokens.length && !stopWords.includes(this.peek()?.value)) {
                let current = this.consume().value;
                const next = this.peek()?.value?.toUpperCase();

                // Semantic grouping of T-SQL Keywords
                const upperCurrent = current.toUpperCase();
                if (upperCurrent === 'PRIMARY' && next === 'KEY') {
                    current += ' ' + this.consume().value;
                } else if (upperCurrent === 'NOT' && next === 'NULL') {
                    current += ' ' + this.consume().value;
                } else if (upperCurrent === 'FOREIGN' && next === 'KEY') {
                    current += ' ' + this.consume().value;
                } else if (upperCurrent === 'DEFAULT') {
                    // For DEFAULT, we capture the subsequent expression
                    constraints.push(current);
                    //current = this.parseExpression([',', ')']);
                    current = this.parseExpression();
                }

                constraints.push(current);
            }

            return {
                name,
                dataType,
                constraints: constraints.length > 0 ? constraints : undefined
            };
        });

        if (this.peek()?.value !== ')') {
            throw new Error("Expected ')' at end of column list");
        }
        this.consume(); // Consume ')'

        return columns;
    }

    private parseCreate(): CreateNode {
        this.consume(); // CREATE
        let objectType = this.consume().value.toUpperCase();

        // 1. Handle CREATE TYPE ... AS TABLE
        if (objectType === 'TYPE') {
            const name = this.consume().value;
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
        }

        // Standard Multipart Name Parsing (e.g., [dbo].[MyProc])
        let name = this.consume().value;
        while (this.peek()?.value === '.') {
            this.consume(); // .
            name += '.' + this.consume().value;
        }

        if (objectType === 'TABLE') {
            const columns = this.parseTableColumns();
            return { type: 'CreateStatement', objectType: 'TABLE', name, columns };
        }

        // 2. Handle Parameters for Procedures/Functions
        let parameters: ParameterDefinition[] = [];
        const isProcOrFunc = ['PROCEDURE', 'PROC', 'FUNCTION'].includes(objectType);

        if (isProcOrFunc) {
            const hasParens = this.peek()?.value === '(';
            if (hasParens) this.consume();

            // Check for variable start (@)
            if (this.peek()?.value.startsWith('@')) {
                parameters = this.parseList(() => {
                    const pName = this.consume().value; // @ID
                    const pType = this.consume().value; // INT

                    let isOutput = false;
                    if (this.peek()?.value.toUpperCase() === 'OUTPUT') {
                        isOutput = true;
                        this.consume();
                    }
                    return { name: pName, dataType: pType, isOutput };
                });
            }

            if (hasParens && this.peek()?.value === ')') this.consume();
        }

        // 3. Consume the 'AS' keyword before the body
        if (this.peek()?.value.toUpperCase() === 'AS') {
            this.consume();
        }

        // 4. Handle the Body (Single Statement for View, Batch for Proc)
        let body: Statement | Statement[] | undefined;
        if (objectType === 'VIEW') {
            const selectStmt = this.parseSelect();
            // Views only support a single SelectStatement (or QueryStatement)
            body = selectStmt;
        } else {
            const statements: Statement[] = [];
            // Parse until the end of the batch or the end of tokens
            while (this.pos < this.tokens.length && this.peek()?.value.toLowerCase() !== 'go') {
                const stmt = this.parseStatement();

                // TS FIX: Only push to Statement[] if stmt is not null
                if (stmt) {
                    statements.push(stmt);
                } else {
                    // If parseStatement returned null (e.g., hit GO or error), 
                    // we break if we aren't moving forward to prevent infinite loops.
                    if (this.pos >= this.tokens.length || this.peek()?.value.toLowerCase() === 'go') break;
                }
            }
            body = statements;
        }

        return {
            type: 'CreateStatement',
            objectType: objectType as any,
            name,
            parameters,
            body
        };
    }

    private parseColumn(): ColumnNode {
        let alias: string | undefined = undefined;
        let expression: string;
        let tablePrefix: string | undefined = undefined;
        let name: string;

        // Claude Review Fix (Issue #5): Comprehensive list of keywords that 
        // cannot be used as implicit aliases.
        const STOP_KEYWORDS = [
            'from', 'where', 'group', 'order', 'having',
            'union', 'all', 'except', 'intersect',
            'join', 'on', 'apply', 'into', 'outer', 'values'
        ];

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
                // Implicit alias: Only consume if it's an Identifier AND not a reserved keyword
                alias = this.consume().value;
            }
        }

        // 3. Extract tablePrefix and name for backward compatibility
        if (expression.includes('.')) {
            const parts = expression.split('.');
            // Handle cases like dbo.Table.Column
            tablePrefix = parts.slice(0, -1).join('.');
            name = parts[parts.length - 1];
        } else {
            name = expression;
        }

        return {
            type: 'Column',
            expression,
            name,
            tablePrefix,
            alias
        };
    }


    private parseTableReference(): TableReference {
        let table: string;
        let alias: string | undefined = undefined;

        // 1. Handle Derived Tables (Subqueries)
        if (this.peek()?.type === TokenType.OpenParen && this.peek(1)?.value.toLowerCase() === 'select') {
            this.consume(); // (
            const subquery = this.parseSelect();
            this.match(TokenType.CloseParen);
            // Stringify the subquery object to store it in the table string field
            table = `(${JSON.stringify(subquery)})`;
        } else {
            // 2. Handle Standard Table Names (Multipart: dbo.Users or [Sales].[Orders])
            table = this.consume().value;
            while (this.peek()?.value === '.') {
                this.consume(); // .
                table += '.' + this.consume().value;
            }
        }

        // 3. Handle Alias for the base source
        let nextToken = this.peek();
        let nextVal = nextToken?.value.toLowerCase();
        if (nextVal === 'as') {
            this.consume();
            alias = this.consume().value;
        } else if (
            nextToken &&
            nextToken.type === TokenType.Identifier &&
            !['inner', 'left', 'right', 'full', 'cross', 'join', 'where', 'group', 'order', 'union', 'all', 'on', 'apply'].includes(nextVal!)
        ) {
            alias = this.consume().value;
        }

        const joins: JoinNode[] = [];

        // 4. Handle JOIN and APPLY sequences
        while (this.pos < this.tokens.length) {
            const currentToken = this.peek();
            if (!currentToken) break;

            const typeMatch = currentToken.value.toLowerCase();
            if (!['inner', 'left', 'right', 'full', 'cross', 'join', 'outer'].includes(typeMatch)) break;

            let joinType = '';

            // Handle complex Join prefixes (LEFT OUTER, etc.)
            if (['left', 'right', 'full'].includes(typeMatch)) {
                joinType += this.consume().value.toUpperCase() + ' ';
                if (this.peek()?.value.toLowerCase() === 'outer') {
                    joinType += this.consume().value.toUpperCase() + ' ';
                }
            } else if (['inner', 'cross', 'outer'].includes(typeMatch)) {
                joinType += this.consume().value.toUpperCase() + ' ';
            }

            const actionToken = this.peek();
            const action = actionToken?.value.toLowerCase();

            if (action === 'join') {
                joinType += 'JOIN';
                this.consume(); // JOIN

                let joinTable: string;
                // RECURSION: Check if Join target is a subquery
                if (this.peek()?.type === TokenType.OpenParen && this.peek(1)?.value.toLowerCase() === 'select') {
                    this.consume(); // (
                    const sub = this.parseSelect();
                    this.match(TokenType.CloseParen);
                    joinTable = `(${JSON.stringify(sub)})`;
                } else {
                    joinTable = this.consume().value;
                    while (this.peek()?.value === '.') {
                        this.consume();
                        joinTable += '.' + this.consume().value;
                    }
                }

                // Join Alias
                let joinAlias: string | undefined = undefined;
                const postJoinVal = this.peek()?.value.toLowerCase();
                if (postJoinVal === 'as') {
                    this.consume();
                    joinAlias = this.consume().value;
                } else if (this.peek()?.type === TokenType.Identifier && !['on', 'inner', 'left', 'right', 'cross'].includes(postJoinVal!)) {
                    joinAlias = this.consume().value;
                }

                this.matchValue('on');
                const onCondition = this.parseExpression();

                joins.push({
                    type: joinType.trim(),
                    table: joinTable,
                    alias: joinAlias,
                    on: onCondition
                });
            } else if (action === 'apply') {
                joinType += 'APPLY';
                this.consume(); // APPLY

                // APPLY usually targets a function or a subquery
                const applyExpr = this.parseExpression();
                joins.push({
                    type: joinType.trim(),
                    table: applyExpr,
                    on: null
                });
            } else {
                // Standalone JOIN (e.g., just "JOIN Table ON...")
                if (typeMatch === 'join') {
                    this.consume();
                    // ... logic similar to JOIN above ...
                }
                break;
            }
        }

        return { table, alias, joins };
    }

    private isJoinToken(val?: string): boolean {
        return ['join', 'inner', 'left', 'right', 'cross'].includes(val?.toLowerCase() || '');
    }

    private parseJoin(): JoinNode {
        let type = 'inner';
        const first = this.consume().value.toLowerCase();

        // 1. Determine Join Type
        if (['left', 'right', 'full'].includes(first)) {
            if (this.peek()?.value.toLowerCase() === 'outer') this.consume();
            this.consume(); // JOIN
            type = first;
        } else if (first === 'inner') {
            this.consume(); // JOIN
            type = 'inner';
        } else if (first === 'cross') {
            this.consume(); // JOIN
            type = 'cross';
        } else if (first === 'join') {
            type = 'inner'; // Plain 'JOIN' is 'INNER JOIN'
        }

        // 2. Parse Table Name (Handling multipart like dbo.Orders)
        let table = this.consume().value;
        while (this.peek()?.value === '.') {
            this.consume(); // .
            table += '.' + this.consume().value;
        }

        // 3. Handle Table Alias (Crucial for the ON clause to work)
        let alias: string | undefined = undefined;
        const next = this.peek();
        if (next) {
            const val = next.value.toLowerCase();
            if (val === 'as') {
                this.consume();
                alias = this.consume().value;
            } else if (next.type === TokenType.Identifier && val !== 'on' && !this.isJoinToken(val)) {
                // Implicit alias (e.g., JOIN Orders o ON)
                alias = this.consume().value;
            }
        }

        // 4. Parse ON Clause
        let on = null;
        if (this.peek()?.value.toLowerCase() === 'on') {
            this.consume(); // ON
            on = this.parseExpression();
        }

        return {
            type: `${type}_join` as any,
            table,
            alias,
            on
        };
    }

    private parseExpression(precedence: Precedence = Precedence.LOWEST): string {
        let left = this.parsePrefix();

        while (this.pos < this.tokens.length) {
            const nextToken = this.peek();
            if (!nextToken || nextToken.type === TokenType.Semicolon) break;

            const op = nextToken.value.toLowerCase();
            const nextPrecedence = PRECEDENCE_MAP[op] ?? Precedence.LOWEST;

            if (nextPrecedence <= precedence) break;
            this.consume();

            // 1. Handle "IS NULL" / "IS NOT NULL" (Claude Issue #6)
            if (op === 'is') {
                let right = this.consume().value.toUpperCase(); // Expect NULL or NOT
                if (right === 'NOT') {
                    right += ' ' + this.consume().value.toUpperCase(); // Expect NULL
                }
                left = `${left} IS ${right}`;
            }
            // 2. Handle "NOT IN" / "NOT LIKE" (Claude Issue #7)
            else if (op === 'not') {
                const innerOp = this.consume().value.toLowerCase(); // in, like, between

                // Re-use the existing logic for IN/BETWEEN by delegating or duplicating
                if (innerOp === 'in') {
                    this.match(TokenType.OpenParen);
                    let innerContent: string;
                    if (this.peek()?.value.toLowerCase() === 'select') {
                        const subquery = this.parseSelect();
                        innerContent = JSON.stringify(subquery);
                    } else {
                        const items: string[] = [];
                        while (this.peek()?.type !== TokenType.CloseParen) {
                            items.push(this.parseExpression(Precedence.LOWEST));
                            if (this.peek()?.value === ',') this.consume();
                            else break;
                        }
                        innerContent = items.join(', ');
                    }
                    this.match(TokenType.CloseParen);
                    left = `${left} NOT IN (${innerContent})`;
                } else if (innerOp === 'between') {
                    const start = this.parseExpression(nextPrecedence);
                    this.matchValue('and');
                    const end = this.parseExpression(nextPrecedence);
                    left = `${left} NOT BETWEEN ${start} AND ${end}`;
                } else {
                    // For "NOT LIKE" etc.
                    const right = this.parseExpression(nextPrecedence);
                    left = `${left} NOT ${innerOp.toUpperCase()} ${right}`;
                }
            }
            // 3. Existing BETWEEN logic
            else if (op === 'between') {
                const start = this.parseExpression(nextPrecedence);
                this.matchValue('and');
                const end = this.parseExpression(nextPrecedence);
                left = `${left} BETWEEN ${start} AND ${end}`;
            }
            // 4. Existing IN logic
            else if (op === 'in') {
                this.match(TokenType.OpenParen);
                let innerContent: string;
                if (this.peek()?.value.toLowerCase() === 'select') {
                    const subquery = this.parseSelect();
                    innerContent = JSON.stringify(subquery);
                } else {
                    const items: string[] = [];
                    while (this.peek()?.type !== TokenType.CloseParen) {
                        items.push(this.parseExpression(Precedence.LOWEST));
                        if (this.peek()?.value === ',') this.consume();
                        else break;
                    }
                    innerContent = items.join(', ');
                }
                this.match(TokenType.CloseParen);
                left = `${left} IN (${innerContent})`;
            }
            // 5. Standard Infix
            else {
                const right = this.parseExpression(nextPrecedence);
                left = `${left} ${op.toUpperCase()} ${right}`;
            }
        }
        return left;
    }

    private parsePrefix(): string {
        const token = this.consume();
        let value = token.value;

        switch (token.type) {
            case TokenType.Number:
            case TokenType.Variable:
            case TokenType.String:
                return value;

            case TokenType.TempTable:
                return value;

            case TokenType.Operator:
                // Support for SELECT *
                if (value === '*') return value;

                // Support for unary operators like - or NOT
                if (value.toLowerCase() === 'not' || value === '-') {
                    const right = this.parseExpression(Precedence.PREFIX);
                    return `${value.toUpperCase()} ${right}`;
                }
                return value;

            case TokenType.Identifier:
                // 1. Handle Multipart Identifiers (e.g., dbo.Users, u.Name)
                while (this.peek()?.value === '.') {
                    this.consume(); // consume '.'
                    const next = this.consume();
                    value += '.' + next.value;
                }

                // 2. Handle Function Calls (e.g., SUM(Sales), GETDATE())
                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume(); // consume '('

                    // Handle subqueries inside function calls if necessary
                    if (this.peek()?.value.toLowerCase() === 'select') {
                        const subquery = this.parseSelect();
                        value += `(${JSON.stringify(subquery)})`;
                    } else {
                        // Standard function arguments
                        const args: string[] = [];
                        while (this.peek() && this.peek()?.type !== TokenType.CloseParen) {
                            args.push(this.parseExpression(Precedence.LOWEST));
                            if (this.peek()?.value === ',') {
                                this.consume(); // consume ','
                            } else {
                                break;
                            }
                        }
                        value += `(${args.join(', ')})`;
                    }
                    this.match(TokenType.CloseParen);
                }
                return value;

            case TokenType.OpenParen:
                // 3. Step 6: Handle Parenthesized Scalar Subqueries or Grouped Expressions
                let result: string;
                if (this.peek()?.value.toLowerCase() === 'select') {
                    const subquery = this.parseSelect();
                    result = JSON.stringify(subquery);
                } else {
                    result = this.parseExpression(Precedence.LOWEST);
                }
                this.match(TokenType.CloseParen);
                return `(${result})`;

            case TokenType.Keyword:
                const val = value.toLowerCase();
                if (val === 'null') return 'NULL';

                // Handle CASE Expressions (Step 5)
                if (val === 'case') {
                    let caseExpr = 'CASE';
                    if (this.peek()?.value.toLowerCase() !== 'when') {
                        caseExpr += ' ' + this.parseExpression(Precedence.LOWEST);
                    }
                    while (this.peek()?.value.toLowerCase() === 'when') {
                        this.consume(); // WHEN
                        const condition = this.parseExpression(Precedence.LOWEST);
                        this.matchValue('then');
                        const branchResult = this.parseExpression(Precedence.LOWEST);
                        caseExpr += ` WHEN ${condition} THEN ${branchResult}`;
                    }
                    if (this.peek()?.value.toLowerCase() === 'else') {
                        this.consume(); // ELSE
                        const elseResult = this.parseExpression(Precedence.LOWEST);
                        caseExpr += ` ELSE ${elseResult}`;
                    }
                    this.matchValue('end');
                    return `${caseExpr} END`;
                }

                // 4. Step 6: Handle EXISTS Subqueries
                if (val === 'exists') {
                    this.match(TokenType.OpenParen);
                    const subquery = this.parseSelect();
                    this.match(TokenType.CloseParen);
                    return `EXISTS (${JSON.stringify(subquery)})`;
                }
                return value;

            default:
                throw new Error(`Unexpected token at line ${token.line}: ${token.value}`);
        }
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
        const condition = this.parseExpression();

        // Parse the 'THEN' branch (T-SQL doesn't use a 'THEN' keyword)
        const thenBranch = this.parseStatement();

        let elseBranch: Statement | Statement[] | undefined = undefined;
        if (this.peek()?.value.toLowerCase() === 'else') {
            this.consume(); // ELSE
            elseBranch = this.parseStatement() ?? undefined;
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

        // Crucial: Check for 'end' only at the statement boundary
        while (this.pos < this.tokens.length && this.peek()?.value.toLowerCase() !== 'end') {
            const stmt = this.parseStatement();
            if (stmt) body.push(stmt);
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

    private resync() {
        // 1. Always move forward by at least one to prevent infinite loops
        this.pos++;

        const stopTokens = ['select', 'insert', 'update', 'delete', 'go', ';'];
        while (this.pos < this.tokens.length) {
            const token = this.peek();
            if (token.type === TokenType.Semicolon ||
                stopTokens.includes(token.value.toLowerCase())) {
                break;
            }
            this.pos++;
        }
    }
}