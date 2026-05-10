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
    MergeNode,
    MergeWhenClause,
    MergeDeleteAction,
    MergeInsertAction,
    MergeUpdateAction,
    MergeAction,
    DeclareNode,
    SetNode,
    CreateNode,
    DropNode,
    IfNode,
    BlockNode,
    WithNode,
    PrintNode,
    ErrorNode,
    RaiseErrorNode,
    ExecuteNode,
    ConstraintNode,
    WhileNode,
    CreateIndexNode,
    IndexColumnNode,
    IndexOptionNode,

    // Expressions
    Expression,
    IdentifierNode,
    GroupingExpression,
    SubqueryExpression,
    OverExpression,
    MemberExpression,
    WildcardExpression,
    WindowDefinition,
    ReturnNode,
    CastExpression,
    ForClause,

    // Table / relational
    TableReference,
    JoinNode,
    JoinType,
    ColumnNode,
    OrderByNode,
    MergeMatchType,

    // DML helpers
    UpdateAssignment,

    // DDL / metadata
    VariableDeclaration,
    ColumnDefinition,
    ParameterDefinition,
    CTENode,

    // OUTPUT clause
    OutputClauseNode,
    OutputColumnNode,

    ExecArgument,

    ContinueNode,
    BreakNode,
    TryCatchNode,
    ThrowNode

} from '../ast/types';


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
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'CROSS',
    'JOIN',

    'WHERE',
    'GROUP',
    'ORDER',
    'HAVING',

    'UNION',
    'ALL',
    'EXCEPT',
    'INTERSECT',

    'ON',
    'APPLY',
    'OUTER',

    'WITH',
    'FOR',
    'TABLESAMPLE',
    'PIVOT',
    'UNPIVOT'
]);

const RESYNC_KEYWORDS = new Set([
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SET',
    'DECLARE', 'IF', 'BEGIN', 'CREATE', 'DROP', 'WITH', 'GO',
    'WHEN', 'THEN', 'ELSE', 'END', 'MERGE', 'PRINT', 'THROW', 'BREAK', 'CONTINUE', 'TRY', 'RAISERROR', 'RETURN', 'EXEC', 'EXECUTE', 'WHILE'
]);

const CREATE_OBJECT_TYPES: Record<string, CreateNode['objectType']> = {
    TABLE: 'TABLE', VIEW: 'VIEW', PROCEDURE: 'PROCEDURE',
    FUNCTION: 'FUNCTION', TYPE: 'TYPE', PROC: 'PROCEDURE'
};

