import { Lexer, Token, TokenType } from './lexer';


export interface JoinNode {
    type: string;
    table: string;
    on: string | null;
    alias?: string;
}


export interface ColumnNode {
    type: 'Column';
    tablePrefix?: string; // e.g., 'o'
    name: string;        // e.g., 'OrderName'
    alias?: string;       // e.g., 'OrderAlias'
}


// Add this near your other type definitions
export type QueryStatement = SelectNode | SetOperatorNode;

// Update your Statement union to include Insert
export type Statement = QueryStatement | InsertNode | UpdateNode | DeleteNode | DeclareNode | SetNode | CreateNode;

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

    public parse(): Program {
        const statements: Statement[] = [];
        while (this.pos < this.tokens.length) {
            try {
                // Explicitly type stmt here
                let stmt: Statement = this.parseStatement();

                // Only look for set operators if the current statement is a SELECT or another SetOperator
                if (stmt.type === 'SelectStatement' || stmt.type === 'SetOperator') {
                    while (this.pos < this.tokens.length) {
                        const nextVal = this.peek()?.value.toLowerCase();
                        if (['union', 'except', 'intersect'].includes(nextVal)) {
                            // TypeScript now knows stmt is a QueryStatement here
                            stmt = this.parseSetOperation(stmt as QueryStatement);
                        } else {
                            break;
                        }
                    }
                }

                statements.push(stmt);
                if (this.peek()?.type === TokenType.Semicolon) this.consume();
            } catch (e) {
                this.resync();
            }
        }
        return { type: 'Program', body: statements };
    }

    private parseSetOperation(left: QueryStatement): SetOperatorNode {
        let operatorVal = this.consume().value.toUpperCase();

        if (operatorVal === 'UNION' && this.peek()?.value.toLowerCase() === 'all') {
            this.consume();
            operatorVal = 'UNION ALL';
        }

        // We expect the right side to be another SELECT or UNION
        const right = this.parseStatement();

        // Type Guard: Ensure 'right' is not an INSERT
        if (right.type === 'InsertStatement') {
            throw new Error(`Syntax error: ${operatorVal} cannot be followed by an INSERT statement.`);
        }

        return {
            type: 'SetOperator',
            operator: operatorVal as any,
            left,
            right: right as QueryStatement
        };
    }

    private parseStatement(): Statement {
        const token = this.peek();
        if (!token) throw new Error("Unexpected EOF");

        const val = token.value.toLowerCase();

        switch (val) {
            case 'select': return this.parseSelect();
            case 'insert': return this.parseInsert();
            case 'update': return this.parseUpdate();
            case 'delete': return this.parseDelete();
            case 'declare': return this.parseDeclare();
            case 'set': return this.parseSet();
            case 'create': return this.parseCreate();
            case 'go':
                this.consume();
                return { type: 'BatchSeparator' } as any;
            default:
                throw new Error(`Parser stuck at token: "${token.value}" (Type: ${token.type}) at pos ${this.pos}`);
        }
    }

    private parseSelect(stopTokens: string[] = []): SelectNode {
        this.consume(); // Consume 'SELECT'

        let top = null;
        let distinct = false;

        const nextVal = this.peek()?.value.toLowerCase();
        if (nextVal === 'distinct') {
            this.consume();
            distinct = true;
        } else if (nextVal === 'all') {
            this.consume(); // ALL is the default behavior
        }

        if (this.peek()?.value.toLowerCase() === 'top') {
            this.consume(); // TOP
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume(); // (
                top = this.consume().value;
                this.consume(); // )
            } else {
                top = this.peek()?.type === TokenType.Number ? this.consume().value : null;
            }
        }

        const columns = this.parseList(() => this.parseColumn());

        let from: TableReference | null = null;
        if (this.peek()?.value.toLowerCase() === 'from') {
            this.consume(); // FROM
            from = this.parseTableReference();
        }

        let where = null;
        if (this.peek()?.value.toLowerCase() === 'where') {
            this.consume(); // WHERE
            where = this.parseExpression(stopTokens);
        }

        let groupBy: string[] | null = null;
        if (this.peek()?.value.toLowerCase() === 'group') {
            this.consume(); // GROUP
            if (this.peek()?.value.toLowerCase() === 'by') {
                this.consume(); // BY
                groupBy = this.parseGroupBy();
            }
        }

        let having: string | null = null;
        if (this.peek()?.value.toLowerCase() === 'having') {
            this.consume(); // HAVING
            having = this.parseExpression(stopTokens);
        }

        let orderBy: OrderByNode[] | null = null;
        if (this.peek()?.value.toLowerCase() === 'order') {
            this.consume(); // ORDER
            if (this.peek()?.value.toLowerCase() === 'by') {
                this.consume(); // BY
                orderBy = this.parseOrderBy();
            }
        }

        return { type: 'SelectStatement', distinct, top, columns, from, where, groupBy, having, orderBy };
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
                const row = this.parseList(() => this.parseExpression([',', ')']));
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

            const val = this.parseExpression([',', 'from', 'where']);
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
                initialValue = this.parseExpression([',', ';', 'go']);
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

        // 1. Variable Name
        const variable = this.consume().value;
        if (!variable.startsWith('@')) {
            // Technically T-SQL SET can set options like SET NOCOUNT ON,
            // but for now, we'll focus on variable assignment.
        }

        // 2. The Equals Operator
        if (this.peek()?.value !== '=') {
            throw new Error(`Expected '=' after variable ${variable} in SET statement`);
        }
        this.consume(); // =

        // 3. The Expression
        const value = this.parseExpression([';', 'go', 'select', 'insert', 'update', 'delete']);

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
                    current = this.parseExpression([',', ')']);
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
                    return { type: 'CreateStatement', objectType: 'TYPE', name, columns, isTableType: true };
                }
            }
        }

        // Standard Name Parsing
        let name = this.consume().value;
        while (this.peek()?.value === '.') {
            this.consume();
            name += '.' + this.consume().value;
        }

        if (objectType === 'TABLE') {
            const columns = this.parseTableColumns();
            return { type: 'CreateStatement', objectType: 'TABLE', name, columns };
        }

        // 2. Handle Parameters (Fix for @ID error)
        let parameters: ParameterDefinition[] = [];
        const isProcOrFunc = ['PROCEDURE', 'PROC', 'FUNCTION'].includes(objectType);

        if (isProcOrFunc) {
            // T-SQL parameters can be wrapped in parens or just listed
            const hasParens = this.peek()?.value === '(';
            if (hasParens) this.consume();

            // Peek to see if a variable (@Name) follows
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

        // 3. Crucial: Consume the 'AS' keyword before parsing the body
        if (this.peek()?.value.toUpperCase() === 'AS') {
            this.consume();
        }

        // 4. Handle the Body
        let body: Statement | Statement[] | undefined;
        if (objectType === 'VIEW') {
            body = this.parseSelect();
        } else {
            const statements: Statement[] = [];
            // Parse until the end of tokens or a batch separator
            while (this.pos < this.tokens.length && this.peek()?.value.toLowerCase() !== 'go') {
                statements.push(this.parseStatement());
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
        let tablePrefix: string | undefined = undefined;
        let name = "";
        let alias: string | undefined = undefined;

        // 1. Assignment Alias (e.g., SELECT Alias = o.Name)
        if (this.peek()?.type === TokenType.Identifier && this.peek(1)?.value === '=') {
            alias = this.consume().value;
            this.consume(); // =
        }

        // 2. Parse the Column and Prefix
        let firstPart = this.consume().value;

        if (this.peek()?.value === '.') {
            this.consume(); // .
            tablePrefix = firstPart;
            name = this.consume().value; // The actual column name
        } else {
            name = firstPart;
        }

        // 3. Handle Functions (e.g., SUM(Sales))
        if (this.peek()?.type === TokenType.OpenParen) {
            name += this.consume().value; // (
            name += this.parseExpression();
            if (this.peek()?.type === TokenType.CloseParen) {
                name += this.consume().value; // )
            }
        }

        // 4. Handle Post-Expression Alias (AS or Implicit)
        if (!alias) {
            const next = this.peek();
            if (next?.value.toLowerCase() === 'as') {
                this.consume();
                alias = this.consume().value;
            } else if (next?.type === TokenType.Identifier &&
                !['from', 'where', 'group', 'join', 'on'].includes(next.value.toLowerCase())) {
                alias = this.consume().value;
            }
        }

        return { type: 'Column', tablePrefix, name, alias };
    }


    private parseTableReference(): TableReference {
        let table = this.consume().value;

        // Handle multipart identifiers (e.g., Sales.Data)
        while (this.peek()?.value === '.') {
            this.consume(); // .
            table += '.' + this.consume().value;
        }

        let alias: string | undefined;
        if (this.peek()?.value.toLowerCase() === 'as') {
            this.consume();
            alias = this.consume().value;
        } else if (this.peek()?.type === TokenType.Identifier &&
            !['join', 'inner', 'left', 'right', 'cross', 'where', 'group', 'order'].includes(this.peek()?.value.toLowerCase())) {
            // Handle implicit alias (e.g., FROM Sales s)
            alias = this.consume().value;
        }

        const joins: JoinNode[] = [];
        while (this.isJoinToken(this.peek()?.value)) {
            joins.push(this.parseJoin());
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

    private parseExpression(additionalStopTokens: string[] = []): string {
        let expr = "";
        const baseStopTokens = ['select', 'from', 'where', 'join', 'go', ';', 'inner', 'left', 'right', 'order', 'group', 'having', 'union'];
        const stopTokens = [...baseStopTokens, ...additionalStopTokens];

        while (this.pos < this.tokens.length) {
            const token = this.peek();
            if (!token) break;

            const val = token.value.toLowerCase();

            // 1. Stop if we hit a base keyword or a context-specific stop token (like ')')
            if (stopTokens.includes(val)) break;

            // 2. Subquery Detection: Check for '(' followed by 'SELECT'
            if (token.type === TokenType.OpenParen) {
                const nextToken = this.peek(1);
                if (nextToken?.value.toLowerCase() === 'select') {
                    this.consume(); // Consume '('

                    // Recursively parse the nested SELECT, telling it to stop at ')'
                    const subquery = this.parseSelect([')']);

                    // Add a space before the subquery if needed
                    if (expr.length > 0 && !expr.endsWith(" ")) {
                        expr += " ";
                    }

                    expr += "(" + JSON.stringify(subquery) + ")";

                    // Consume the matching ')' for this subquery
                    if (this.peek()?.value === ')') {
                        this.consume();
                    }
                    continue; // Move to the next token after the subquery
                }
            }

            const currentToken = this.consume();
            const currentVal = currentToken.value;

            // 3. Spacing and Reconstruction Logic
            if (expr.length > 0) {
                const lastChar = expr[expr.length - 1];
                // Split to find the last meaningful word/variable
                const lastWord = expr.split(/[ \(\),]/).filter(Boolean).pop()?.toLowerCase() || "";
                const isLastVariable = lastWord.startsWith('@');

                const isOperator = ['=', '>', '<', '>=', '<=', '!=', '<>', '+', '-', '*', '/'].includes(currentVal);
                const isLastOperator = ['=', '>', '<', '!', '=', '+', '-', '*', '/'].includes(lastChar);
                const isPunctuation = ['(', ')', '[', ']', ',', '.'].includes(currentVal) || ['(', '[', '.'].includes(lastChar);
                const isQuote = currentVal === "'" || lastChar === "'";
                const isWord = /[a-zA-Z]/.test(currentVal) && currentVal.length > 1;
                const isLastWord = /[a-zA-Z]/.test(lastChar);

                let needsSpace = false;

                // Standard word spacing
                if (isWord && isLastWord && !isLastOperator) needsSpace = true;

                // Updated Operator Rule: 
                // Space before operators if following a word, variable, or a closing parenthesis (Fixes SUM(Sales) >)
                if (isOperator && (isLastWord || isLastVariable || lastChar === ')') && !isLastOperator && !isQuote) {
                    needsSpace = true;
                }

                // Space after operators if not followed by punctuation
                if (!isOperator && isLastOperator && !isPunctuation && currentVal !== '-') {
                    needsSpace = true;
                }

                // T-SQL Keyword specific spacing
                if (currentVal.toUpperCase() === 'AND' || expr.trim().endsWith('AND')) needsSpace = true;
                if (lastWord === 'in' || lastWord === 'between') needsSpace = true;
                if (lastChar === ',') needsSpace = true;

                // Handle space before '(' for keywords like IN
                if (currentVal === '(' && lastWord === 'in') needsSpace = true;

                if (needsSpace && !expr.endsWith(" ")) {
                    expr += " ";
                }
            }

            expr += currentVal;
        }
        return expr.trim();
    }

    private parseGroupBy(): string[] {
        return this.parseList(() => {
            let column = this.consume().value;

            // Handle multipart identifiers (e.g., Sales.Region)
            while (this.peek()?.value === '.') {
                this.consume(); // .
                column += '.' + this.consume().value;
            }

            return column;
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