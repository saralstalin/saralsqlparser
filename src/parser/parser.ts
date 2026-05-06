import { Lexer, Token, TokenType } from './lexer';
import {
    // Core
    Program,
    ParseResult,
    ParseIssue,
    NodeLocation,

    // Statements
    Statement,
    QueryStatement,
    InsertNode,
    UpdateNode,
    DeleteNode,
    DeclareNode,
    SetNode,
    CreateNode,
    IfNode,
    BlockNode,
    WithNode,
    PrintNode,
    ErrorNode,

    // Expressions
    Expression,
    IdentifierNode,
    GroupingExpression,
    SubqueryExpression,
    OverExpression,
    MemberExpression,
    WildcardExpression,
    WindowDefinition,

    // Table / relational
    TableReference,
    JoinNode,
    JoinType,
    ColumnNode,
    OrderByNode,

    // DML helpers
    UpdateAssignment,

    // DDL / metadata
    VariableDeclaration,
    ColumnDefinition,
    ParameterDefinition,
    CTENode,

    // OUTPUT clause
    OutputClauseNode,
    OutputColumnNode

} from '@/ast/types';


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

const JoinTypes: Record<string, JoinType> = {
    INNER: 'INNER JOIN',
    LEFT_OUTER: 'LEFT OUTER JOIN',
    RIGHT_OUTER: 'RIGHT OUTER JOIN',
    FULL_OUTER: 'FULL OUTER JOIN',
    CROSS: 'CROSS JOIN',
    CROSS_APPLY: 'CROSS APPLY',
    OUTER_APPLY: 'OUTER APPLY',
};

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
    private issues: ParseIssue[] = [];

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

            // Handle T-SQL batch separator
            if (token?.value === 'GO') {
                this.consume();
                continue;
            }

            const beforePos = this.pos;

            let stmt: Statement | null = null;

            try {
                stmt = this.parseStatement();
            } catch (e) {
                // Defensive catch — should be rare now
                const message =
                    e instanceof Error ? e.message : String(e);

                this.addIssue(
                    'PARSE_FATAL',
                    message,
                    token?.offset ?? 0,
                    token
                        ? token.offset + token.value.length
                        : 0
                );

                this.resync();
            }

            if (stmt) {
                statements.push(stmt);
            }

            // Ensure forward progress (VERY important)
            if (this.pos === beforePos) {
                const stuckToken = this.peek();

                if (stuckToken) {
                    this.addIssue(
                        'PARSE_STUCK',
                        `Parser could not consume token: ${stuckToken.value}`,
                        stuckToken.offset,
                        stuckToken.offset + stuckToken.value.length
                    );

                    this.consume(); // force advance
                } else {
                    break;
                }
            }

            // consume semicolon
            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
            }
        }

        const ast: Program = {
            type: 'Program',
            body: statements
        };

        return {
            ast,
            issues: this.issues
        };
    }

    private parseMultipartIdentifier(): Expression {
        const segments: Token[] = [];

        const startToken = this.peek();
        let startOffset = startToken?.offset ?? 0;
        let endOffset = startOffset;

        // --- 1. First segment (never throw) ---
        const first = this.peek();

        if (
            !first ||
            ![
                TokenType.Identifier,
                TokenType.Keyword,
                TokenType.Variable,
                TokenType.TempTable
            ].includes(first.type) ||
            (first.type === TokenType.Keyword &&
                this.isStructuralKeyword(first.value))
        ) {
            const message = `Expected identifier`;

            this.addRecoverableError(
                [],
                'PARSE_IDENTIFIER',
                message,
                startOffset,
                startOffset + 1
            );

            return {
                type: 'Identifier',
                name: '',
                parts: [],
                start: startOffset,
                end: startOffset,
                incomplete: true,
                errors: [message]
            } as IdentifierNode;
        }

        const consumedFirst = this.consume();
        segments.push(consumedFirst);

        startOffset = consumedFirst.offset;
        endOffset = consumedFirst.offset + consumedFirst.value.length;

        // --- 2. Dot chain ---
        while (this.peek()?.type === TokenType.Dot) {
            const dot = this.consume();
            endOffset = dot.offset + dot.value.length;

            // wildcard: alias.*
            if (this.peek()?.value === '*') {
                const star = this.consume();

                const prefixParts = segments.map(t => t.value);

                const prefixNode: IdentifierNode = {
                    type: 'Identifier',
                    name: prefixParts.join('.'),
                    parts: prefixParts,
                    start: startOffset,
                    end:
                        segments[segments.length - 1].offset +
                        segments[segments.length - 1].value.length
                };

                return {
                    type: 'WildcardExpression',
                    tablePrefix: prefixNode,
                    start: startOffset,
                    end: star.offset + star.value.length
                } as WildcardExpression;
            }

            const next = this.peek();

            // ❗ Missing segment (dbo.)
            if (
                !next ||
                next.type === TokenType.Semicolon ||
                this.isStructuralKeyword(next.value)
            ) {
                const message = 'Expected identifier after dot';

                this.addRecoverableError(
                    [],
                    'PARSE_IDENTIFIER_DOT',
                    message,
                    dot.offset,
                    endOffset
                );

                return {
                    type: 'Identifier',
                    name:
                        segments.map(t => t.value).join('.') + '.',
                    parts: [...segments.map(t => t.value), ''],
                    start: startOffset,
                    end: endOffset,
                    incomplete: true,
                    errors: [message]
                } as IdentifierNode;
            }

            // consume next segment safely
            const consumedNext = this.consume();

            if (
                consumedNext.type === TokenType.Keyword &&
                this.isStructuralKeyword(consumedNext.value)
            ) {
                const message = `Expected identifier after dot but found ${consumedNext.value}`;

                this.addRecoverableError(
                    [],
                    'PARSE_IDENTIFIER_DOT',
                    message,
                    consumedNext.offset,
                    consumedNext.offset + consumedNext.value.length
                );

                return {
                    type: 'Identifier',
                    name:
                        segments.map(t => t.value).join('.') + '.',
                    parts: [...segments.map(t => t.value), ''],
                    start: startOffset,
                    end: consumedNext.offset + consumedNext.value.length,
                    incomplete: true,
                    errors: [message]
                } as IdentifierNode;
            }

            segments.push(consumedNext);
            endOffset =
                consumedNext.offset + consumedNext.value.length;
        }

        // --- 3. Final node ---
        const last = segments[segments.length - 1];

        return {
            type: 'Identifier',
            name: segments.map(t => t.value).join('.'),
            parts: segments.map(t => t.value),
            start: startOffset,
            end: last.offset + last.value.length
        } as IdentifierNode;
    }

    private normalizeSetTree(node: QueryStatement): QueryStatement {
        if (node.type !== 'SetOperator') {
            return node;
        }

        // normalize children first
        const left = this.normalizeSetTree(node.left);
        const right = this.normalizeSetTree(node.right);

        // 🔥 rotate left-deep → right-deep
        if (left.type === 'SetOperator') {
            return {
                type: 'SetOperator',
                operator: left.operator,
                left: left.left,
                right: this.normalizeSetTree({
                    type: 'SetOperator',
                    operator: node.operator,
                    left: left.right,
                    right: right,
                    start: left.right.start,
                    end: right.end
                }),
                start: left.start,
                end: right.end
            };
        }

        return {
            ...node,
            left,
            right
        };
    }

    private parseSetOperation(
        left: QueryStatement,
        minPrecedence: number = 1
    ): QueryStatement {

        while (true) {
            const token = this.peek();
            if (!token) break;

            let op = token.value.toUpperCase();

            if (!['UNION', 'EXCEPT', 'INTERSECT'].includes(op)) {
                break;
            }

            // detect UNION ALL (lookahead only)
            let fullOp = op;
            let isUnionAll = false;

            if (
                op === 'UNION' &&
                this.peek(1)?.value?.toUpperCase() === 'ALL'
            ) {
                fullOp = 'UNION ALL';
                isUnionAll = true;
            }

            const precedence = this.getSetPrecedence(fullOp);

            // 🔥 precedence guard BEFORE consuming
            if (precedence < minPrecedence) {
                break;
            }

            // consume operator
            this.consume();
            if (isUnionAll) this.consume();

            let right: QueryStatement | null = null;

            const next = this.peek();
            if (
                next &&
                next.type !== TokenType.Semicolon &&
                next.value !== ')'
            ) {
                // ✅ FIX: DO NOT use precedence + 1
                const rightStart = this.parseSelect();

                right = this.parseSetOperation(
                    rightStart,
                    precedence
                );
            }

            // 🔥 recovery: keep left intact if RHS missing
            if (!right) {
                return left;
            }

            left = {
                type: 'SetOperator',
                operator: fullOp as
                    | 'UNION'
                    | 'UNION ALL'
                    | 'EXCEPT'
                    | 'INTERSECT',
                left,
                right,
                start: left.start,
                end: right.end
            };
        }

        return left;
    }

    private getSetPrecedence(op: string): number {
        switch (op) {
            case 'INTERSECT': return 2;
            case 'UNION':
            case 'UNION ALL':
            case 'EXCEPT': return 1;
            default: return 0;
        }
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
                case 'WITH': stmt = this.parseWith(); break;
                case 'PRINT': stmt = this.parsePrint(); break;

                case 'GO':
                    this.consume();
                    return null;

                case 'WHEN':
                case 'THEN':
                case 'ELSE':
                case 'END':
                    throw new Error(
                        `Unexpected keyword: ${token.value}. This must be part of an expression.`
                    );

                default:
                    if (token.type === TokenType.Semicolon) {
                        this.consume();
                        return null;
                    }
                    throw new Error(`Unexpected token: ${token.value}`);
            }

        } catch (e) {
            const errorMsg =
                e instanceof Error ? e.message : String(e);

            const errorEnd = this.peek()
                ? this.peek()!.offset + this.peek()!.value.length
                : startOffset + 1;

            const errors: string[] = [];

            // ✅ FIX: use centralized error pipeline
            this.addRecoverableError(
                errors,
                'PARSE_STATEMENT_ERROR',
                errorMsg,
                startOffset,
                errorEnd
            );

            this.resync();

            return {
                type: 'ErrorStatement',
                message: errorMsg,
                start: startOffset,
                end: errorEnd,
                ...(errors.length ? { errors } : {})
            } as ErrorNode;
        }

        // Preserve semicolon handling
        if (stmt && this.peek()?.type === TokenType.Semicolon) {
            this.consume();
        }

        return stmt;
    }

    private addRecoverableError(
        errors: string[],
        code: string,
        message: string,
        fallbackStart?: number,
        fallbackEnd?: number
    ): void {
        errors.push(message);

        const token = this.peek();

        this.addIssue(
            code,
            message,
            fallbackStart ?? token?.offset ?? 0,
            fallbackEnd ??
            (
                token
                    ? token.offset + token.value.length
                    : (fallbackStart ?? 0) + 1
            )
        );
    }

    private parseSelect(): QueryStatement {
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

            const hasParens =
                this.peek()?.type === TokenType.OpenParen;

            if (hasParens) {
                this.consume();
            }

            try {
                top = this.consume().value;
            } catch {
                top = null;
            }

            if (
                hasParens &&
                this.peek()?.type === TokenType.CloseParen
            ) {
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

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_EMPTY_COLUMNS',
                    'Expected SELECT column list',
                    startToken.offset,
                    startToken.offset + startToken.value.length
                );
            }

        } catch (e) {
            columns = [];
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_SELECT_COLUMNS',
                e instanceof Error ? e.message : String(e),
                startToken.offset
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

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_EMPTY_FROM',
                        'Expected FROM source',
                        endOffset
                    );
                }

            } catch (e) {
                from = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_FROM',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 5. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword('WHERE')) {
            const whereToken = this.consume();
            endOffset =
                whereToken.offset + whereToken.value.length;

            try {
                where = this.parseExpression();

                if (where) {
                    endOffset = where.end;
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_WHERE',
                    e instanceof Error ? e.message : String(e),
                    whereToken.offset,
                    endOffset
                );
            }
        }

        // 6. GROUP BY
        let groupBy: Expression[] | null = null;

        if (this.peekKeyword('GROUP')) {
            const groupToken = this.consume();
            endOffset =
                groupToken.offset + groupToken.value.length;

            let hasBy = false;

            try {
                this.matchKeyword('BY');
                endOffset = this.lastConsumedEnd();
                hasBy = true;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_GROUP_BY',
                    e instanceof Error ? e.message : String(e),
                    groupToken.offset,
                    endOffset
                );
            }

            if (hasBy) {
                try {
                    groupBy = this.parseList(() =>
                        this.parseExpression()
                    );

                    if (groupBy.length > 0) {
                        endOffset =
                            groupBy[groupBy.length - 1].end;
                    } else {
                        groupBy = [];
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_SELECT_EMPTY_GROUP_BY',
                            'Expected GROUP BY expression',
                            endOffset
                        );
                    }

                } catch (e) {
                    groupBy = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_GROUP_EXPR',
                        e instanceof Error ? e.message : String(e),
                        endOffset
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
            endOffset =
                havingToken.offset + havingToken.value.length;

            try {
                having = this.parseExpression();

                if (having) {
                    endOffset = having.end;
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_HAVING',
                    e instanceof Error ? e.message : String(e),
                    havingToken.offset,
                    endOffset
                );
            }
        }

        // 8. ORDER BY
        let orderBy: OrderByNode[] | null = null;

        if (this.peekKeyword('ORDER')) {
            const orderToken = this.consume();
            endOffset =
                orderToken.offset + orderToken.value.length;

            let hasBy = false;

            try {
                this.matchKeyword('BY');
                endOffset = this.lastConsumedEnd();
                hasBy = true;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_ORDER_BY',
                    e instanceof Error ? e.message : String(e),
                    orderToken.offset,
                    endOffset
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
                                dirToken.offset +
                                dirToken.value.length;
                        } else if (this.peekKeyword('ASC')) {
                            const dirToken = this.consume();
                            direction = 'ASC';
                            itemEnd =
                                dirToken.offset +
                                dirToken.value.length;
                        }

                        return {
                            expression: expr,
                            direction,
                            start: expr.start,
                            end: itemEnd
                        } as OrderByNode;
                    });

                    if (orderBy.length > 0) {
                        endOffset =
                            orderBy[orderBy.length - 1].end;
                    } else {
                        orderBy = [];
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_SELECT_EMPTY_ORDER_BY',
                            'Expected ORDER BY expression',
                            endOffset
                        );
                    }

                } catch (e) {
                    orderBy = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_ORDER_EXPR',
                        e instanceof Error ? e.message : String(e),
                        endOffset
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

    private isInsertRecoveryBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        return (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen ||
            token.type === TokenType.Comma
        );
    }

    private parseInsert(): InsertNode {
        const startToken = this.matchKeyword('INSERT');

        let incomplete = false;
        const errors: string[] = [];
        let output: OutputClauseNode | undefined;

        if (this.peekKeyword('INTO')) {
            this.consume();
        }

        let tableNode: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        // ✅ FIXED: ONLY stop at semicolon
        const syncToStatementBoundary = () => {
            while (this.peek()) {
                const t = this.peek()!;

                if (t.type === TokenType.Semicolon) {
                    return; // do NOT consume
                }

                this.consume();
            }
        };

        // 1) Target table
        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value) &&
                next.type !== TokenType.OpenParen &&
                next.type !== TokenType.Semicolon
            ) {
                tableNode = this.parseMultipartIdentifier();
                endOffset = tableNode.end;

                // detect invalid identifier like "dbo."
                if (
                    tableNode.type === 'Identifier' &&
                    (tableNode.incomplete || tableNode.parts.includes(''))
                ) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_INSERT_TABLE',
                        'Invalid table name in INSERT',
                        tableNode.start,
                        tableNode.end
                    );

                    syncToStatementBoundary();

                    return {
                        type: 'InsertStatement',
                        table: tableNode,
                        columns: null,
                        output: undefined,
                        values: null,
                        selectQuery: null,
                        start: startToken.offset,
                        end: endOffset,
                        incomplete: true,
                        ...(errors.length ? { errors } : {})
                    };
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_INSERT_TARGET',
                    'Expected target table',
                    startToken.offset,
                    endOffset
                );

                syncToStatementBoundary();

                return {
                    type: 'InsertStatement',
                    table: tableNode,
                    columns: null,
                    output: undefined,
                    values: null,
                    selectQuery: null,
                    start: startToken.offset,
                    end: endOffset,
                    incomplete: true,
                    ...(errors.length ? { errors } : {})
                };
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_INSERT_TARGET',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );

            syncToStatementBoundary();

            return {
                type: 'InsertStatement',
                table: tableNode,
                columns: null,
                output: undefined,
                values: null,
                selectQuery: null,
                start: startToken.offset,
                end: endOffset,
                incomplete: true,
                ...(errors.length ? { errors } : {})
            };
        }

        // 2) Column list (unchanged)
        let columns: string[] | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            const openParen = this.consume();
            endOffset = openParen.offset + openParen.value.length;

            try {
                if (this.peek()?.type !== TokenType.CloseParen) {
                    columns = this.parseList(() => {
                        const node = this.parseMultipartIdentifier();
                        if (node.type === 'Identifier') return node.name;
                        throw new Error(
                            'Wildcards are not allowed in an INSERT column list'
                        );
                    });
                } else {
                    columns = [];
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    const closeParen = this.consume();
                    endOffset = closeParen.offset + closeParen.value.length;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_INSERT_COLUMNS_CLOSE',
                        'Expected ) after column list',
                        endOffset,
                        endOffset
                    );
                }
            } catch (e) {
                columns = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_INSERT_COLUMNS',
                    e instanceof Error ? e.message : String(e),
                    openParen.offset,
                    endOffset
                );

                this.recoverTo(['OUTPUT', 'VALUES', 'SELECT', 'WITH', ';']);
            }
        }

        // 3) OUTPUT (unchanged)
        if (this.peekKeyword('OUTPUT')) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_INSERT_OUTPUT',
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                    endOffset
                );

                this.recoverTo(['VALUES', 'SELECT', 'WITH', ';']);
            }
        }

        // 4) VALUES / SELECT (unchanged)
        let values: Expression[][] | null = null;
        let selectQuery: QueryStatement | null = null;

        const nextVal = this.peek()?.value?.toUpperCase();

        if (nextVal === 'VALUES') {
            const valuesToken = this.consume();
            endOffset = valuesToken.offset + valuesToken.value.length;

            values = [];
            let sawValuesRow = false;

            while (
                this.peek() &&
                this.peek()!.type !== TokenType.Semicolon
            ) {
                if (this.peek()!.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                if (this.peek()!.type !== TokenType.OpenParen) break;

                this.consume();
                sawValuesRow = true;

                const row: Expression[] = [];

                while (
                    this.peek() &&
                    this.peek()!.type !== TokenType.CloseParen
                ) {
                    if (this.peek()!.type === TokenType.Comma) {
                        this.consume();
                        continue;
                    }

                    try {
                        const expr = this.parseExpression(Precedence.LOWEST);
                        row.push(expr);
                        endOffset = expr.end;
                    } catch (e) {
                        incomplete = true;
                        break;
                    }
                }

                values.push(row);

                if (this.peek()?.type === TokenType.CloseParen) {
                    const close = this.consume();
                    endOffset = close.offset + close.value.length;
                }
            }

            if (!sawValuesRow) {
                values = [[]];
                incomplete = true;
            }
        } else if (nextVal === 'SELECT' || nextVal === 'WITH') {
            try {
                selectQuery = this.parseQueryExpression();
                endOffset = selectQuery.end;
            } catch (e) {
                incomplete = true;
            }
        }

        return {
            type: 'InsertStatement',
            table: tableNode,
            columns,
            output,
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
        let endOffset =
            startToken.offset + startToken.value.length;
        let output: OutputClauseNode | undefined;

        // 1. Target
        let targetNode: Expression | null = null;

        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value)
            ) {
                targetNode =
                    this.parseMultipartIdentifier();

                endOffset = targetNode.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_TARGET',
                    'Expected update target',
                    startToken.offset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_UPDATE_TARGET',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );

            this.recoverTo(['SET']);
        }

        // 2. SET
        let sawSet = false;

        try {
            this.matchKeyword('SET');
            endOffset = this.lastConsumedEnd();
            sawSet = true;

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_UPDATE_SET',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // 3. Assignments
        let assignments: UpdateAssignment[] = [];

        if (sawSet) {
            try {
                assignments = this.parseList(() => {
                    let columnName = '';
                    let value: Expression | null = null;

                    // column
                    try {
                        const next = this.peek();

                        if (
                            !next ||
                            this.isStructuralKeyword(next.value)
                        ) {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                'PARSE_UPDATE_ASSIGNMENT_COLUMN',
                                'Expected assignment column',
                                endOffset
                            );

                            return {
                                column: '',
                                value: null
                            };
                        }

                        const columnExpr =
                            this.parseMultipartIdentifier();

                        if (
                            columnExpr.type === 'Identifier'
                        ) {
                            columnName = columnExpr.name;
                            endOffset = columnExpr.end;
                        } else {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                'PARSE_UPDATE_ASSIGNMENT_TARGET',
                                'Wildcards are not allowed as update targets',
                                endOffset
                            );

                            return {
                                column: '',
                                value: null
                            };
                        }

                    } catch (e) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_UPDATE_ASSIGNMENT_COLUMN',
                            e instanceof Error
                                ? e.message
                                : String(e),
                            endOffset
                        );

                        return {
                            column: '',
                            value: null
                        };
                    }

                    // =
                    if (this.peek()?.value !== '=') {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_UPDATE_ASSIGNMENT_EQUALS',
                            'Expected =',
                            endOffset
                        );

                        return {
                            column: columnName,
                            value: null
                        };
                    }

                    const eqToken = this.consume();
                    endOffset =
                        eqToken.offset + eqToken.value.length;

                    // value
                    try {
                        value = this.parseExpression();

                        if (value) {
                            endOffset = value.end;
                        }

                    } catch (e) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_UPDATE_ASSIGNMENT_VALUE',
                            e instanceof Error
                                ? e.message
                                : String(e),
                            endOffset
                        );
                    }

                    return {
                        column: columnName,
                        value
                    };
                });

                if (assignments.length === 0) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_UPDATE_EMPTY_ASSIGNMENTS',
                        'Expected SET assignment',
                        endOffset
                    );
                }

            } catch (e) {
                assignments = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_ASSIGNMENTS',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );

                this.recoverTo([
                    'OUTPUT',
                    'FROM',
                    'WHERE'
                ]);
            }
        }

        // 4. OUTPUT
        if (this.peekKeyword('OUTPUT')) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_OUTPUT',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );

                this.recoverTo([
                    'FROM',
                    'WHERE'
                ]);
            }
        }

        // 5. FROM
        let from: TableReference[] | null = null;

        if (this.peekKeyword('FROM')) {
            try {
                from = this.parseFrom();

                if (from.length > 0) {
                    endOffset =
                        from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_UPDATE_EMPTY_FROM',
                        'Expected FROM source',
                        endOffset
                    );
                }

            } catch (e) {
                from = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_FROM',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );

                this.recoverTo(['WHERE']);
            }
        }

        // 6. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword('WHERE')) {
            const whereToken = this.consume();
            endOffset =
                whereToken.offset + whereToken.value.length;

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

                    this.addRecoverableError(
                        errors,
                        'PARSE_UPDATE_WHERE',
                        'Expected WHERE expression',
                        whereToken.offset,
                        endOffset
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_WHERE',
                    e instanceof Error ? e.message : String(e),
                    whereToken.offset,
                    endOffset
                );
            }
        }

        return {
            type: 'UpdateStatement',
            target: targetNode,
            assignments,
            output,
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

        let incomplete = false;
        const errors: string[] = [];

        let refs: TableReference[] = [];

        try {
            refs = this.parseList(() =>
                this.parseTableSource(fromToken.offset)
            );

            if (refs.length > 0) {
                return refs;
            }

            // empty list case
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_FROM_EMPTY',
                'Expected table source after FROM',
                fromToken.offset,
                fromToken.offset + fromToken.value.length
            );

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_FROM',
                e instanceof Error ? e.message : String(e),
                fromToken.offset,
                fromToken.offset + fromToken.value.length
            );

            // attempt resync
            this.recoverTo([
                'WHERE',
                'GROUP',
                'HAVING',
                'ORDER',
                'OUTPUT'
            ]);
        }

        // Recovery fallback
        return [
            {
                type: 'TableReference',
                table: null,
                joins: [],
                start: fromToken.offset,
                end: fromToken.offset + fromToken.value.length,
                incomplete: true,
                errors: [
                    'Expected table source after FROM',
                    ...errors
                ]
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

        // 1. SOURCE (table or subquery)
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

                if (this.peek()?.type === TokenType.CloseParen) {
                    const closeParen = this.consume();

                    source = {
                        type: 'SubqueryExpression',
                        query: subquery,
                        start: openParen.offset,
                        end: closeParen.offset + closeParen.value.length
                    };

                    endOffset = source.end;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_TABLE_SUBQUERY_CLOSE',
                        'Expected ) after subquery',
                        openParen.offset,
                        endOffset
                    );

                    source = {
                        type: 'SubqueryExpression',
                        query: subquery,
                        start: openParen.offset,
                        end: endOffset
                    };
                }
            } else {
                const nextToken = this.peek();

                if (
                    nextToken &&
                    !this.isStructuralKeyword(nextToken.value)
                ) {
                    source = this.parseMultipartIdentifier();
                    endOffset = source.end;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_TABLE_SOURCE',
                        'Expected table source',
                        startOffset,
                        endOffset
                    );
                }
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_TABLE_SOURCE',
                e instanceof Error ? e.message : String(e),
                startOffset,
                endOffset
            );

            this.recoverTo(['JOIN', 'WHERE', 'GROUP', 'ORDER']);
        }

        // 2. ALIAS
        try {
            const aliasToken = this.peek();

            if (source && aliasToken?.value === 'AS') {
                this.consume();

                const aliasExpr = this.parseMultipartIdentifier();

                if (aliasExpr.type === 'Identifier') {
                    alias = aliasExpr.name;
                    endOffset = aliasExpr.end;
                } else {
                    throw new Error('Invalid alias');
                }
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
                const aliasExpr = this.parseMultipartIdentifier();

                if (aliasExpr.type === 'Identifier') {
                    alias = aliasExpr.name;
                    endOffset = aliasExpr.end;
                } else {
                    throw new Error('Invalid alias');
                }
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_TABLE_ALIAS',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        // 3. HINTS
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

            this.addRecoverableError(
                errors,
                'PARSE_TABLE_HINTS',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        // 4. JOINS
        const joins: JoinNode[] = [];

        try {
            while (this.isJoinToken(this.peek())) {
                try {
                    const join = this.parseJoin();
                    joins.push(join);
                    endOffset = join.end;
                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_JOIN',
                        e instanceof Error ? e.message : String(e),
                        endOffset,
                        endOffset
                    );

                    this.recoverTo(['JOIN', 'WHERE', 'GROUP', 'ORDER']);
                    break;
                }
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_JOIN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
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

            // HARD stop at semicolon
            if (token.type === TokenType.Semicolon) {
                break;
            }

            // stop at clause boundary
            if (
                token.type === TokenType.Keyword &&
                this.isStructuralKeyword(token.value)
            ) {
                break;
            }

            // Parse one hint preserving nested parens:
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

                // HARD stop at semicolon
                if (
                    depth === 0 &&
                    t.type === TokenType.Semicolon
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
                continue;
            }

            // stop cleanly if we hit semicolon
            if (this.peek()?.type === TokenType.Semicolon) {
                break;
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

                    const aliasExpr = this.parseMultipartIdentifier();

                    // Validation: JOIN aliases must be identifiers, not wildcards
                    if (aliasExpr.type === 'Identifier') {
                        alias = aliasExpr.name;
                        endOffset = aliasExpr.end;
                    } else {
                        throw new Error("Wildcards cannot be used as JOIN aliases");
                    }
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
                        const aliasExpr = this.parseMultipartIdentifier();

                        // Validation: Implicit JOIN aliases must be identifiers
                        if (aliasExpr.type === 'Identifier') {
                            alias = aliasExpr.name;
                            endOffset = aliasExpr.end;
                        } else {
                            throw new Error("Wildcards cannot be used as JOIN aliases");
                        }
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
        let output: OutputClauseNode | undefined;

        // Optional first FROM
        // DELETE FROM T ...
        if (this.peekKeyword('FROM')) {
            this.consume();
        }

        // 1. Target
        let target: Expression | null = null;
        let endOffset =
            startToken.offset + startToken.value.length;

        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value) &&
                next.type !== TokenType.Semicolon
            ) {
                target =
                    this.parseMultipartIdentifier();

                endOffset = target.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DELETE_TARGET',
                    'Expected delete target',
                    startToken.offset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_DELETE_TARGET',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );

            this.recoverTo([
                'OUTPUT',
                'FROM',
                'WHERE'
            ]);
        }

        // 2. OUTPUT
        // DELETE ... OUTPUT ...
        if (this.peekKeyword('OUTPUT')) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DELETE_OUTPUT',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );

                this.recoverTo([
                    'FROM',
                    'WHERE'
                ]);
            }
        }

        // 3. Optional second FROM
        // DELETE Alias FROM TableSource ...
        let from: TableReference[] | null = null;

        if (this.peekKeyword('FROM')) {
            const fromToken = this.consume();
            endOffset =
                fromToken.offset + fromToken.value.length;

            try {
                from = this.parseList(() =>
                    this.parseTableSource(
                        fromToken.offset
                    )
                );

                if (from.length > 0) {
                    endOffset =
                        from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_DELETE_EMPTY_FROM',
                        'Expected FROM source',
                        fromToken.offset,
                        endOffset
                    );
                }

            } catch (e) {
                from = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DELETE_FROM',
                    e instanceof Error ? e.message : String(e),
                    fromToken.offset,
                    endOffset
                );

                this.recoverTo(['WHERE']);
            }
        }

        // 4. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword('WHERE')) {
            const whereToken = this.consume();
            endOffset =
                whereToken.offset + whereToken.value.length;

            try {
                const next = this.peek();

                if (
                    next &&
                    !this.isStructuralKeyword(next.value) &&
                    next.type !== TokenType.Comma &&
                    next.type !== TokenType.Semicolon
                ) {
                    where = this.parseExpression(
                        Precedence.LOWEST
                    );

                    if (where) {
                        endOffset = where.end;
                    }

                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_DELETE_WHERE',
                        'Expected WHERE expression',
                        whereToken.offset,
                        endOffset
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DELETE_WHERE',
                    e instanceof Error ? e.message : String(e),
                    whereToken.offset,
                    endOffset
                );
            }
        }

        return {
            type: 'DeleteStatement',
            target,
            output,
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
        let endOffset =
            startToken.offset + startToken.value.length;

        let variables: VariableDeclaration[] = [];

        try {
            variables = this.parseList<VariableDeclaration>(() => {
                const declStart =
                    this.peek()?.offset ?? endOffset;

                let name = '';
                let dataType = '';
                let columns: ColumnDefinition[] | undefined;
                let initialValue: Expression | undefined;

                // 1. variable name
                try {
                    const nameToken =
                        this.match(TokenType.Variable);

                    name = nameToken.value;

                    endOffset =
                        nameToken.offset +
                        nameToken.value.length;

                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_DECLARE_NAME',
                        e instanceof Error
                            ? e.message
                            : String(e),
                        declStart,
                        endOffset
                    );
                }

                // 2. table variable
                if (this.peekKeyword('TABLE')) {
                    const tableToken = this.consume();
                    dataType = 'TABLE';

                    endOffset =
                        tableToken.offset +
                        tableToken.value.length;

                    try {
                        columns =
                            this.parseTableColumns();

                        endOffset =
                            this.lastConsumedEnd();

                    } catch (e) {
                        columns = [];
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_DECLARE_TABLE_COLUMNS',
                            e instanceof Error
                                ? e.message
                                : String(e),
                            tableToken.offset,
                            endOffset
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
                    } else {
                        // missing datatype is valid in some contexts,
                        // so do NOT force error unless name exists
                        if (name) {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                'PARSE_DECLARE_DATATYPE',
                                'Expected datatype',
                                declStart,
                                endOffset
                            );
                        }
                    }

                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_DECLARE_DATATYPE',
                        e instanceof Error
                            ? e.message
                            : String(e),
                        declStart,
                        endOffset
                    );
                }

                // 4. initializer
                if (this.peek()?.value === '=') {
                    const eqToken = this.consume();

                    endOffset =
                        eqToken.offset + eqToken.value.length;

                    try {
                        const next = this.peek();

                        if (
                            next &&
                            next.type !== TokenType.Comma &&
                            next.type !== TokenType.Semicolon &&
                            !this.isStructuralKeyword(next.value)
                        ) {
                            initialValue =
                                this.parseExpression();

                            if (initialValue) {
                                endOffset =
                                    initialValue.end;
                            }
                        } else {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                'PARSE_DECLARE_INITIALIZER',
                                'Expected expression',
                                eqToken.offset,
                                endOffset
                            );
                        }

                    } catch (e) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_DECLARE_INITIALIZER',
                            e instanceof Error
                                ? e.message
                                : String(e),
                            eqToken.offset,
                            endOffset
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

                this.addRecoverableError(
                    errors,
                    'PARSE_DECLARE_EMPTY',
                    'Expected variable declaration',
                    startToken.offset,
                    endOffset
                );
            }

        } catch (e) {
            variables = [];
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_DECLARE',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
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

    private parsePrint(): PrintNode {
        const printToken = this.matchKeyword('PRINT');

        let value: Expression | null = null;
        let endOffset =
            printToken.offset + printToken.value.length;

        let incomplete = false;
        const errors: string[] = [];

        try {
            const next = this.peek();

            if (
                !next ||
                next.type === TokenType.Semicolon ||
                this.isStructuralKeyword(next.value)
            ) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_PRINT_EXPRESSION',
                    'Expected PRINT expression',
                    printToken.offset,
                    endOffset
                );
            } else {
                value = this.parseExpression();

                if (value) {
                    endOffset = value.end;
                }
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_PRINT_EXPRESSION',
                e instanceof Error ? e.message : String(e),
                printToken.offset,
                endOffset
            );
        }

        return {
            type: 'PrintStatement',
            value,
            start: printToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseSet(): SetNode {
        const startToken = this.matchKeyword('SET');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset =
            startToken.offset + startToken.value.length;

        let variable = '';
        let variableStart = endOffset;
        let variableEnd = endOffset;

        let value: Expression | null = null;

        const first = this.peek();

        // CASE 1: variable assignment
        if (first?.type === TokenType.Variable) {
            const variableToken = this.consume();

            variable = variableToken.value;
            variableStart = variableToken.offset;
            variableEnd =
                variableToken.offset + variableToken.value.length;

            endOffset = variableEnd;

            // expect =
            if (this.peek()?.value === '=') {
                const eqToken = this.consume();
                endOffset =
                    eqToken.offset + eqToken.value.length;

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

                        this.addRecoverableError(
                            errors,
                            'PARSE_SET_EXPRESSION',
                            'Expected expression',
                            eqToken.offset,
                            endOffset
                        );
                    }

                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SET_EXPRESSION',
                        e instanceof Error
                            ? e.message
                            : String(e),
                        eqToken.offset,
                        endOffset
                    );
                }

            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SET_EQUALS',
                    'Expected =',
                    variableEnd,
                    variableEnd
                );
            }
        }

        // CASE 2: session option (SET ANSI_NULLS ON, etc.)
        else {
            const parts: string[] = [];
            let firstToken: Token | null = null;
            let lastToken: Token | null = null;

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

                const consumed = this.consume();

                if (!firstToken) {
                    firstToken = consumed;
                }

                lastToken = consumed;
                parts.push(consumed.value);

                endOffset = this.lastConsumedEnd();
            }

            variable = parts.join(' ').trim();

            if (firstToken && lastToken) {
                variableStart = firstToken.offset;
                variableEnd =
                    lastToken.offset + lastToken.value.length;
            }

            if (!variable) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SET_TARGET',
                    'Expected SET target',
                    startToken.offset,
                    endOffset
                );
            }
        }

        return {
            type: 'SetStatement',
            variable,
            variableStart,
            variableEnd,
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
            const nameExpr = this.parseMultipartIdentifier();
            let name = '';

            // Validation: Table column definitions must be identifiers, not wildcards
            if (nameExpr.type === 'Identifier') {
                name = nameExpr.name;
            } else {
                throw new Error("Wildcards are not allowed as column names in table definitions");
            }

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

        let incomplete = false;
        const errors: string[] = [];
        let endOffset =
            startToken.offset + startToken.value.length;

        // 1. Object type
        let objectType: CreateNode['objectType'] = 'TABLE';

        try {
            const typeToken = this.consume();
            const rawType = typeToken.value.toUpperCase();

            const mapped =
                CREATE_OBJECT_TYPES[
                rawType as keyof typeof CREATE_OBJECT_TYPES
                ];

            if (mapped) {
                objectType = mapped;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_TYPE',
                    `Unsupported CREATE object type: ${rawType}`,
                    typeToken.offset,
                    typeToken.offset + typeToken.value.length
                );
            }

            endOffset =
                typeToken.offset + typeToken.value.length;

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_CREATE_TYPE',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );
        }

        // 2. Name
        let name = '';
        let nameExpr: Expression = {
            type: 'Identifier',
            name: '',
            parts: [],
            start: endOffset,
            end: endOffset
        } as IdentifierNode;

        try {
            nameExpr = this.parseMultipartIdentifier();

            if (nameExpr.type === 'Identifier') {
                name = nameExpr.name;
                endOffset = nameExpr.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_NAME',
                    `Wildcards are not allowed as names for ${objectType} definitions`,
                    nameExpr.start,
                    nameExpr.end
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_CREATE_NAME',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        let columns: ColumnDefinition[] | undefined;
        let parameters: ParameterDefinition[] | undefined;
        let body: Statement | Statement[] | undefined;
        let isTableType: boolean | undefined;

        // 3. TYPE
        if (objectType === 'TYPE') {
            try {
                if (this.peekKeyword('AS')) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();

                    if (this.peekKeyword('TABLE')) {
                        this.consume();
                        endOffset = this.lastConsumedEnd();

                        columns =
                            this.parseTableColumns();

                        isTableType = true;
                        endOffset =
                            this.lastConsumedEnd();
                    }
                }

            } catch (e) {
                incomplete = true;
                columns = [];

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_TYPE_BODY',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 4. TABLE
        else if (objectType === 'TABLE') {
            try {
                columns =
                    this.parseTableColumns();

                endOffset =
                    this.lastConsumedEnd();

            } catch (e) {
                incomplete = true;
                columns = [];

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_TABLE_COLUMNS',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 5. PROCEDURE / FUNCTION
        else if (
            objectType === 'PROCEDURE' ||
            objectType === 'FUNCTION'
        ) {
            // Parameters
            try {
                const hasParens =
                    this.peek()?.type ===
                    TokenType.OpenParen;

                if (hasParens) {
                    this.consume();
                    endOffset =
                        this.lastConsumedEnd();
                }

                if (
                    this.peek()?.type ===
                    TokenType.Variable
                ) {
                    parameters =
                        this.parseList<ParameterDefinition>(
                            () => {
                                const paramToken =
                                    this.peek()!;

                                const pName =
                                    this.consume().value;

                                const pType =
                                    this.parseDataType();

                                let isOutput = false;

                                const nextToken =
                                    this.peek();

                                if (
                                    nextToken?.type ===
                                    TokenType.Keyword &&
                                    (
                                        nextToken.value ===
                                        'OUTPUT' ||
                                        nextToken.value ===
                                        'OUT'
                                    )
                                ) {
                                    isOutput = true;
                                    this.consume();
                                }

                                return {
                                    name: pName,
                                    dataType: pType,
                                    isOutput,
                                    start:
                                        paramToken.offset,
                                    end:
                                        this.lastConsumedEnd()
                                };
                            }
                        );

                    endOffset =
                        this.lastConsumedEnd();
                }

                if (hasParens) {
                    this.match(
                        TokenType.CloseParen
                    );

                    endOffset =
                        this.lastConsumedEnd();
                }

            } catch (e) {
                incomplete = true;
                parameters = [];

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_PARAMETERS',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    endOffset
                );
            }

            // AS
            if (this.peekKeyword('AS')) {
                this.consume();
                endOffset =
                    this.lastConsumedEnd();
            }

            // Body
            try {
                const statements: Statement[] =
                    [];

                const stopKeywords = ['GO'];

                while (
                    this.pos < this.tokens.length
                ) {
                    const nextToken =
                        this.peek();

                    if (
                        !nextToken ||
                        stopKeywords.includes(
                            nextToken.value
                        )
                    ) {
                        break;
                    }

                    const stmt =
                        this.parseStatement();

                    if (stmt) {
                        statements.push(stmt);
                        endOffset = stmt.end;
                    } else {
                        break;
                    }
                }

                body = statements;

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_BODY',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    endOffset
                );
            }
        }

        // 6. VIEW
        else if (objectType === 'VIEW') {
            try {
                if (this.peekKeyword('AS')) {
                    this.consume();
                    endOffset =
                        this.lastConsumedEnd();
                }

                body =
                    this.parseQueryExpression();

                endOffset = body.end;

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_VIEW',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    endOffset
                );
            }
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
            end: endOffset,
            ...(incomplete
                ? { incomplete: true }
                : {}),
            ...(errors.length
                ? { errors }
                : {})
        };
    }

    private parseColumn(): ColumnNode {
        let alias: string | undefined;
        let expression: Expression;

        let sourceName: string | undefined;
        let outputName = '';
        let wildcard = false;

        const STOP_KEYWORDS = [
            'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING',
            'UNION', 'ALL', 'EXCEPT', 'INTERSECT',
            'JOIN', 'ON', 'APPLY', 'INTO',
            'OUTER', 'VALUES', 'OUTPUT'
        ];

        const startOffset = this.peek()?.offset ?? 0;

        // 1) T-SQL assignment style:
        // Alias = Expression
        if (
            this.peek()?.type === TokenType.Identifier &&
            this.peek(1)?.value === '='
        ) {
            alias = this.consume().value;
            this.consume(); // =
            expression = this.parseExpression();
        }
        else {
            // 2) Standard style:
            // Expression [AS] Alias
            expression = this.parseExpression();

            const nextToken = this.peek();
            const nextVal = nextToken?.value;

            if (nextVal === 'AS') {
                this.consume();

                const aliasExpr = this.parseMultipartIdentifier();

                if (aliasExpr.type === 'Identifier') {
                    alias = aliasExpr.name;
                } else {
                    throw new Error(
                        'Wildcards cannot be used as column aliases'
                    );
                }
            }
            else if (
                nextToken &&
                nextToken.type !== TokenType.Semicolon &&
                nextToken.type !== TokenType.Comma &&
                (
                    nextToken.type === TokenType.Identifier ||
                    nextToken.type === TokenType.Keyword
                ) &&
                !STOP_KEYWORDS.includes(nextVal!)
            ) {
                const aliasExpr = this.parseMultipartIdentifier();

                if (aliasExpr.type === 'Identifier') {
                    alias = aliasExpr.name;
                } else {
                    throw new Error(
                        'Wildcards cannot be used as column aliases'
                    );
                }
            }
        }

        // 3) derive sourceName / wildcard
        switch (expression.type) {
            case 'Identifier':
                sourceName =
                    expression.parts.length > 0
                        ? expression.parts[expression.parts.length - 1]
                        : expression.name;
                break;

            case 'MemberExpression':
                sourceName = expression.property;
                break;

            case 'WildcardExpression':
                wildcard = true;
                sourceName = '*';
                break;
        }

        // 4) final output name
        outputName =
            alias ??
            sourceName ??
            'expression';

        // 5) end offset
        const endOffset =
            alias
                ? this.lastConsumedEnd()
                : expression.end;

        return {
            type: 'Column',
            expression,
            sourceName,
            alias,
            outputName,
            wildcard,
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
                    return {
                        type: 'WildcardExpression',
                        start,
                        end: start + 1
                    } as WildcardExpression;
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

                    // Ensure idNode is a valid identifier for a function name
                    if (idNode.type !== 'Identifier') {
                        throw new Error("Wildcards cannot be used as function names");
                    }

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
                        name: idNode.name, // Now safe to access[cite: 3]
                        args,
                        start: idNode.start,
                        end: closeParen.offset + closeParen.value.length
                    };

                    // Window Function Support[cite: 3]
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
                    } satisfies SubqueryExpression;
                } else {
                    const inner = this.parseExpression(Precedence.LOWEST);
                    const closeParen = this.match(TokenType.CloseParen);
                    return {
                        type: 'GroupingExpression',
                        expression: inner,
                        start,
                        end: closeParen.offset + closeParen.value.length
                    } satisfies GroupingExpression;
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

        const subqueryExpr: SubqueryExpression = {
            type: 'SubqueryExpression',
            query: subquery,
            start: subquery.start,
            end: closeParen.offset + closeParen.value.length
        };

        return {
            type: 'UnaryExpression',
            operator: 'EXISTS',
            right: subqueryExpr,
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

        let incomplete = false;
        const errors: string[] = [];

        let condition: Expression | null = null;
        let thenBranch: Statement | null = null;
        let elseBranch: Statement | undefined;

        let endOffset =
            startToken.offset + startToken.value.length;

        // 1. condition
        try {
            const next = this.peek();

            if (
                next &&
                next.type !== TokenType.Semicolon &&
                !this.isStructuralKeyword(next.value)
            ) {
                condition = this.parseExpression();

                if (condition) {
                    endOffset = condition.end;
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_IF_CONDITION',
                    'Expected IF condition',
                    startToken.offset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_IF_CONDITION',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );
        }

        // 2. THEN branch
        try {
            const stmt = this.parseStatement();

            if (stmt) {
                thenBranch = stmt;
                endOffset = stmt.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_IF_THEN',
                    'Expected statement after IF condition',
                    endOffset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_IF_THEN',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // 3. ELSE branch
        if (this.peekKeyword('ELSE')) {
            const elseToken = this.consume();

            try {
                const stmt = this.parseStatement();

                if (stmt) {
                    elseBranch = stmt;
                    endOffset = stmt.end;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_IF_ELSE',
                        'Expected statement after ELSE',
                        elseToken.offset,
                        elseToken.offset + elseToken.value.length
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_IF_ELSE',
                    e instanceof Error ? e.message : String(e),
                    elseToken.offset,
                    endOffset
                );
            }
        }

        return {
            type: 'IfStatement',
            condition: condition!,
            thenBranch: thenBranch!,
            elseBranch,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseBlock(): BlockNode {
        const startToken = this.matchKeyword('BEGIN');

        let incomplete = false;
        const errors: string[] = [];

        const body: Statement[] = [];
        let endOffset =
            startToken.offset + startToken.value.length;

        // 1. Body
        while (
            this.pos < this.tokens.length &&
            !this.peekKeyword('END')
        ) {
            const stmt = this.parseStatement();

            if (stmt) {
                body.push(stmt);
                endOffset = stmt.end;
            } else {
                // prevent infinite loop
                if (this.peek()?.type === TokenType.Semicolon) {
                    this.consume();
                } else {
                    break;
                }
            }
        }

        // 2. END
        try {
            if (this.peekKeyword('END')) {
                const endToken = this.consume();

                endOffset =
                    endToken.offset + endToken.value.length;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_BLOCK_END',
                    'Expected END for BEGIN block',
                    endOffset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_BLOCK_END',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        return {
            type: 'BlockStatement',
            body,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseWith(): WithNode {
        // Capture the 'WITH' token that was just peeked/consumed
        const startToken = this.matchKeyword('WITH');
        const ctes: CTENode[] = [];

        while (true) {
            // Use the multipart identifier for the CTE name
            const nameExpr = this.parseMultipartIdentifier();
            let columns: string[] | undefined = undefined;

            // Validation: CTE names must be identifiers, not wildcards
            if (nameExpr.type !== 'Identifier') {
                throw new Error("Wildcards are not allowed as CTE names");
            }

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
                name: nameExpr.name, // Safe to access after type check
                columns,
                query,
                start: nameExpr.start,
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
        const left = this.parseSelect();
        const tree = this.parseSetOperation(left);
        return this.normalizeSetTree(tree);
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

    private parseOutputClause(): OutputClauseNode {
        const startToken = this.matchKeyword('OUTPUT');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset =
            startToken.offset + startToken.value.length;

        // 1. Columns
        let columns: OutputColumnNode[] = [];

        try {
            columns = this.parseList(() => {
                const start =
                    this.peek()?.offset ?? startToken.offset;

                let sourceTable: 'INSERTED' | 'DELETED' | null = null;
                let sourceLocation: NodeLocation | undefined;

                const value = this.peek()?.value?.toUpperCase();

                // INSERTED / DELETED
                if (value === 'INSERTED' || value === 'DELETED') {
                    const token = this.consume();

                    sourceTable = value as 'INSERTED' | 'DELETED';

                    sourceLocation = {
                        start: token.offset,
                        end: token.offset + token.value.length
                    };

                    if (this.peek()?.type === TokenType.Dot) {
                        this.consume();
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_OUTPUT_DOT',
                            'Expected . after ' + value,
                            token.offset,
                            token.offset + token.value.length
                        );
                    }
                }

                let column: ColumnNode;

                try {
                    column = this.parseColumn();
                    endOffset = column.end;

                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_OUTPUT_COLUMN',
                        e instanceof Error ? e.message : String(e),
                        start,
                        endOffset
                    );

                    // fallback dummy column
                    column = {
                        type: 'Column',
                        expression: {
                            type: 'Identifier',
                            name: '',
                            parts: [],
                            start,
                            end: start
                        },
                        sourceName: '',
                        outputName: '',
                        start,
                        end: start
                    } as ColumnNode;
                }

                return {
                    type: 'OutputColumn',
                    sourceTable,
                    sourceLocation,
                    column,
                    start,
                    end: column.end
                } as OutputColumnNode;
            });

            if (columns.length === 0) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_OUTPUT_EMPTY',
                    'Expected OUTPUT column list',
                    startToken.offset,
                    endOffset
                );
            }

        } catch (e) {
            columns = [];
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_OUTPUT',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );

            this.recoverTo(['INTO', 'VALUES', 'SELECT', 'FROM', 'WHERE']);
        }

        // 2. INTO
        let intoTable: Expression | undefined;
        let intoColumns: string[] | undefined;

        if (this.peekKeyword('INTO')) {
            const intoToken = this.consume();
            endOffset =
                intoToken.offset + intoToken.value.length;

            try {
                const next = this.peek();

                if (
                    next &&
                    next.type !== TokenType.Semicolon &&
                    !this.isStructuralKeyword(next.value)
                ) {
                    intoTable = this.parseMultipartIdentifier();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_OUTPUT_INTO_TARGET',
                        'Expected INTO target table',
                        intoToken.offset,
                        endOffset
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_OUTPUT_INTO_TARGET',
                    e instanceof Error ? e.message : String(e),
                    intoToken.offset,
                    endOffset
                );
            }

            // INTO column list
            if (this.peek()?.type === TokenType.OpenParen) {
                const open = this.consume();
                endOffset =
                    open.offset + open.value.length;

                try {
                    if (this.peek()?.type !== TokenType.CloseParen) {
                        intoColumns = this.parseList(() =>
                            this.match(TokenType.Identifier).value
                        );
                    } else {
                        intoColumns = [];
                    }

                    if (this.peek()?.type === TokenType.CloseParen) {
                        const close = this.consume();
                        endOffset =
                            close.offset + close.value.length;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_OUTPUT_INTO_COLUMNS',
                            'Expected ) after INTO column list',
                            endOffset,
                            endOffset
                        );
                    }

                } catch (e) {
                    intoColumns = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_OUTPUT_INTO_COLUMNS',
                        e instanceof Error ? e.message : String(e),
                        open.offset,
                        endOffset
                    );
                }
            }
        }

        return {
            type: 'OutputClause',
            columns,
            intoTable,
            intoColumns,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private recoverTo(values: string[]) {
        while (this.peek()) {
            const token = this.peek();

            if (values.includes(token.value)) {
                return;
            }

            this.consume();
        }
    }

    private addIssue(
        code: string,
        message: string,
        start: number,
        end: number
    ): void {
        this.issues.push({
            code,
            message,
            start,
            end
        });
    }

    private stringifyExpression(expr: Expression | null): string {
        if (!expr) {
            return '<missing>';
        }

        switch (expr.type) {
            // Add this case to handle the new WildcardExpression type
            case 'WildcardExpression': {
                if (expr.tablePrefix) {
                    // Recursively stringify the prefix (IdentifierNode)
                    return `${this.stringifyExpression(expr.tablePrefix)}.*`;
                }
                return '*';
            }

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