const DROP_OBJECT_TYPES: Record<string, DropNode['objectType']> = {
    TABLE: 'TABLE', VIEW: 'VIEW', PROCEDURE: 'PROCEDURE',
    FUNCTION: 'FUNCTION', INDEX: 'INDEX', PROC: 'PROCEDURE'
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
    private inputLength = 0;

    constructor(private lexer: Lexer) {
        let t: Token;
        while ((t = lexer.nextToken()).type !== TokenType.EOF) {
            this.tokens.push(t);
        }
        this.inputLength = t.offset;
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
            start: 0,
            end: this.inputLength,
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
            // After a dot, only hard token boundaries stop us.
            // Structural keywords are NOT boundaries here — they are valid
            // name segments in dot-chain position: dbo.Order, dbo.User, dbo.Select.
            // Whether the user SHOULD bracket-escape them ([Order]) is a linter
            // concern, not a parser concern.
            if (
                !next ||
                next.type === TokenType.Semicolon ||
                next.type === TokenType.CloseParen ||
                next.type === TokenType.OpenParen
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

            // Consume the next segment unconditionally — after a dot, any token
            // (including keywords like ORDER, GROUP, USER) is a valid name part.
            const consumedNext = this.consume();
            segments.push(consumedNext);
            endOffset = consumedNext.offset + consumedNext.value.length;
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
                case 'MERGE': stmt = this.parseMerge(); break;
                case 'SET': stmt = this.parseSet(); break;
                case 'CREATE': stmt = this.parseCreate(false); break;
                case 'ALTER': stmt = this.parseCreate(true); break;;
                case 'DROP': stmt = this.parseDrop(); break;
                case 'IF': stmt = this.parseIf(); break;
                case 'BEGIN':
                    // BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH
                    if (this.peek(1)?.value === 'TRY') {
                        stmt = this.parseTryCatch();
                    } else {
                        stmt = this.parseBlock();
                    }
                    break;
                case 'WITH': stmt = this.parseWith(); break;
                case 'PRINT': stmt = this.parsePrint(); break;
                case 'RETURN': stmt = this.parseReturn(); break;
                case 'RAISERROR': stmt = this.parseRaiseError(); break;
                case 'EXEC':
                case 'EXECUTE': stmt = this.parseExecute(); break;
                case 'WHILE': stmt = this.parseWhile(); break;
                case 'TRY': stmt = this.parseTryCatch(); break;
                case 'THROW': stmt = this.parseThrow(); break;
                case 'BREAK': stmt = this.parseBreak(); break;
                case 'CONTINUE': stmt = this.parseContinue(); break;
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

        // 3.5. INTO
        let into: IdentifierNode | null = null;

        if (this.peekKeyword('INTO')) {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                into =
                    this.parseMultipartIdentifier() as IdentifierNode;
                endOffset = into.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_INTO',
                    e instanceof Error ? e.message : String(e),
                    endOffset
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

        // 9. OFFSET
        let offset: Expression | null = null;

        if (this.peekKeyword('OFFSET')) {
            const offsetToken = this.consume();
            endOffset =
                offsetToken.offset + offsetToken.value.length;

            try {
                offset = this.parseExpression();
                endOffset = offset.end;

                if (
                    this.peekKeyword('ROW') ||
                    this.peekKeyword('ROWS')
                ) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_OFFSET_ROWS',
                        'Expected ROW or ROWS after OFFSET',
                        endOffset
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_OFFSET',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 10. FETCH NEXT / FIRST
        let fetch: Expression | null = null;

        if (this.peekKeyword('FETCH')) {
            const fetchToken = this.consume();
            endOffset =
                fetchToken.offset + fetchToken.value.length;

            try {
                const fetchMode =
                    this.peek()?.value.toUpperCase();

                if (
                    fetchMode === 'NEXT' ||
                    fetchMode === 'FIRST'
                ) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_FETCH_NEXT',
                        'Expected NEXT or FIRST after FETCH',
                        endOffset
                    );
                }

                fetch = this.parseExpression();
                endOffset = fetch.end;

                if (
                    this.peekKeyword('ROW') ||
                    this.peekKeyword('ROWS')
                ) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_FETCH_ROWS',
                        'Expected ROW or ROWS after FETCH amount',
                        endOffset
                    );
                }

                if (this.peekKeyword('ONLY')) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_FETCH_ONLY',
                        'Expected ONLY after FETCH',
                        endOffset
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_FETCH',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 11. FOR JSON / FOR XML
        let forClause: ForClause | null = null;

        if (this.peekKeyword('FOR')) {
            const forToken = this.consume();
            endOffset =
                forToken.offset + forToken.value.length;

            try {
                let mode: 'JSON' | 'XML';

                if (this.peekKeyword('JSON')) {
                    this.consume();
                    mode = 'JSON';
                } else if (this.peekKeyword('XML')) {
                    this.consume();
                    mode = 'XML';
                } else {
                    throw new Error(
                        'Expected JSON or XML after FOR'
                    );
                }

                // required directive — AUTO, PATH, RAW, EXPLICIT etc.
                const next = this.peek();

                if (
                    !next ||
                    next.type === TokenType.Semicolon
                ) {
                    throw new Error(
                        'Expected FOR directive'
                    );
                }

                const directive = this.consume().value;

                // PATH('element') or RAW('name') — paren arg is separate
                // from the directive name and separate from options
                let argument: string | undefined;

                if (this.peek()?.type === TokenType.OpenParen) {
                    let arg = this.consume().value; // (

                    while (
                        this.peek() &&
                        this.peek()?.type !== TokenType.CloseParen
                    ) {
                        arg += this.consume().value;
                    }

                    if (this.peek()?.type === TokenType.CloseParen) {
                        arg += this.consume().value; // )
                    }

                    argument = arg;
                }

                // comma-separated options: ROOT('x'), INCLUDE_NULL_VALUES, TYPE etc.
                const options: string[] = [];

                while (this.peek()?.type === TokenType.Comma) {
                    this.consume(); // ,

                    let option = this.consume().value;

                    if (this.peek()?.type === TokenType.OpenParen) {
                        option += this.consume().value; // (

                        while (
                            this.peek() &&
                            this.peek()?.type !== TokenType.CloseParen
                        ) {
                            option += this.consume().value;
                        }

                        if (this.peek()?.type === TokenType.CloseParen) {
                            option += this.consume().value; // )
                        }
                    }

                    options.push(option);
                }

                forClause = {
                    mode,
                    directive,
                    ...(argument !== undefined ? { argument } : {}),
                    ...(options.length ? { options } : {})
                };

                endOffset = this.lastConsumedEnd();

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_FOR',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'SelectStatement',
            distinct,
            top,
            columns,
            into,
            from,
            where,
            groupBy,
            having,
            orderBy,
            ...(offset ? { offset } : {}),
            ...(fetch ? { fetch } : {}),
            ...(forClause ? { forClause } : {}),
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
                        columnNodes: null,
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
                    columnNodes: null,
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
                columnNodes: null,
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
        let columnNodes: IdentifierNode[] | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            const openParen = this.consume();
            endOffset = openParen.offset + openParen.value.length;

            try {
                if (this.peek()?.type !== TokenType.CloseParen) {
                    columnNodes = this.parseList(() => {
                        const node = this.parseMultipartIdentifier();
                        if (node.type === 'Identifier') return node;
                        throw new Error(
                            'Wildcards are not allowed in an INSERT column list'
                        );
                    });
                    columns = columnNodes.map(node => node.name);
                } else {
                    columns = [];
                    columnNodes = [];
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
                columnNodes = [];
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
            columnNodes,
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
                const state = {
                    incomplete,
                    endOffset
                };

                assignments = this.parseUpdateAssignments(
                    errors,
                    state
                );

                incomplete = state.incomplete;
                endOffset = state.endOffset;

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

        const refs: TableReference[] = [];

        try {
            while (this.pos < this.tokens.length) {
                // stop at next clause
                if (this.isFromBoundary(this.peek())) {
                    break;
                }

                const table =
                    this.parseTableSource(fromToken.offset);

                refs.push(table);

                // comma-separated table sources
                if (
                    this.peek()?.type === TokenType.Comma
                ) {
                    this.consume();
                    continue;
                }

                // stop if next clause begins
                if (this.isFromBoundary(this.peek())) {
                    break;
                }

                // otherwise parseTableSource()
                // should already have consumed joins / alias.
                // no more table refs.
                break;
            }

            if (refs.length > 0) {
                return refs;
            }

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

            this.recoverTo([
                'WHERE',
                'GROUP',
                'HAVING',
                'ORDER',
                'FOR',
                'OPTION',
                'OFFSET',
                'FETCH',
                'OUTPUT'
            ]);
        }

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

        // ------------------------------------------------------------
        // 1. SOURCE
        // ------------------------------------------------------------
        try {
            const next = this.peek();
            const nextNext = this.peek(1);

            if (
                next?.type === TokenType.OpenParen &&
                (
                    nextNext?.value === 'SELECT' ||
                    nextNext?.value === 'WITH'
                )
            ) {
                const openParen = this.consume();

                const query =
                    this.parseQueryExpression();

                if (
                    this.peek()?.type === TokenType.CloseParen
                ) {
                    const closeParen = this.consume();

                    source = {
                        type: 'SubqueryExpression',
                        query,
                        start: openParen.offset,
                        end:
                            closeParen.offset +
                            closeParen.value.length
                    };

                    endOffset = source.end;
                }
            }
            else {
                source =
                    this.parseMultipartIdentifier();

                endOffset = source.end;
            }

        } catch (e) {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 2. ALIAS
        // ------------------------------------------------------------
        try {
            const token = this.peek();

            if (
                source &&
                token?.value === 'AS'
            ) {
                this.consume();

                const id =
                    this.parseMultipartIdentifier();

                if (id.type === 'Identifier') {
                    alias = id.name;
                    endOffset = id.end;
                }
            }
            else if (
                source &&
                this.canStartAlias(token)
            ) {
                const id =
                    this.parseMultipartIdentifier();

                if (id.type === 'Identifier') {
                    alias = id.name;
                    endOffset = id.end;
                }
            }

        } catch {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 3. MODERN HINTS
        // ------------------------------------------------------------
        try {
            if (
                source?.type === 'Identifier' &&
                this.peekKeyword('WITH')
            ) {
                const parsed =
                    this.parseTableHints();

                if (parsed.length) {
                    hints = parsed;
                    endOffset = this.lastConsumedEnd();
                }
            }
        } catch {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 4. LEGACY HINTS
        // ------------------------------------------------------------
        try {
            if (
                source?.type === 'Identifier' &&
                alias &&
                this.peek()?.type === TokenType.OpenParen
            ) {
                const parsed =
                    this.parseTableHints();

                if (parsed.length) {
                    hints = parsed;
                    endOffset = this.lastConsumedEnd();
                }
            }
        } catch {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 5. JOINS
        // ------------------------------------------------------------
        const joins: JoinNode[] = [];

        while (this.isJoinToken(this.peek())) {
            const join = this.parseJoin();

            joins.push(join);
            endOffset = join.end;

            if (join.errors?.length) {
                incomplete = true;

                for (const err of join.errors) {
                    this.addRecoverableError(
                        errors,
                        'PARSE_JOIN',
                        err,
                        join.start,
                        join.end
                    );
                }
            }
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

        if (this.peekKeyword('WITH')) {
            this.consume();
        }

        if (this.peek()?.type !== TokenType.OpenParen) {
            return hints;
        }

        this.consume(); // (

        let current: string[] = [];
        let depth = 0;

        while (this.peek()) {
            const token = this.peek()!;

            // hard recovery boundary
            if (
                depth === 0 &&
                (
                    token.type === TokenType.Semicolon ||
                    this.isStructuralKeyword(token.value)
                )
            ) {
                break;
            }

            // nested open
            if (token.type === TokenType.OpenParen) {
                depth++;
                current.push(token.value);
                this.consume();
                continue;
            }

            // close nested / outer
            if (token.type === TokenType.CloseParen) {
                if (depth > 0) {
                    depth--;
                    current.push(token.value);
                    this.consume();
                    continue;
                }

                // outer )
                const hint = current.join('').trim();
                if (hint) {
                    hints.push(hint);
                }

                current = [];
                this.consume();
                break;
            }

            // comma separator at top level
            if (
                depth === 0 &&
                token.type === TokenType.Comma
            ) {
                const hint = current.join('').trim();

                if (hint) {
                    hints.push(hint);
                }

                current = [];
                this.consume();
                continue;
            }

            current.push(token.value);
            this.consume();
        }

        const trailing =
            current.join('').trim();

        if (trailing) {
            hints.push(trailing);
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
                        this.canStartAlias(potentialAlias)
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
                let columns:
                    ColumnDefinition[] | undefined;
                let constraints:
                    ConstraintNode[] | undefined;
                let initialValue:
                    Expression | undefined;

                // 1) variable name
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

                // 2) table variable
                if (this.peekKeyword('TABLE')) {
                    const tableToken =
                        this.consume();

                    dataType = 'TABLE';

                    endOffset =
                        tableToken.offset +
                        tableToken.value.length;

                    try {
                        const tableDef =
                            this.parseTableColumns();

                        columns =
                            tableDef.columns;

                        constraints =
                            tableDef.constraints;

                        endOffset =
                            this.lastConsumedEnd();

                    } catch (e) {
                        columns = [];
                        constraints = [];
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
                        ...(constraints?.length
                            ? { constraints }
                            : {}),
                        start: declStart,
                        end: endOffset
                    };
                }

                // 3) scalar datatype
                try {
                    const next = this.peek();

                    if (
                        next &&
                        next.type !== TokenType.Comma &&
                        next.type !== TokenType.Semicolon &&
                        next.value !== '='
                    ) {
                        dataType =
                            this.parseDataType();

                        endOffset =
                            this.lastConsumedEnd();
                    } else if (name) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_DECLARE_DATATYPE',
                            'Expected datatype',
                            declStart,
                            endOffset
                        );
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

                // 4) initializer
                if (this.peek()?.value === '=') {
                    const eqToken =
                        this.consume();

                    endOffset =
                        eqToken.offset +
                        eqToken.value.length;

                    try {
                        const next =
                            this.peek();

                        if (
                            next &&
                            next.type !== TokenType.Comma &&
                            next.type !== TokenType.Semicolon &&
                            !this.isStructuralKeyword(
                                next.value
                            )
                        ) {
                            initialValue =
                                this.parseExpression();

                            endOffset =
                                initialValue.end;
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
                    ...(initialValue
                        ? { initialValue }
                        : {}),
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
                e instanceof Error
                    ? e.message
                    : String(e),
                startToken.offset,
                endOffset
            );
        }

        return {
            type: 'DeclareStatement',
            variables,
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

    private parseUpdateAssignments(
        errors: string[],
        state: { incomplete: boolean; endOffset: number }
    ): UpdateAssignment[] {
        return this.parseList(() => {
            const assignmentStart =
                this.peek()?.offset ?? state.endOffset;

            let columnName = '';
            let columnNode: IdentifierNode | null = null;
            let value: Expression | null = null;
            let assignmentEnd = assignmentStart;

            // 1) column
            try {
                const next = this.peek();

                if (
                    !next ||
                    this.isStructuralKeyword(next.value)
                ) {
                    state.incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_UPDATE_ASSIGNMENT_COLUMN',
                        'Expected assignment column',
                        state.endOffset
                    );

                    return {
                        type: 'UpdateAssignment',
                        column: '',
                        columnNode: null,
                        start: assignmentStart,
                        end: assignmentEnd,
                        value: null
                    };
                }

                const columnExpr =
                    this.parseMultipartIdentifier();

                if (columnExpr.type === 'Identifier') {
                    columnName = columnExpr.name;
                    columnNode = columnExpr;
                    state.endOffset = columnExpr.end;
                    assignmentEnd = columnExpr.end;
                } else {
                    state.incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_UPDATE_ASSIGNMENT_TARGET',
                        'Wildcards are not allowed as update targets',
                        state.endOffset
                    );

                    return {
                        type: 'UpdateAssignment',
                        column: '',
                        columnNode: null,
                        start: assignmentStart,
                        end: assignmentEnd,
                        value: null
                    };
                }

            } catch (e) {
                state.incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_ASSIGNMENT_COLUMN',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    state.endOffset
                );

                return {
                    type: 'UpdateAssignment',
                    column: '',
                    columnNode: null,
                    start: assignmentStart,
                    end: assignmentEnd,
                    value: null
                };
            }

            // 2) equals
            if (this.peek()?.value !== '=') {
                state.incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_ASSIGNMENT_EQUALS',
                    'Expected =',
                    state.endOffset
                );

                return {
                    type: 'UpdateAssignment',
                    column: columnName,
                    columnNode,
                    start: assignmentStart,
                    end: assignmentEnd,
                    value: null
                };
            }

            const eqToken = this.consume();
            state.endOffset =
                eqToken.offset + eqToken.value.length;
            assignmentEnd = state.endOffset;

            // 3) value
            try {
                value = this.parseExpression();

                if (value) {
                    state.endOffset = value.end;
                    assignmentEnd = value.end;
                }

            } catch (e) {
                state.incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_ASSIGNMENT_VALUE',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    state.endOffset
                );
            }

            return {
                type: 'UpdateAssignment',
                column: columnName,
                columnNode,
                start: assignmentStart,
                end: assignmentEnd,
                value
            };
        });
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

        // CASE 1: Variable assignment — SET @x = expr
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

        // CASE 2: Session option — SET NOCOUNT ON, SET ANSI_NULLS ON,
        //         SET TRANSACTION ISOLATION LEVEL READ COMMITTED, etc.
        //
        // These statements end with ON or OFF, both of which are keywords.
        // ON is in STRUCTURAL_KEYWORDS (needed for JOIN alias detection) so
        // the normal structural-keyword break would fire prematurely on
        // SET NOCOUNT ON, cutting off the ON before it is consumed.
        //
        // Fix: exempt ON and OFF from the structural-keyword break so they
        // are treated as terminal session option values rather than
        // statement boundaries.
        else {
            const SESSION_OPTION_TERMINALS = new Set(['ON', 'OFF']);

            const parts: string[] = [];
            let firstToken: Token | null = null;
            let lastToken: Token | null = null;

            while (this.peek()) {
                const token = this.peek()!;

                // Hard stops — always terminate the session option
                if (
                    token.type === TokenType.Semicolon ||
                    token.type === TokenType.Comma
                ) {
                    break;
                }

                // Structural keywords terminate the option, EXCEPT for ON
                // and OFF which are valid terminal values in session options.
                // Only apply this stop after at least one token has been
                // consumed — prevents an empty variable if the first token
                // happens to be structural.
                if (
                    parts.length > 0 &&
                    token.type === TokenType.Keyword &&
                    this.isStructuralKeyword(token.value) &&
                    !SESSION_OPTION_TERMINALS.has(token.value)
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

                // ON and OFF always end a session option — stop after
                // consuming them so we don't accidentally absorb the next
                // statement's first keyword.
                if (SESSION_OPTION_TERMINALS.has(consumed.value)) {
                    break;
                }
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
    private parseTableColumns(): {
        columns: ColumnDefinition[];
        constraints: ConstraintNode[];
    } {
        this.match(TokenType.OpenParen);

        const columns: ColumnDefinition[] = [];
        const constraints: ConstraintNode[] = [];

        while (this.peek()) {
            const token = this.peek()!;

            // recovery boundary
            if (
                token.type === TokenType.Semicolon ||
                (
                    token.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(token.value)
                )
            ) {
                break;
            }

            if (token.type === TokenType.CloseParen) {
                break;
            }

            const value = token.value;

            // table-level constraint
            if (
                value === 'CONSTRAINT' ||
                value === 'PRIMARY' ||
                value === 'FOREIGN' ||
                value === 'UNIQUE' ||
                value === 'CHECK'
            ) {
                const constraint =
                    this.parseConstraint();

                constraints.push(constraint);

                if (
                    this.peek()?.type === TokenType.Comma
                ) {
                    this.consume();
                }

                continue;
            }

            // column name
            const startToken = this.peek()!;

            const nameExpr =
                this.parseMultipartIdentifier();

            if (nameExpr.type !== 'Identifier') {
                throw new Error(
                    'Wildcards are not allowed as column names in table definitions'
                );
            }

            const name = nameExpr.name;

            // datatype
            let dataType = '';
            let parenDepth = 0;

            while (this.peek()) {
                const next = this.peek()!;
                const nextVal = next.value;

                if (parenDepth === 0) {
                    if (
                        next.type === TokenType.Semicolon ||
                        (
                            next.type === TokenType.Keyword &&
                            RESYNC_KEYWORDS.has(next.value)
                        )
                    ) {
                        break;
                    }

                    if (
                        next.type === TokenType.Comma ||
                        next.type === TokenType.CloseParen
                    ) {
                        break;
                    }

                    if (
                        nextVal === 'CONSTRAINT' ||
                        nextVal === 'PRIMARY' ||
                        nextVal === 'FOREIGN' ||
                        nextVal === 'UNIQUE' ||
                        nextVal === 'CHECK' ||
                        nextVal === 'DEFAULT' ||
                        nextVal === 'NOT' ||
                        nextVal === 'NULL' ||
                        nextVal === 'REFERENCES' ||
                        nextVal === 'IDENTITY'
                    ) {
                        break;
                    }
                }

                if (
                    next.type === TokenType.OpenParen
                ) {
                    parenDepth++;
                }

                dataType += this.consume().value;

                if (
                    next.type === TokenType.CloseParen
                ) {
                    parenDepth--;
                }
            }

            // inline constraints
            const columnConstraints:
                ConstraintNode[] = [];

            while (this.peek()) {
                const next = this.peek()!;
                const nextVal = next.value;

                if (
                    next.type === TokenType.Comma ||
                    next.type === TokenType.CloseParen ||
                    next.type === TokenType.Semicolon ||
                    (
                        next.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(next.value)
                    )
                ) {
                    break;
                }

                // FIX: IDENTITY added here
                if (
                    nextVal === 'CONSTRAINT' ||
                    nextVal === 'PRIMARY' ||
                    nextVal === 'FOREIGN' ||
                    nextVal === 'UNIQUE' ||
                    nextVal === 'CHECK' ||
                    nextVal === 'DEFAULT' ||
                    nextVal === 'NOT' ||
                    nextVal === 'NULL' ||
                    nextVal === 'REFERENCES' ||
                    nextVal === 'IDENTITY'
                ) {
                    const constraint =
                        this.parseConstraint(name);

                    columnConstraints.push(
                        constraint
                    );

                    if (
                        this.peek()?.type === TokenType.Comma ||
                        this.peek()?.type === TokenType.CloseParen
                    ) {
                        break;
                    }

                    continue;
                }

                this.consume();
            }

            columns.push({
                name,
                dataType,
                ...(columnConstraints.length
                    ? {
                        constraints:
                            columnConstraints
                    }
                    : {}),
                start: startToken.offset,
                end: this.lastConsumedEnd()
            });

            if (
                this.peek()?.type === TokenType.Comma
            ) {
                this.consume();
            }
        }

        if (
            this.peek()?.type === TokenType.CloseParen
        ) {
            this.consume();
        }

        return {
            columns,
            constraints
        };
    }

    private parseCreate(orAlter: boolean = false): CreateNode {
        // For standalone ALTER: consume ALTER keyword as the start token.
        // For CREATE and CREATE OR ALTER: consume CREATE keyword.
        const startToken = orAlter
            ? this.matchKeyword('ALTER')
            : this.matchKeyword('CREATE');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset =
            startToken.offset + startToken.value.length;

        // Detect CREATE OR ALTER
        if (!orAlter && this.peekKeyword('OR')) {
            const orToken = this.consume();

            if (this.peekKeyword('ALTER')) {
                this.consume();
                orAlter = true;

                endOffset =
                    this.tokens[this.pos - 1].offset +
                    this.tokens[this.pos - 1].value.length;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_OR_ALTER',
                    'Expected ALTER after OR in CREATE OR ALTER',
                    orToken.offset,
                    orToken.offset + orToken.value.length
                );
            }
        }

        // Divert to index parser before consuming object type token
        // Handles: CREATE [UNIQUE] [CLUSTERED|NONCLUSTERED] INDEX
        if (!orAlter) {
            const t0 = this.peek()?.value?.toUpperCase();
            const t1 = this.peek(1)?.value?.toUpperCase();
            const t2 = this.peek(2)?.value?.toUpperCase();

            const isIndex =
                t0 === 'INDEX' ||
                (t0 === 'UNIQUE' && (t1 === 'INDEX' || t1 === 'CLUSTERED' || t1 === 'NONCLUSTERED')) ||
                ((t0 === 'CLUSTERED' || t0 === 'NONCLUSTERED') && t1 === 'INDEX') ||
                (t0 === 'UNIQUE' && (t1 === 'CLUSTERED' || t1 === 'NONCLUSTERED') && t2 === 'INDEX');

            if (isIndex) {
                return this.parseCreateIndex(startToken) as unknown as CreateNode;
            }
        }

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

        let nameNode: IdentifierNode = {
            type: 'Identifier',
            name: '',
            parts: [],
            start: endOffset,
            end: endOffset
        };

        try {
            const nameExpr =
                this.parseMultipartIdentifier();

            if (nameExpr.type === 'Identifier') {
                name = nameExpr.name;
                nameNode = nameExpr;
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

        // body pieces
        let columns: ColumnDefinition[] | undefined;
        let constraints: ConstraintNode[] | undefined;
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

                        const tableDef =
                            this.parseTableColumns();

                        columns = tableDef.columns;
                        constraints =
                            tableDef.constraints;

                        isTableType = true;
                        endOffset =
                            this.lastConsumedEnd();
                    }
                }

            } catch (e) {
                incomplete = true;
                columns = [];
                constraints = [];

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
                const tableDef =
                    this.parseTableColumns();

                columns = tableDef.columns;
                constraints =
                    tableDef.constraints;

                endOffset =
                    this.lastConsumedEnd();

            } catch (e) {
                incomplete = true;
                columns = [];
                constraints = [];

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
                        this.parseList<ParameterDefinition>(() => {
                            const paramToken =
                                this.peek()!;

                            const pName =
                                this.consume().value;

                            const pType =
                                this.parseDataType();

                            let defaultValue:
                                Expression | null = null;

                            let isOutput = false;
                            let isReadOnly = false;

                            // optional default
                            if (
                                this.peek()?.type ===
                                TokenType.Operator &&
                                this.peek()?.value === '='
                            ) {
                                this.consume();

                                if (this.peek()) {
                                    defaultValue =
                                        this.parseExpression();
                                }
                            }

                            // modifiers
                            while (this.peek()) {
                                const kw =
                                    this.peek()!
                                        .value
                                        .toUpperCase();

                                if (
                                    kw === 'OUTPUT' ||
                                    kw === 'OUT'
                                ) {
                                    isOutput = true;
                                    this.consume();
                                    continue;
                                }

                                if (
                                    kw === 'READONLY'
                                ) {
                                    isReadOnly = true;
                                    this.consume();
                                    continue;
                                }

                                break;
                            }

                            return {
                                name: pName,
                                dataType: pType,
                                ...(defaultValue !== null
                                    ? { defaultValue }
                                    : {}),
                                ...(isOutput
                                    ? { isOutput: true }
                                    : {}),
                                ...(isReadOnly
                                    ? { isReadOnly: true }
                                    : {}),
                                start:
                                    paramToken.offset,
                                end:
                                    this.lastConsumedEnd()
                            };
                        });

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
                const statements: Statement[] = [];
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
            orAlter,
            name,
            nameNode,
            columns,
            constraints,
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

    private parseDrop(): DropNode {
        const startToken = this.matchKeyword('DROP');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset =
            startToken.offset + startToken.value.length;

        // 1. Object type
        let objectType: DropNode['objectType'] = 'TABLE';

        try {
            const typeToken = this.consume();
            const rawType = typeToken.value.toUpperCase();

            const mapped =
                DROP_OBJECT_TYPES[
                rawType as keyof typeof DROP_OBJECT_TYPES
                ];

            if (mapped) {
                objectType = mapped;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DROP_TYPE',
                    `Unsupported DROP object type: ${rawType}`,
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
                'PARSE_DROP_TYPE',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );
        }

        // 2. Target name
        let target: IdentifierNode | null = null;

        try {
            const targetExpr = this.parseMultipartIdentifier();

            if (targetExpr.type === 'Identifier') {
                target = targetExpr;
                endOffset = targetExpr.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DROP_TARGET',
                    `Invalid target for DROP ${objectType}`,
                    targetExpr.start,
                    targetExpr.end
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_DROP_TARGET',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        return {
            type: 'DropStatement',
            objectType,
            target,
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
            'OUTER', 'VALUES', 'OUTPUT', 'FOR'
            , 'OPTION', 'FETCH', 'OFFSET', 'CROSS'
            , 'PIVOT', 'UNPIVOT', 'WHEN', 'THEN'
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
        const value = token.value; // normalized upper for keywords
        const start = token.offset;

        switch (token.type) {
            case TokenType.Number:
                return {
                    type: 'Literal',
                    value: Number(value),
                    variant: 'number',
                    start,
                    end: start + value.length
                };

            case TokenType.Variable:
                return {
                    type: 'Variable',
                    name: value,
                    start,
                    end: start + value.length
                };

            case TokenType.String: {
                const content =
                    value.startsWith("'") && value.endsWith("'")
                        ? value.substring(1, value.length - 1)
                        : value;

                return {
                    type: 'Literal',
                    value: content,
                    variant: 'string',
                    start,
                    end: start + value.length
                };
            }

            case TokenType.TempTable:
                return this.parseMultipartIdentifier();

            case TokenType.Operator:
                // wildcard
                if (value === '*') {
                    return {
                        type: 'WildcardExpression',
                        start,
                        end: start + 1
                    } as WildcardExpression;
                }

                // fold negative numeric literal
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

                    // unary minus expression
                    const right =
                        this.parseExpression(Precedence.PREFIX);

                    return {
                        type: 'UnaryExpression',
                        operator: '-',
                        right,
                        start,
                        end: right.end
                    };
                }

                // bitwise not
                if (value === '~') {
                    const right =
                        this.parseExpression(Precedence.PREFIX);

                    return {
                        type: 'UnaryExpression',
                        operator: '~',
                        right,
                        start,
                        end: right.end
                    };
                }

                throw new Error(
                    `Unexpected operator in prefix position: ${value}`
                );

            case TokenType.Identifier:
            case TokenType.Keyword:
                // NULL literal
                if (value === 'NULL') {
                    return {
                        type: 'Literal',
                        value: null,
                        variant: 'null',
                        start,
                        end: start + value.length
                    };
                }

                // CASE expression
                if (value === 'CASE') {
                    return this.parseCaseExpression();
                }

                // EXISTS
                if (value === 'EXISTS') {
                    return this.parseExists(token);
                }

                // CAST / TRY_CAST / CONVERT
                if (
                    value === 'CAST' ||
                    value === 'TRY_CAST' ||
                    value === 'CONVERT'
                ) {
                    this.pos--; // restore token for helper
                    return this.parseCastExpression();
                }

                // NOT unary prefix
                if (value === 'NOT') {
                    const right =
                        this.parseExpression(Precedence.NOT);

                    return {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right,
                        start,
                        end: right.end
                    };
                }

                // ------------------------------------
                // multipart identifiers + functions
                // ------------------------------------
                this.pos--; // parseMultipartIdentifier expects first token unconsumed
                const idNode =
                    this.parseMultipartIdentifier();

                // function call
                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume(); // (

                    const args: Expression[] = [];

                    if (idNode.type !== 'Identifier') {
                        throw new Error(
                            'Wildcards cannot be used as function names'
                        );
                    }

                    // subquery arg
                    if (this.peek()?.value === 'SELECT') {
                        const subquery =
                            this.parseSelect() as QueryStatement;

                        const closeParen =
                            this.match(TokenType.CloseParen);

                        args.push({
                            type: 'SubqueryExpression',
                            query: subquery,
                            start: subquery.start,
                            end:
                                closeParen.offset +
                                closeParen.value.length
                        });
                    } else {
                        // normal arg list
                        args.push(
                            ...this.parseList(() =>
                                this.parseExpression(
                                    Precedence.LOWEST
                                )
                            )
                        );
                    }

                    const closeParen =
                        this.match(TokenType.CloseParen);

                    let result: Expression = {
                        type: 'FunctionCall',
                        name: idNode.name,
                        args,
                        start: idNode.start,
                        end:
                            closeParen.offset +
                            closeParen.value.length
                    };

                    // window function
                    if (this.peek()?.value === 'OVER') {
                        result =
                            this.parseOverClause(result);
                    }

                    return result;
                }

                return idNode;

            case TokenType.OpenParen:
                // subquery
                if (this.peek()?.value === 'SELECT') {
                    const query =
                        this.parseSelect() as QueryStatement;

                    const closeParen =
                        this.match(TokenType.CloseParen);

                    return {
                        type: 'SubqueryExpression',
                        query,
                        start,
                        end:
                            closeParen.offset +
                            closeParen.value.length
                    } satisfies SubqueryExpression;
                }

                // grouping
                const inner =
                    this.parseExpression(
                        Precedence.LOWEST
                    );

                const closeParen =
                    this.match(TokenType.CloseParen);

                return {
                    type: 'GroupingExpression',
                    expression: inner,
                    start,
                    end:
                        closeParen.offset +
                        closeParen.value.length
                } satisfies GroupingExpression;

            default:
                throw new Error(
                    `Unexpected token at line ${token.line}: ${token.value} (${TokenType[token.type]})`
                );
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

        // empty list
        if (this.isClauseBoundary(this.peek())) {
            return list;
        }

        // first item
        list.push(parserFn());

        while (this.peek()?.type === TokenType.Comma) {
            this.consume();

            // trailing comma / boundary
            if (this.isClauseBoundary(this.peek())) {
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
        const parts: string[] = [];
        let parenDepth = 0;

        while (this.peek()) {
            const token = this.peek()!;
            const value = token.value.toUpperCase();

            // -----------------------------
            // top-level stop conditions
            // -----------------------------
            if (parenDepth === 0) {
                // separators
                if (
                    token.type === TokenType.Comma ||
                    token.type === TokenType.Semicolon ||
                    token.type === TokenType.CloseParen
                ) {
                    break;
                }

                // next variable declaration
                if (token.type === TokenType.Variable) {
                    break;
                }

                // assignment begins default value
                if (
                    token.type === TokenType.Operator &&
                    token.value === '='
                ) {
                    break;
                }

                // modifiers / clause boundaries
                if (
                    value === 'OUTPUT' ||
                    value === 'OUT' ||
                    value === 'READONLY' ||
                    value === 'AS'
                ) {
                    break;
                }
            }

            // -----------------------------
            // parentheses
            // -----------------------------
            if (token.type === TokenType.OpenParen) {
                parenDepth++;
            }

            parts.push(token.value);
            this.consume();

            if (token.type === TokenType.CloseParen) {
                parenDepth--;
            }
        }

        return parts.join('');
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
        let intoColumnNodes: IdentifierNode[] | undefined;

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
                        intoColumnNodes = this.parseList(() => {
                            const node = this.parseMultipartIdentifier();
                            if (node.type === 'Identifier') return node;
                            throw new Error(
                                'Wildcards are not allowed in an OUTPUT INTO column list'
                            );
                        });
                        intoColumns = intoColumnNodes.map(node => node.name);
                    } else {
                        intoColumns = [];
                        intoColumnNodes = [];
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
                    intoColumnNodes = [];
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
            intoColumnNodes,
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

    private isMergeBoundary(token?: Token): boolean {
        if (!token) return true;

        return (
            token.type === TokenType.Semicolon ||
            token.value === 'WHEN' ||
            token.value === 'OUTPUT' ||
            token.value === 'OPTION'
        );
    }

    private parseMerge(): MergeNode {
        const startToken = this.matchKeyword('MERGE');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset =
            startToken.offset + startToken.value.length;

        let top: string | null = null;
        let target: Expression | null = null;
        let targetAlias: string | undefined;
        let usingTable: TableReference | null = null;
        let on: Expression | null = null;
        const whenClauses: MergeWhenClause[] = [];
        let output: OutputClauseNode | undefined;

        // ------------------------------------------------------------
        // TOP(...)
        // ------------------------------------------------------------
        if (this.peekKeyword('TOP')) {
            this.consume();

            const hasParens =
                this.peek()?.type === TokenType.OpenParen;

            if (hasParens) {
                this.consume();
            }

            try {
                const topToken = this.consume();
                top = topToken.value;
                endOffset =
                    topToken.offset + topToken.value.length;
            } catch {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_MERGE_TOP',
                    'Expected TOP value',
                    endOffset
                );
            }

            if (
                hasParens &&
                this.peek()?.type === TokenType.CloseParen
            ) {
                this.consume();
                endOffset = this.lastConsumedEnd();
            }
        }

        // ------------------------------------------------------------
        // TARGET
        // MERGE dbo.Table WITH (...) AS t
        // ------------------------------------------------------------
        try {
            target = this.parseMultipartIdentifier();
            endOffset = target.end;

            // optional hints
            if (
                this.peek()?.value === 'WITH' ||
                this.peek()?.type === TokenType.OpenParen
            ) {
                this.parseTableHints();
                endOffset = this.lastConsumedEnd();
            }

            // optional AS
            if (this.peek()?.value === 'AS') {
                this.consume();
            }

            // alias
            const next = this.peek();

            if (
                next &&
                (
                    next.type === TokenType.Identifier ||
                    next.type === TokenType.Keyword
                ) &&
                next.value !== 'USING'
            ) {
                const aliasExpr =
                    this.parseMultipartIdentifier();

                if (aliasExpr.type === 'Identifier') {
                    targetAlias = aliasExpr.name;
                    endOffset = aliasExpr.end;
                }
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_MERGE_TARGET',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset
            );
        }

        // ------------------------------------------------------------
        // USING
        // ------------------------------------------------------------
        try {
            this.matchKeyword('USING');

            usingTable = this.parseTableSource();
            endOffset = usingTable.end;

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_MERGE_USING',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // ------------------------------------------------------------
        // ON
        // ------------------------------------------------------------
        try {
            this.matchKeyword('ON');

            on = this.parseExpression();

            if (on) {
                endOffset = on.end;
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_MERGE_ON',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // ------------------------------------------------------------
        // WHEN ...
        // ------------------------------------------------------------
        while (this.peekKeyword('WHEN')) {
            try {
                const clause =
                    this.parseMergeWhenClause();

                whenClauses.push(clause);
                endOffset = clause.end;

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_MERGE_WHEN',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );

                this.recoverTo([
                    'WHEN',
                    'OUTPUT',
                    ';'
                ]);
            }
        }

        // ------------------------------------------------------------
        // OUTPUT
        // ------------------------------------------------------------
        if (this.peekKeyword('OUTPUT')) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_MERGE_OUTPUT',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'MergeStatement',
            top,
            target,
            targetAlias,
            using: usingTable,
            on,
            whenClauses,
            output,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseMergeWhenClause(): MergeWhenClause {
        const whenToken = this.matchKeyword('WHEN');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset =
            whenToken.offset + whenToken.value.length;

        let condition: MergeMatchType = 'MATCHED';
        let predicate: Expression | null = null;
        let action: MergeAction;

        // ------------------------------------------------------------
        // MATCH TYPE
        // ------------------------------------------------------------
        try {
            if (this.peekKeyword('NOT')) {
                this.consume();

                this.matchKeyword('MATCHED');
                condition = 'NOT MATCHED';
                endOffset = this.lastConsumedEnd();

                if (this.peekKeyword('BY')) {
                    this.consume();

                    this.matchKeyword('SOURCE');
                    condition = 'NOT MATCHED BY SOURCE';
                    endOffset = this.lastConsumedEnd();
                }
            }
            else {
                this.matchKeyword('MATCHED');
                condition = 'MATCHED';
                endOffset = this.lastConsumedEnd();
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_MERGE_MATCH_TYPE',
                e instanceof Error ? e.message : String(e),
                whenToken.offset,
                endOffset
            );
        }

        // ------------------------------------------------------------
        // optional AND predicate
        // ------------------------------------------------------------
        if (this.peekKeyword('AND')) {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                predicate = this.parseExpression();

                if (predicate) {
                    endOffset = predicate.end;
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_MERGE_PREDICATE',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // ------------------------------------------------------------
        // THEN
        // ------------------------------------------------------------
        try {
            this.matchKeyword('THEN');
            endOffset = this.lastConsumedEnd();

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_MERGE_THEN',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // ------------------------------------------------------------
        // ACTION
        // ------------------------------------------------------------
        try {
            action = this.parseMergeAction();
            endOffset = action.end;

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_MERGE_ACTION',
                e instanceof Error ? e.message : String(e),
                endOffset
            );

            action = {
                type: 'MergeDeleteAction',
                start: endOffset,
                end: endOffset,
                incomplete: true
            } as MergeDeleteAction;
        }

        return {
            type: 'MergeWhenClause',
            condition,
            predicate,
            action,
            start: whenToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseMergeAction(): MergeAction {
        const token = this.peek();

        if (!token) {
            throw new Error('Expected MERGE action');
        }

        // ------------------------------------------------------------
        // DELETE
        // ------------------------------------------------------------
        if (this.peekKeyword('DELETE')) {
            const del = this.consume();

            const action: MergeDeleteAction = {
                type: 'MergeDeleteAction',
                start: del.offset,
                end: del.offset + del.value.length
            };

            return action;
        }

        // ------------------------------------------------------------
        // UPDATE SET ...
        // ------------------------------------------------------------
        if (this.peekKeyword('UPDATE')) {
            const updateToken = this.consume();

            let endOffset =
                updateToken.offset + updateToken.value.length;

            const errors: string[] = [];
            const state = {
                incomplete: false,
                endOffset
            };

            this.matchKeyword('SET');

            endOffset = this.lastConsumedEnd();
            state.endOffset = endOffset;

            const assignments =
                this.parseUpdateAssignments(
                    errors,
                    state
                );

            endOffset = state.endOffset;

            const action: MergeUpdateAction = {
                type: 'MergeUpdateAction',
                assignments,
                start: updateToken.offset,
                end: endOffset,
                ...(state.incomplete
                    ? { incomplete: true }
                    : {}),
                ...(errors.length
                    ? { errors }
                    : {})
            };

            return action;
        }

        // ------------------------------------------------------------
        // INSERT
        // ------------------------------------------------------------
        if (this.peekKeyword('INSERT')) {
            const insertToken = this.consume();

            let endOffset =
                insertToken.offset + insertToken.value.length;

            let columns: string[] | null = null;
            let columnNodes: IdentifierNode[] | null = null;
            let values: Expression[] | null = null;
            let selectQuery: QueryStatement | null = null;

            // optional column list
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume();

                columnNodes = this.parseList(() => {
                    const id =
                        this.parseMultipartIdentifier();

                    if (id.type !== 'Identifier') {
                        throw new Error(
                            'Invalid INSERT column'
                        );
                    }

                    return id;
                });

                columns =
                    columnNodes.map(x => x.name);

                this.match(TokenType.CloseParen);
                endOffset = this.lastConsumedEnd();
            }

            // VALUES (...)
            if (this.peekKeyword('VALUES')) {
                this.consume();

                this.match(TokenType.OpenParen);

                values = this.parseList(() =>
                    this.parseExpression()
                );

                this.match(TokenType.CloseParen);

                endOffset = this.lastConsumedEnd();
            }

            // INSERT ... SELECT ...
            else if (
                this.peekKeyword('SELECT') ||
                this.peekKeyword('WITH')
            ) {
                selectQuery =
                    this.parseQueryExpression();

                endOffset = selectQuery.end;
            }
            else {
                throw new Error(
                    'Expected VALUES or SELECT after INSERT'
                );
            }

            const action: MergeInsertAction = {
                type: 'MergeInsertAction',
                columns,
                columnNodes,
                values,
                selectQuery,
                start: insertToken.offset,
                end: endOffset
            };

            return action;
        }

        throw new Error(
            `Unsupported MERGE action: ${token.value}`
        );
    }

    private parseReturn(): ReturnNode {
        const start = this.matchKeyword('RETURN');

        let value: Expression | null = null;
        let end = start.offset + start.value.length;

        if (
            this.peek() &&
            this.peek()!.type !== TokenType.Semicolon &&
            !this.isStructuralKeyword(this.peek()!.value)
        ) {
            value = this.parseExpression();
            end = value.end;
        }

        return {
            type: 'ReturnStatement',
            value,
            start: start.offset,
            end
        };
    }

    private parseRaiseError(): RaiseErrorNode {
        const startToken = this.matchKeyword('RAISERROR');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset =
            startToken.offset + startToken.value.length;

        const args: Expression[] = [];
        let options: string[] | undefined;

        let sawCloseParen = false;

        // --------------------------------------------------
        // 1) Opening (
        // --------------------------------------------------
        if (this.peek()?.type !== TokenType.OpenParen) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_RAISERROR_OPEN',
                'Expected ( after RAISERROR',
                endOffset,
                endOffset
            );

            return {
                type: 'RaiseErrorStatement',
                args,
                start: startToken.offset,
                end: endOffset,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {})
            };
        }

        this.consume(); // (
        endOffset = this.lastConsumedEnd();

        // --------------------------------------------------
        // 2) Argument list
        // --------------------------------------------------
        try {
            while (this.peek()) {
                const token = this.peek()!;

                // end of arg list
                if (token.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                    sawCloseParen = true;
                    break;
                }

                // separator
                if (token.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                // parse arg
                const expr = this.parseExpression();
                args.push(expr);
                endOffset = expr.end;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_RAISERROR_ARGS',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );

            this.recoverTo(['WITH', ';']);
        }

        // IMPORTANT:
        // Missing ) must also be detected at EOF.
        if (!sawCloseParen) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_RAISERROR_CLOSE',
                'Expected ) after RAISERROR arguments',
                endOffset,
                endOffset
            );
        }

        // --------------------------------------------------
        // 3) WITH options
        // --------------------------------------------------
        if (this.peekKeyword('WITH')) {
            this.consume();
            endOffset = this.lastConsumedEnd();

            options = [];

            while (this.peek()) {
                const token = this.peek()!;

                if (token.type === TokenType.Semicolon) {
                    break;
                }

                if (token.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                if (
                    token.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(token.value)
                ) {
                    break;
                }

                options.push(token.value);
                this.consume();
                endOffset = this.lastConsumedEnd();
            }

            if (options.length === 0) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_RAISERROR_WITH',
                    'Expected RAISERROR WITH option',
                    endOffset,
                    endOffset
                );
            }
        }

        return {
            type: 'RaiseErrorStatement',
            args,
            ...(options?.length ? { options } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseExecute(): ExecuteNode {
        const startToken =
            this.peekKeyword('EXECUTE')
                ? this.matchKeyword('EXECUTE')
                : this.matchKeyword('EXEC');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset =
            startToken.offset + startToken.value.length;

        let target: Expression | null = null;
        const args: ExecArgument[] = [];

        try {
            // --------------------------------------------------
            // 1) target
            // --------------------------------------------------
            if (!this.peek()) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_EXEC_TARGET',
                    'Expected EXEC target',
                    endOffset,
                    endOffset
                );
            } else if (this.peek()!.type === TokenType.OpenParen) {
                // EXEC(@sql)
                this.consume(); // (
                endOffset = this.lastConsumedEnd();

                if (!this.peek()) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_EXEC_EXPR',
                        'Expected expression inside EXEC(...)',
                        endOffset,
                        endOffset
                    );
                } else {
                    target = this.parseExpression();
                    endOffset = target.end;
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_EXEC_CLOSE',
                        'Expected ) after EXEC expression',
                        endOffset,
                        endOffset
                    );
                }
            } else {
                // EXEC dbo.proc
                // EXEC @proc
                // EXEC sp_executesql
                target = this.parseExpression();
                endOffset = target.end;
            }

            // --------------------------------------------------
            // 2) args
            // --------------------------------------------------
            while (this.peek()) {
                const token = this.peek()!;

                // separators / boundaries
                if (token.type === TokenType.Semicolon) {
                    break;
                }

                if (
                    token.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(token.value)
                ) {
                    break;
                }

                if (token.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                // named argument:
                // EXEC proc @Id = 1
                if (this.isExecNamedArg()) {
                    const name = this.consume().value; // variable
                    this.consume(); // =

                    let value: Expression | null = null;

                    if (this.peek()) {
                        value = this.parseExpression();
                        endOffset = value.end;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_EXEC_ARG',
                            `Expected value for ${name}`,
                            endOffset,
                            endOffset
                        );
                    }

                    args.push({
                        name,
                        value
                    });

                    continue;
                }

                // positional:
                // EXEC proc 1, 'abc'
                const value = this.parseExpression();

                args.push({
                    value
                });

                endOffset = value.end;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_EXEC',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );

            this.recoverTo([';']);
        }

        return {
            type: 'ExecuteStatement',
            target,
            args,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private isExecNamedArg(): boolean {
        const current = this.peek();
        const next = this.peek(1);

        if (!current || !next) {
            return false;
        }

        return (
            current.type === TokenType.Variable &&
            next.type === TokenType.Operator &&
            next.value === '='
        );
    }

    private parseCastExpression(): CastExpression {
        const keyword = this.consume();

        const kind =
            keyword.value as
            | 'CAST'
            | 'TRY_CAST'
            | 'CONVERT';

        let incomplete = false;
        const errors: string[] = [];

        const start = keyword.offset;
        let end =
            keyword.offset + keyword.value.length;

        // fallback defaults
        let expression: Expression = {
            type: 'Literal',
            value: null,
            variant: 'null',
            start,
            end
        };

        let dataType = '';

        // --------------------------------
        // opening (
        // --------------------------------
        if (this.peek()?.type !== TokenType.OpenParen) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_CAST_OPEN',
                `Expected ( after ${kind}`,
                end,
                end
            );

            return {
                type: 'CastExpression',
                kind,
                expression,
                dataType,
                start,
                end,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {})
            };
        }

        this.consume(); // (
        end = this.lastConsumedEnd();

        try {
            // --------------------------------
            // CONVERT(type, expr)
            // --------------------------------
            if (kind === 'CONVERT') {
                dataType = this.parseDataTypeName();
                end = this.lastConsumedEnd();

                if (this.peek()?.type !== TokenType.Comma) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_CONVERT_COMMA',
                        'Expected comma in CONVERT',
                        end,
                        end
                    );
                } else {
                    this.consume(); // ,
                    end = this.lastConsumedEnd();

                    if (this.peek()) {
                        expression =
                            this.parseExpression();
                        end = expression.end;
                    }
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    end = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_CAST_CLOSE',
                        `Expected ) after ${kind}`,
                        end,
                        end
                    );
                }

                return {
                    type: 'CastExpression',
                    kind,
                    expression,
                    dataType,
                    start,
                    end,
                    ...(incomplete ? { incomplete: true } : {}),
                    ...(errors.length ? { errors } : {})
                };
            }

            // --------------------------------
            // CAST(expr AS type)
            // TRY_CAST(expr AS type)
            // --------------------------------
            if (this.peek()) {
                expression =
                    this.parseExpression();
                end = expression.end;
            }

            if (!this.peekKeyword('AS')) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CAST_AS',
                    `Expected AS in ${kind}`,
                    end,
                    end
                );
            } else {
                this.consume(); // AS
                end = this.lastConsumedEnd();

                dataType =
                    this.parseDataTypeName();
                end = this.lastConsumedEnd();
            }

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                end = this.lastConsumedEnd();
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_CAST_CLOSE',
                    `Expected ) after ${kind}`,
                    end,
                    end
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_CAST',
                e instanceof Error
                    ? e.message
                    : String(e),
                end,
                end
            );
        }

        return {
            type: 'CastExpression',
            kind,
            expression,
            dataType,
            start,
            end,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDataTypeName(): string {
        const parts: string[] = [];
        let parenDepth = 0;

        while (this.peek()) {
            const token = this.peek()!;

            if (
                parenDepth === 0 &&
                (
                    token.type === TokenType.Comma ||
                    token.type === TokenType.CloseParen
                )
            ) {
                break;
            }

            if (
                parenDepth === 0 &&
                token.type === TokenType.Keyword &&
                token.value === 'AS'
            ) {
                break;
            }

            if (token.type === TokenType.OpenParen) {
                parenDepth++;
            }

            if (token.type === TokenType.CloseParen) {
                parenDepth--;
            }

            parts.push(token.value);
            this.consume();
        }

        return parts.join('');
    }

    private parseIdentifierListSafe(): string[] {
        const result: string[] = [];

        while (this.peek()) {
            const token = this.peek()!;

            const isResync =
                token.type === TokenType.Keyword &&
                RESYNC_KEYWORDS.has(token.value);

            if (
                token.type === TokenType.CloseParen ||
                token.type === TokenType.Semicolon ||
                isResync
            ) {
                break;
            }

            if (token.type === TokenType.Comma) {
                this.consume();
                continue;
            }

            const id =
                this.parseMultipartIdentifier();

            if (id.type !== 'Identifier') {
                break;
            }

            result.push(id.name);
        }

        return result;
    }

    private parseConstraint(
        implicitColumn?: string
    ): ConstraintNode {
        const start =
            this.peek()?.offset ??
            this.lastConsumedEnd();

        let incomplete = false;
        const errors: string[] = [];

        let name: string | undefined;

        let kind:
            | 'PRIMARY KEY'
            | 'FOREIGN KEY'
            | 'UNIQUE'
            | 'CHECK'
            | 'DEFAULT'
            | 'NOT NULL'
            | 'NULL'
            | 'IDENTITY' = 'NULL';

        let columns: string[] | undefined;
        let expression: Expression | null | undefined;
        let referencesTable: string | undefined;
        let referencesColumns: string[] | undefined;

        const fail = (
            code: string,
            message: string
        ) => {
            incomplete = true;

            this.addRecoverableError(
                errors,
                code,
                message,
                this.lastConsumedEnd()
            );
        };

        try {
            // optional CONSTRAINT name
            if (this.peek()?.value === 'CONSTRAINT') {
                this.consume();

                if (this.peek()) {
                    name = this.consume().value;
                } else {
                    fail(
                        'PARSE_CONSTRAINT_NAME',
                        'Expected constraint name'
                    );
                }
            }

            const token = this.peek();
            const value = token?.value;

            if (!token) {
                fail(
                    'PARSE_CONSTRAINT_KIND',
                    'Expected constraint type'
                );
            }

            // PRIMARY KEY
            else if (
                value === 'PRIMARY' &&
                this.peek(1)?.value === 'KEY'
            ) {
                this.consume();
                this.consume();

                kind = 'PRIMARY KEY';

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    this.consume();

                    columns =
                        this.parseIdentifierListSafe();

                    if (
                        this.peek()?.type ===
                        TokenType.CloseParen
                    ) {
                        this.consume();
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_PK_CLOSE',
                            'Expected ) after PRIMARY KEY columns'
                        );
                    }
                }
            }

            // FOREIGN KEY
            else if (
                value === 'FOREIGN' &&
                this.peek(1)?.value === 'KEY'
            ) {
                this.consume();
                this.consume();

                kind = 'FOREIGN KEY';

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    this.consume();

                    columns =
                        this.parseIdentifierListSafe();

                    if (
                        this.peek()?.type ===
                        TokenType.CloseParen
                    ) {
                        this.consume();
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_FK_CLOSE',
                            'Expected ) after FOREIGN KEY columns'
                        );
                    }
                }

                if (this.peek()?.value === 'REFERENCES') {
                    this.consume();

                    const next = this.peek();

                    const validTarget =
                        next &&
                        next.type !==
                        TokenType.CloseParen &&
                        next.type !==
                        TokenType.Comma &&
                        next.type !==
                        TokenType.Semicolon &&
                        !(
                            next.type ===
                            TokenType.Keyword &&
                            RESYNC_KEYWORDS.has(
                                next.value
                            )
                        );

                    if (validTarget) {
                        const ref =
                            this.parseMultipartIdentifier();

                        if (
                            ref.type === 'Identifier'
                        ) {
                            referencesTable =
                                ref.name;
                        } else {
                            fail(
                                'PARSE_CONSTRAINT_REFERENCES_TABLE',
                                'Expected referenced table name'
                            );
                        }
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_REFERENCES_TABLE',
                            'Expected referenced table name'
                        );
                    }

                    if (
                        this.peek()?.type ===
                        TokenType.OpenParen
                    ) {
                        this.consume();

                        referencesColumns =
                            this.parseIdentifierListSafe();

                        if (
                            this.peek()?.type ===
                            TokenType.CloseParen
                        ) {
                            this.consume();
                        } else {
                            fail(
                                'PARSE_CONSTRAINT_REFERENCES_CLOSE',
                                'Expected ) after REFERENCES columns'
                            );
                        }
                    }
                } else {
                    fail(
                        'PARSE_CONSTRAINT_REFERENCES',
                        'Expected REFERENCES clause'
                    );
                }
            }

            // UNIQUE
            else if (value === 'UNIQUE') {
                this.consume();

                kind = 'UNIQUE';

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    this.consume();

                    columns =
                        this.parseIdentifierListSafe();

                    if (
                        this.peek()?.type ===
                        TokenType.CloseParen
                    ) {
                        this.consume();
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_UNIQUE_CLOSE',
                            'Expected ) after UNIQUE columns'
                        );
                    }
                }
            }

            // CHECK
            else if (value === 'CHECK') {
                this.consume();

                kind = 'CHECK';

                if (
                    this.peek()?.type !==
                    TokenType.OpenParen
                ) {
                    fail(
                        'PARSE_CONSTRAINT_CHECK',
                        'Expected ( after CHECK'
                    );
                } else {
                    this.consume();

                    const next = this.peek();

                    if (
                        next &&
                        next.type !==
                        TokenType.CloseParen &&
                        next.type !==
                        TokenType.Semicolon
                    ) {
                        try {
                            expression =
                                this.parseExpression();
                        } catch {
                            fail(
                                'PARSE_CONSTRAINT_CHECK_EXPR',
                                'Invalid CHECK expression'
                            );
                        }
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_CHECK_EXPR',
                            'Expected CHECK expression'
                        );
                    }

                    if (
                        this.peek()?.type ===
                        TokenType.CloseParen
                    ) {
                        this.consume();
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_CHECK_CLOSE',
                            'Expected ) after CHECK expression'
                        );
                    }
                }
            }

            // DEFAULT
            else if (value === 'DEFAULT') {
                this.consume();

                kind = 'DEFAULT';

                const next = this.peek();

                if (
                    next &&
                    next.type !==
                    TokenType.Comma &&
                    next.type !==
                    TokenType.CloseParen &&
                    next.type !==
                    TokenType.Semicolon
                ) {
                    try {
                        expression =
                            this.parseExpression();
                    } catch {
                        fail(
                            'PARSE_CONSTRAINT_DEFAULT_EXPR',
                            'Invalid DEFAULT expression'
                        );
                    }
                } else {
                    fail(
                        'PARSE_CONSTRAINT_DEFAULT',
                        'Expected DEFAULT expression'
                    );
                }
            }

            // NOT NULL
            else if (
                value === 'NOT' &&
                this.peek(1)?.value === 'NULL'
            ) {
                this.consume();
                this.consume();

                kind = 'NOT NULL';

                if (implicitColumn) {
                    columns = [implicitColumn];
                }
            }

            // NULL
            else if (value === 'NULL') {
                this.consume();

                kind = 'NULL';

                if (implicitColumn) {
                    columns = [implicitColumn];
                }
            }

            else if (value === 'IDENTITY') {
                this.consume();

                kind = 'IDENTITY';

                if (implicitColumn) {
                    columns = [implicitColumn];
                }

                let seed: number | undefined;
                let increment: number | undefined;

                if (
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    this.consume();

                    if (
                        this.peek()?.type === TokenType.Number
                    ) {
                        seed = Number(
                            this.consume().value
                        );
                    }

                    if (
                        this.peek()?.type === TokenType.Comma
                    ) {
                        this.consume();

                        if (
                            this.peek()?.type === TokenType.Number
                        ) {
                            increment = Number(
                                this.consume().value
                            );
                        }
                    }

                    if (
                        this.peek()?.type ===
                        TokenType.CloseParen
                    ) {
                        this.consume();
                    } else {
                        fail(
                            'PARSE_CONSTRAINT_IDENTITY_CLOSE',
                            'Expected ) after IDENTITY'
                        );
                    }
                }

                return {
                    name,
                    kind,
                    ...(columns?.length
                        ? { columns }
                        : {}),
                    ...(seed !== undefined
                        ? { seed }
                        : {}),
                    ...(increment !== undefined
                        ? { increment }
                        : {}),
                    start,
                    end: this.lastConsumedEnd(),
                    ...(incomplete
                        ? { incomplete: true }
                        : {}),
                    ...(errors.length
                        ? { errors }
                        : {})
                };
            }

            // unknown
            else {
                fail(
                    'PARSE_CONSTRAINT_UNKNOWN',
                    `Unknown constraint: ${value}`
                );

                this.consume();
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_CONSTRAINT',
                e instanceof Error
                    ? e.message
                    : String(e),
                this.lastConsumedEnd()
            );
        }

        return {
            name,
            kind,
            ...(columns?.length
                ? { columns }
                : {}),
            ...(expression !== undefined
                ? { expression }
                : {}),
            ...(referencesTable
                ? { referencesTable }
                : {}),
            ...(referencesColumns?.length
                ? { referencesColumns }
                : {}),
            start,
            end: this.lastConsumedEnd(),
            ...(incomplete
                ? { incomplete: true }
                : {}),
            ...(errors.length
                ? { errors }
                : {})
        };
    }

    private parseWhile(): WhileNode {
        const startToken =
            this.matchKeyword('WHILE');

        let incomplete = false;
        const errors: string[] = [];

        let endOffset =
            startToken.offset +
            startToken.value.length;

        let condition: Expression | null = null;
        let body: Statement | null = null;

        // -----------------------------
        // condition
        // -----------------------------
        try {
            const next = this.peek();

            if (
                next &&
                next.type !== TokenType.Semicolon &&
                !(
                    next.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(next.value)
                )
            ) {
                condition =
                    this.parseExpression();

                endOffset =
                    condition.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_WHILE_CONDITION',
                    'Expected WHILE condition',
                    endOffset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_WHILE_CONDITION',
                e instanceof Error
                    ? e.message
                    : String(e),
                endOffset,
                endOffset
            );
        }

        // -----------------------------
        // body statement
        // -----------------------------
        try {
            const next = this.peek();

            if (
                next &&
                next.type !== TokenType.Semicolon
            ) {
                body =
                    this.parseStatement();

                if (body) {
                    endOffset = body.end;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_WHILE_BODY',
                        'Expected WHILE body statement',
                        endOffset,
                        endOffset
                    );
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_WHILE_BODY',
                    'Expected WHILE body statement',
                    endOffset,
                    endOffset
                );
            }

        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_WHILE_BODY',
                e instanceof Error
                    ? e.message
                    : String(e),
                endOffset,
                endOffset
            );

            this.recoverTo([';']);
        }

        return {
            type: 'WhileStatement',
            condition,
            body,
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

    private parseCreateIndex(startToken: Token): CreateIndexNode {
        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        // 1. UNIQUE (optional)
        // UNIQUE is a Keyword token — use value comparison for consistency
        let unique = false;
        if (this.peek()?.value === 'UNIQUE') {
            this.consume();
            unique = true;
            endOffset = this.lastConsumedEnd();
        }

        // 2. CLUSTERED / NONCLUSTERED (optional)
        // Not in the lexer keyword set — tokenize as Identifier, must use value check
        let clustered: CreateIndexNode['clustered'] = null;
        if (this.peek()?.value === 'CLUSTERED') {
            this.consume();
            clustered = 'CLUSTERED';
            endOffset = this.lastConsumedEnd();
        } else if (this.peek()?.value === 'NONCLUSTERED') {
            this.consume();
            clustered = 'NONCLUSTERED';
            endOffset = this.lastConsumedEnd();
        }

        // 3. INDEX keyword
        // INDEX is a Keyword token — value check consistent with above
        if (this.peek()?.value === 'INDEX') {
            this.consume();
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CREATE_INDEX_KEYWORD',
                'Expected INDEX keyword',
                endOffset
            );
        }

        // 4. Index name
        let name = '';
        let nameNode: IdentifierNode = {
            type: 'Identifier', name: '', parts: [],
            start: endOffset, end: endOffset
        };

        try {
            const nameExpr = this.parseMultipartIdentifier();
            if (nameExpr.type === 'Identifier') {
                name = nameExpr.name;
                nameNode = nameExpr;
                endOffset = nameExpr.end;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_INDEX_NAME',
                    'Wildcards are not allowed as index names',
                    nameExpr.start, nameExpr.end
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CREATE_INDEX_NAME',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // 5. ON table
        let table: IdentifierNode = {
            type: 'Identifier', name: '', parts: [],
            start: endOffset, end: endOffset
        };

        try {
            this.matchKeyword('ON');
            endOffset = this.lastConsumedEnd();

            const tableExpr = this.parseMultipartIdentifier();
            if (tableExpr.type === 'Identifier') {
                table = tableExpr;
                endOffset = tableExpr.end;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_INDEX_TABLE',
                    'Expected table name after ON',
                    tableExpr.start, tableExpr.end
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CREATE_INDEX_ON',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // 6. Key columns: (col1 ASC, col2 DESC)
        // ASC/DESC are Keyword tokens but must NOT be treated as structural
        // boundaries — use value comparison so parseList() doesn't stop on them
        let columns: IndexColumnNode[] = [];

        try {
            this.match(TokenType.OpenParen);
            endOffset = this.lastConsumedEnd();

            columns = this.parseList<IndexColumnNode>(() => {
                const colStart = this.peek()?.offset ?? endOffset;

                const colExpr = this.parseMultipartIdentifier();
                if (colExpr.type !== 'Identifier') {
                    throw new Error('Expected column name in index key');
                }

                // Value comparison — avoids structural keyword stop
                let direction: 'ASC' | 'DESC' = 'ASC';
                if (this.peek()?.value === 'DESC') {
                    this.consume();
                    direction = 'DESC';
                } else if (this.peek()?.value === 'ASC') {
                    this.consume();
                }

                return {
                    type: 'IndexColumn',
                    name: colExpr.name,
                    nameNode: colExpr,
                    direction,
                    start: colStart,
                    end: this.lastConsumedEnd()
                };
            });

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                endOffset = this.lastConsumedEnd();
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_INDEX_COLUMNS_CLOSE',
                    'Expected ) after index columns',
                    endOffset
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CREATE_INDEX_COLUMNS',
                e instanceof Error ? e.message : String(e),
                endOffset
            );
        }

        // 7. INCLUDE (col1, col2) — optional
        // INCLUDE is not a keyword — comes through as Identifier token
        let include: IdentifierNode[] | undefined;

        if (this.peek()?.value?.toUpperCase() === 'INCLUDE') {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                this.match(TokenType.OpenParen);
                endOffset = this.lastConsumedEnd();

                include = this.parseList<IdentifierNode>(() => {
                    const colExpr = this.parseMultipartIdentifier();
                    if (colExpr.type !== 'Identifier') {
                        throw new Error(
                            'Expected column name in INCLUDE list'
                        );
                    }
                    return colExpr;
                });

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_CREATE_INDEX_INCLUDE_CLOSE',
                        'Expected ) after INCLUDE columns',
                        endOffset
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_INDEX_INCLUDE',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 8. WHERE — filtered index (optional)
        // WHERE is a Keyword token and IS in STRUCTURAL_KEYWORDS, but
        // peekKeyword() here is a direct next-token check so it still works.
        // Using value comparison anyway for consistency with this method.
        let where: Expression | undefined;

        if (this.peek()?.value === 'WHERE') {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                where = this.parseExpression();
                endOffset = where.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_INDEX_WHERE',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        // 9. WITH (option = value, ...) — optional
        // WITH is a Keyword token. Check next token is '(' to distinguish
        // from WITH used as a CTE introducer (not valid here, but defensive).
        let options: IndexOptionNode[] | undefined;

        if (
            this.peek()?.value === 'WITH' &&
            this.peek(1)?.type === TokenType.OpenParen
        ) {
            this.consume(); // WITH
            this.consume(); // (
            endOffset = this.lastConsumedEnd();

            try {
                options = this.parseList<IndexOptionNode>(() => {
                    const optStart =
                        this.peek()?.offset ?? endOffset;

                    // option name — ONLINE, FILLFACTOR, PAD_INDEX, etc.
                    const nameToken = this.consume();
                    const optName = nameToken.value.toUpperCase();

                    // =
                    if (this.peek()?.value !== '=') {
                        throw new Error(
                            `Expected = after index option ${optName}`
                        );
                    }
                    this.consume();

                    // value — ON / OFF / number / identifier
                    const valToken = this.consume();
                    const optValue = valToken.value.toUpperCase();

                    return {
                        type: 'IndexOption',
                        name: optName,
                        value: optValue,
                        start: optStart,
                        end: this.lastConsumedEnd()
                    };
                });

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_CREATE_INDEX_OPTIONS_CLOSE',
                        'Expected ) after index options',
                        endOffset
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CREATE_INDEX_OPTIONS',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'CreateIndexStatement',
            unique,
            clustered,
            name,
            nameNode,
            table,
            columns,
            ...(include !== undefined ? { include } : {}),
            ...(where !== undefined ? { where } : {}),
            ...(options !== undefined ? { options } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseTryCatch(): TryCatchNode {
        // BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH
        const startToken = this.matchKeyword('BEGIN');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        // 1. TRY keyword after BEGIN
        try {
            this.matchKeyword('TRY');
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_TRY_KEYWORD',
                'Expected TRY after BEGIN',
                endOffset
            );
        }

        // 2. TRY block body — statements until END TRY
        const tryBody: Statement[] = [];

        while (
            this.pos < this.tokens.length &&
            !(this.peek()?.value === 'END' && this.peek(1)?.value === 'TRY')
        ) {
            const stmt = this.parseStatement();
            if (stmt) {
                tryBody.push(stmt);
                endOffset = stmt.end;
            } else if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
            } else {
                break;
            }
        }

        // 3. END TRY
        try {
            this.matchKeyword('END');
            this.matchKeyword('TRY');
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_TRY_END',
                'Expected END TRY',
                endOffset
            );
        }

        const tryBlock: BlockNode = {
            type: 'BlockStatement',
            body: tryBody,
            start: startToken.offset,
            end: this.lastConsumedEnd()
        };

        // 4. BEGIN CATCH
        const catchStart = this.peek()?.offset ?? endOffset;

        try {
            this.matchKeyword('BEGIN');
            this.matchKeyword('CATCH');
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CATCH_BEGIN',
                'Expected BEGIN CATCH after END TRY',
                endOffset
            );
        }

        // 5. CATCH block body — statements until END CATCH
        const catchBody: Statement[] = [];

        while (
            this.pos < this.tokens.length &&
            !(this.peek()?.value === 'END' && this.peek(1)?.value === 'CATCH')
        ) {
            const stmt = this.parseStatement();
            if (stmt) {
                catchBody.push(stmt);
                endOffset = stmt.end;
            } else if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
            } else {
                break;
            }
        }

        // 6. END CATCH
        try {
            this.matchKeyword('END');
            this.matchKeyword('CATCH');
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CATCH_END',
                'Expected END CATCH',
                endOffset
            );
        }

        const catchBlock: BlockNode = {
            type: 'BlockStatement',
            body: catchBody,
            start: catchStart,
            end: this.lastConsumedEnd()
        };

        return {
            type: 'TryCatchStatement',
            tryBlock,
            catchBlock,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseThrow(): ThrowNode {
        const startToken = this.matchKeyword('THROW');
        let endOffset = startToken.offset + startToken.value.length;

        let incomplete = false;
        const errors: string[] = [];

        let errorNumber: Expression | null | undefined;
        let message: Expression | null | undefined;
        let state: Expression | null | undefined;

        // Bare THROW (re-throw inside CATCH) — no arguments
        const next = this.peek();
        const isBare =
            !next ||
            next.type === TokenType.Semicolon ||
            RESYNC_KEYWORDS.has(next.value);

        if (!isBare) {
            // THROW error_number, message, state
            try {
                errorNumber = this.parseExpression();
                endOffset = errorNumber.end;

                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();

                    message = this.parseExpression();
                    endOffset = message.end;
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_THROW_MESSAGE',
                        'Expected message argument in THROW',
                        endOffset
                    );
                }

                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();

                    state = this.parseExpression();
                    endOffset = state.end;
                } else if (message) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_THROW_STATE',
                        'Expected state argument in THROW',
                        endOffset
                    );
                }

            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_THROW_ARGS',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'ThrowStatement',
            ...(errorNumber !== undefined ? { errorNumber } : {}),
            ...(message !== undefined ? { message } : {}),
            ...(state !== undefined ? { state } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseBreak(): BreakNode {
        const token = this.matchKeyword('BREAK');
        return {
            type: 'BreakStatement',
            start: token.offset,
            end: token.offset + token.value.length
        };
    }

    private parseContinue(): ContinueNode {
        const token = this.matchKeyword('CONTINUE');
        return {
            type: 'ContinueStatement',
            start: token.offset,
            end: token.offset + token.value.length
        };
    }

    private canStartAlias(token?: Token): boolean {
        if (!token) {
            return false;
        }

        if (
            token.type !== TokenType.Identifier &&
            token.type !== TokenType.Keyword
        ) {
            return false;
        }

        const STOP = new Set([
            'WITH',
            'ON',
            'WHERE',
            'GROUP',
            'ORDER',
            'HAVING',
            'UNION',
            'EXCEPT',
            'INTERSECT',
            'JOIN',
            'INNER',
            'LEFT',
            'RIGHT',
            'FULL',
            'CROSS',
            'OUTER',
            'APPLY',
            'FOR',
            'OPTION',
            'OFFSET',
            'FETCH'
        ]);

        return !STOP.has(token.value);
    }

    private isFromBoundary(token?: Token): boolean {
        if (!token) return true;

        return [
            'WHERE',
            'GROUP',
            'HAVING',
            'ORDER',
            'UNION',
            'EXCEPT',
            'INTERSECT',
            'FOR',
            'OPTION',
            'OFFSET',
            'FETCH'
        ].includes(token.value);
    }

    private isClauseBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen
        ) {
            return true;
        }

        return [
            'FROM',
            'WHERE',
            'GROUP',
            'HAVING',
            'ORDER',
            'UNION',
            'EXCEPT',
            'INTERSECT',
            'JOIN',
            'ON',
            'APPLY',
            'FOR',
            'OPTION',
            'OFFSET',
            'FETCH',
            'OUTPUT'
        ].includes(token.value);
    }
}
