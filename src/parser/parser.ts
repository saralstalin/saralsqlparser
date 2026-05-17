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
    UpdateStatisticsNode,
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
    StatisticsOptionNode,
    TruncateNode,
    AlterTableNode,
    AlterIndexNode,


    // Expressions
    Expression,
    IdentifierNode,
    FunctionCallNode,
    PivotClause,
    UnpivotClause,
    GroupingExpression,
    SubqueryExpression,
    ValuesTableExpression,
    OverExpression,
    MemberExpression,
    WildcardExpression,
    WindowDefinition,
    FrameBoundary,
    FrameClause,
    FrameUnit,
    ReturnNode,
    CastExpression,
    ForClause,
    ForJsonOption,
    ForXmlOption,
    OptionClause,
    QueryHint,
    OpenJsonColumnDefinition,

    // Table / relational
    TableReference,
    JoinNode,
    JoinType,
    JoinHint,
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
    GotoNode,
    LabelNode,
    WaitForNode,
    DeclareCursorNode,
    OpenCursorNode,
    FetchCursorNode,
    CloseCursorNode,
    DeallocateCursorNode,
    TryCatchNode,
    ThrowNode,

    TransactionAction,
    TransactionNode,

    TopClause,
    AlterTableAction,
    AlterIndexAction,
    ExistsExpression,


} from '../ast/types';

import {
    CREATE_OBJECT_TYPES,
    DROP_OBJECT_TYPES,
    JoinKeyword,
    JoinKeywords,
    JoinTypes,
    PRECEDENCE_MAP,
    Precedence,
    RESYNC_KEYWORDS,
    STRUCTURAL_KEYWORDS
} from './grammar';

import { stringifyExpression as stringifyExpressionNode } from './expressionStringifier';
import {
    canStartAlias,
    isClauseBoundary,
    isFromBoundary,
    isJoinToken
} from './boundaries';

export { JoinKeywords };
export type { JoinKeyword };


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
        this.issues.push(...lexer.getIssues());
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

                //this.resync();
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

    private parseMultipartIdentifier(
        firstConsumed?: Token,
        options?: {
            allowStructuralFirstSegment?: boolean;
        }
    ): Expression {
        const segments: Token[] = [];
        const allowStructuralFirstSegment =
            options?.allowStructuralFirstSegment ?? false;

        const startToken =
            firstConsumed ?? this.peek();
        let startOffset = startToken?.offset ?? 0;
        let endOffset = startOffset;

        // --- 1. First segment (never throw) ---
        const first =
            firstConsumed ?? this.peek();

        if (
            !first ||
            ![
                TokenType.Identifier,
                TokenType.Keyword,
                TokenType.Variable,
                TokenType.TempTable
            ].includes(first.type) ||
            (first.type === TokenType.Keyword &&
                this.isStructuralKeyword(first.value) &&
                !allowStructuralFirstSegment)
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

        const consumedFirst =
            firstConsumed ?? this.consume();
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

    private parseTableValuedFunction(
        idNode: IdentifierNode
    ): FunctionCallNode {
        this.match(TokenType.OpenParen);

        const args: Expression[] = [];
        let distinct = false;

        if (this.peekKeyword('DISTINCT')) {
            this.consume();
            distinct = true;
        }

        if (this.peek()?.type !== TokenType.CloseParen) {
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

        let openJsonWith:
            OpenJsonColumnDefinition[] | undefined;

        if (
            idNode.name.toUpperCase() === 'OPENJSON' &&
            this.peekKeyword('WITH')
        ) {
            openJsonWith =
                this.parseOpenJsonWithClause();
        }

        return {
            type: 'FunctionCall',
            name: idNode.name,
            args,
            start: idNode.start,
            end:
                openJsonWith?.length
                    ? openJsonWith[
                        openJsonWith.length - 1
                    ].end
                    : closeParen.offset +
                    closeParen.value.length,
            ...(distinct
                ? { distinct: true }
                : {}),
            ...(openJsonWith
                ? { openJsonWith }
                : {})
        };
    }

    private skipCreatePreambleUntil(
        stopKeywords: string[]
    ): number {
        let endOffset =
            this.lastConsumedEnd();

        const stopSet =
            new Set(
                stopKeywords.map(x =>
                    x.toUpperCase()
                )
            );

        let previousKeyword:
            string | null = null;

        while (this.peek()) {
            const token = this.peek()!;

            if (
                token.type === TokenType.Keyword
            ) {
                const upper =
                    token.value.toUpperCase();

                if (
                    stopSet.has(upper) &&
                    !(
                        upper === 'AS' &&
                        previousKeyword === 'EXECUTE'
                    )
                ) {
                    break;
                }

                previousKeyword = upper;
            } else {
                previousKeyword = null;
            }

            const consumed =
                this.consume();

            endOffset =
                consumed.offset +
                consumed.value.length;
        }

        return endOffset;
    }

    private parseWithinGroupClause(): OrderByNode[] {
        this.matchKeyword('WITHIN');
        this.matchKeyword('GROUP');
        this.match(TokenType.OpenParen);
        this.matchKeyword('ORDER');
        this.matchKeyword('BY');

        const orderBy =
            this.parseList(() => {
                const expr =
                    this.parseExpression();

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
            }, {
                isBoundary: (token?: Token) =>
                    !token ||
                    token.type === TokenType.CloseParen
            });

        this.match(TokenType.CloseParen);

        return orderBy;
    }

    private parseOpenJsonWithClause(): OpenJsonColumnDefinition[] {
        this.matchKeyword('WITH');
        this.match(TokenType.OpenParen);

        const columns: OpenJsonColumnDefinition[] = [];

        while (this.peek()) {
            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                break;
            }

            const startToken = this.peek()!;
            const nameExpr =
                this.parseMultipartIdentifier();

            if (nameExpr.type !== 'Identifier') {
                throw new Error(
                    'Wildcards are not allowed as OPENJSON column names'
                );
            }

            const dataTypeParts: string[] = [];
            let parenDepth = 0;

            while (this.peek()) {
                const token = this.peek()!;

                if (
                    parenDepth === 0 &&
                    (
                        token.type === TokenType.Comma ||
                        token.type === TokenType.CloseParen ||
                        token.type === TokenType.String
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

                dataTypeParts.push(token.value);
                this.consume();
            }

            const dataType =
                dataTypeParts.join('');

            let path: string | undefined;
            let asJson = false;

            if (
                this.peek()?.type ===
                TokenType.String
            ) {
                path = this.consume().value;
            }

            if (this.peekKeyword('AS')) {
                this.consume();
                this.matchKeyword('JSON');
                asJson = true;
            }

            columns.push({
                name: nameExpr.name,
                dataType,
                ...(path ? { path } : {}),
                ...(asJson ? { asJson: true } : {}),
                start: startToken.offset,
                end: this.lastConsumedEnd()
            });

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
                continue;
            }

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                break;
            }
        }

        return columns;
    }

    private parseTableSourceExpression(): Expression | null {
        const next = this.peek();
        const nextNext = this.peek(1);

        if (
            next?.type === TokenType.OpenParen &&
            (
                nextNext?.value === 'VALUES' ||
                nextNext?.value === 'SELECT' ||
                nextNext?.value === 'WITH'
            )
        ) {
            if (nextNext?.value === 'VALUES') {
                return this.parseValuesTableExpression();
            }

            const openParen = this.consume();

            const query =
                this.parseQueryExpression();

            const closeParen =
                this.match(TokenType.CloseParen);

            return {
                type: 'SubqueryExpression',
                query,
                start: openParen.offset,
                end:
                    closeParen.offset +
                    closeParen.value.length
            };
        }

        const source =
            this.parseMultipartIdentifier();

        if (
            source.type === 'Identifier' &&
            this.peek()?.type === TokenType.OpenParen
        ) {
            return this.parseTableValuedFunction(
                source
            );
        }

        return source;
    }

    private parseValuesTableExpression(): ValuesTableExpression {
        const openParen = this.match(TokenType.OpenParen);
        this.matchKeyword('VALUES');

        const rows: Expression[][] = [];
        const errors: string[] = [];
        let incomplete = false;
        let endOffset = openParen.offset + openParen.value.length;

        while (this.peek()) {
            try {
                this.match(TokenType.OpenParen);

                const row =
                    this.parseList(() => this.parseExpression(Precedence.LOWEST));

                rows.push(row);

                const closeRow = this.match(TokenType.CloseParen);
                endOffset = closeRow.offset + closeRow.value.length;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_VALUES_ROW',
                    e instanceof Error ? e.message : String(e),
                    this.peek()?.offset ?? endOffset,
                    this.peek()?.offset ?? endOffset
                );

                break;
            }

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
                endOffset = this.lastConsumedEnd();
                continue;
            }

            break;
        }

        const closeParen = this.match(TokenType.CloseParen);
        endOffset = closeParen.offset + closeParen.value.length;

        return {
            type: 'ValuesTableExpression',
            rows,
            start: openParen.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseParenthesizedTokenText(): string {
        this.match(TokenType.OpenParen);

        let depth = 1;
        let text = '';

        while (this.peek() && depth > 0) {
            const token = this.consume();

            if (token.type === TokenType.OpenParen) {
                depth++;
            } else if (token.type === TokenType.CloseParen) {
                depth--;

                if (depth === 0) {
                    break;
                }
            }

            text += token.value;
        }

        return text;
    }

    private parseForJsonOption(): ForJsonOption {
        const optionToken = this.consume();
        const option = optionToken.value.toUpperCase();

        switch (option) {
            case 'ROOT': {
                const value =
                    this.peek()?.type === TokenType.OpenParen
                        ? this.parseParenthesizedTokenText()
                        : undefined;

                return {
                    kind: 'ROOT',
                    ...(value !== undefined ? { value } : {})
                };
            }

            case 'INCLUDE_NULL_VALUES':
                return { kind: 'INCLUDE_NULL_VALUES' };

            case 'WITHOUT_ARRAY_WRAPPER':
                return { kind: 'WITHOUT_ARRAY_WRAPPER' };

            default:
                return {
                    kind: 'UNKNOWN',
                    value: optionToken.value
                };
        }
    }

    private parseForXmlOption(): ForXmlOption {
        const optionToken = this.consume();
        const option = optionToken.value.toUpperCase();

        switch (option) {
            case 'TYPE':
                return { kind: 'TYPE' };

            case 'ELEMENTS': {
                let xsinil = false;

                if (this.peekKeyword('XSINIL')) {
                    this.consume();
                    xsinil = true;
                }

                return {
                    kind: 'ELEMENTS',
                    ...(xsinil ? { xsinil: true } : {})
                };
            }

            case 'ROOT': {
                const value =
                    this.peek()?.type === TokenType.OpenParen
                        ? this.parseParenthesizedTokenText()
                        : undefined;

                return {
                    kind: 'ROOT',
                    ...(value !== undefined ? { value } : {})
                };
            }

            case 'BINARY':
                if (this.peekKeyword('BASE64')) {
                    this.consume();
                    return { kind: 'BINARY_BASE64' };
                }

                return {
                    kind: 'UNKNOWN',
                    value: optionToken.value
                };

            case 'XMLSCHEMA':
                return { kind: 'XMLSCHEMA' };

            case 'XMLDATA':
                return { kind: 'XMLDATA' };

            default:
                return {
                    kind: 'UNKNOWN',
                    value: optionToken.value
                };
        }
    }

    private stringifyTokens(tokens: Token[]): string {
        let text = '';

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const prev = tokens[i - 1];

            const needsSpace =
                i > 0 &&
                token.type !== TokenType.CloseParen &&
                token.type !== TokenType.Comma &&
                token.type !== TokenType.Dot &&
                prev?.type !== TokenType.OpenParen &&
                prev?.type !== TokenType.Dot;

            if (needsSpace) {
                text += ' ';
            }

            text += token.value;
        }

        return text;
    }

    private parseOptionClause(): OptionClause {
        const optionToken = this.matchKeyword('OPTION');
        const errors: string[] = [];
        let incomplete = false;
        let endOffset =
            optionToken.offset + optionToken.value.length;
        const hints: QueryHint[] = [];

        if (this.peek()?.type !== TokenType.OpenParen) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_OPTION_OPEN',
                'Expected ( after OPTION',
                endOffset,
                endOffset
            );

            return {
                type: 'OptionClause',
                hints,
                start: optionToken.offset,
                end: endOffset,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {})
            };
        }

        this.consume();
        endOffset = this.lastConsumedEnd();

        while (this.peek()) {
            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                endOffset = this.lastConsumedEnd();
                break;
            }

            const hintTokens: Token[] = [];
            let depth = 0;

            while (this.peek()) {
                const token = this.peek()!;

                if (
                    depth === 0 &&
                    (
                        token.type === TokenType.Comma ||
                        token.type === TokenType.CloseParen
                    )
                ) {
                    break;
                }

                if (token.type === TokenType.OpenParen) {
                    depth++;
                } else if (token.type === TokenType.CloseParen) {
                    depth--;
                }

                hintTokens.push(this.consume());
                endOffset = this.lastConsumedEnd();
            }

            if (hintTokens.length === 0) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_OPTION_EMPTY_HINT',
                    'Expected OPTION hint',
                    endOffset,
                    endOffset
                );
            } else {
                hints.push(
                    this.validateOptionHint(
                        hintTokens,
                        errors
                    )
                );
            }

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
                endOffset = this.lastConsumedEnd();
                continue;
            }
        }

        if (this.tokens[this.pos - 1]?.type !== TokenType.CloseParen) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_OPTION_CLOSE',
                'Expected ) after OPTION hints',
                endOffset,
                endOffset
            );
        }

        return {
            type: 'OptionClause',
            hints,
            start: optionToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private validateOptionHint(
        tokens: Token[],
        errors: string[]
    ): QueryHint {
        const raw =
            this.stringifyTokens(tokens);
        const parts =
            tokens.map(t => t.value.toUpperCase());

        const expectNumericValue = (
            kind: 'MAXDOP' | 'FAST' | 'MAXRECURSION'
        ): QueryHint => {
            const valueToken = tokens[1];
            const value =
                valueToken ? Number(valueToken.value) : Number.NaN;

            if (
                tokens.length !== 2 ||
                !valueToken ||
                valueToken.type !== TokenType.Number ||
                Number.isNaN(value)
            ) {
                this.addRecoverableError(
                    errors,
                    'PARSE_OPTION_HINT',
                    `Expected numeric value for OPTION ${kind}`,
                    tokens[0].offset,
                    tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length
                );

                return { kind: 'UNKNOWN', raw };
            }

            return { kind, raw, value };
        };

        if (parts.length === 1 && parts[0] === 'RECOMPILE') {
            return { kind: 'RECOMPILE', raw };
        }

        if (parts.length === 2 && parts[0] === 'HASH' && parts[1] === 'JOIN') {
            return { kind: 'HASH_JOIN', raw };
        }

        if (parts.length === 2 && parts[0] === 'MERGE' && parts[1] === 'JOIN') {
            return { kind: 'MERGE_JOIN', raw };
        }

        if (parts.length === 2 && parts[0] === 'LOOP' && parts[1] === 'JOIN') {
            return { kind: 'LOOP_JOIN', raw };
        }

        if (parts.length === 2 && parts[0] === 'HASH' && parts[1] === 'GROUP') {
            return { kind: 'HASH_GROUP', raw };
        }

        if (parts.length === 2 && parts[0] === 'ORDER' && parts[1] === 'GROUP') {
            return { kind: 'ORDER_GROUP', raw };
        }

        if (parts.length === 2 && parts[0] === 'MERGE' && parts[1] === 'UNION') {
            return { kind: 'MERGE_UNION', raw };
        }

        if (parts.length === 2 && parts[0] === 'CONCAT' && parts[1] === 'UNION') {
            return { kind: 'CONCAT_UNION', raw };
        }

        if (parts.length === 2 && parts[0] === 'FORCE' && parts[1] === 'ORDER') {
            return { kind: 'FORCE_ORDER', raw };
        }

        if (parts.length === 2 && parts[0] === 'KEEP' && parts[1] === 'PLAN') {
            return { kind: 'KEEP_PLAN', raw };
        }

        if (parts.length === 1 && parts[0] === 'KEEPFIXED_PLAN') {
            return { kind: 'KEEPFIXED_PLAN', raw };
        }

        if (parts.length === 2 && parts[0] === 'ROBUST' && parts[1] === 'PLAN') {
            return { kind: 'ROBUST_PLAN', raw };
        }

        if (parts[0] === 'MAXDOP') {
            return expectNumericValue('MAXDOP');
        }

        if (parts[0] === 'FAST') {
            return expectNumericValue('FAST');
        }

        if (parts[0] === 'MAXRECURSION') {
            return expectNumericValue('MAXRECURSION');
        }

        if (parts[0] === 'PARAMETERIZATION') {
            if (
                parts.length === 2 &&
                (parts[1] === 'SIMPLE' || parts[1] === 'FORCED')
            ) {
                return {
                    kind: 'PARAMETERIZATION',
                    raw,
                    value: parts[1] as 'SIMPLE' | 'FORCED'
                };
            }

            this.addRecoverableError(
                errors,
                'PARSE_OPTION_HINT',
                'Expected SIMPLE or FORCED after OPTION PARAMETERIZATION',
                tokens[0].offset,
                tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length
            );

            return { kind: 'UNKNOWN', raw };
        }

        if (parts[0] === 'OPTIMIZE' && parts[1] === 'FOR') {
            if (
                tokens.length >= 4 &&
                tokens[2].type === TokenType.OpenParen &&
                tokens[tokens.length - 1].type === TokenType.CloseParen
            ) {
                return {
                    kind: 'OPTIMIZE_FOR',
                    raw,
                    value: raw.substring(raw.indexOf('(') + 1, raw.lastIndexOf(')'))
                };
            }

            this.addRecoverableError(
                errors,
                'PARSE_OPTION_HINT',
                'Expected parenthesized arguments after OPTION OPTIMIZE FOR',
                tokens[0].offset,
                tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length
            );

            return { kind: 'UNKNOWN', raw };
        }

        if (parts[0] === 'USE' && parts[1] === 'HINT') {
            if (
                tokens.length >= 4 &&
                tokens[2].type === TokenType.OpenParen &&
                tokens[tokens.length - 1].type === TokenType.CloseParen
            ) {
                return {
                    kind: 'USE_HINT',
                    raw,
                    value: raw.substring(raw.indexOf('(') + 1, raw.lastIndexOf(')'))
                };
            }

            this.addRecoverableError(
                errors,
                'PARSE_OPTION_HINT',
                'Expected parenthesized arguments after OPTION USE HINT',
                tokens[0].offset,
                tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length
            );

            return { kind: 'UNKNOWN', raw };
        }

        this.addRecoverableError(
            errors,
            'PARSE_OPTION_HINT',
            `Unsupported OPTION hint: ${raw}`,
            tokens[0].offset,
            tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length
        );

        return { kind: 'UNKNOWN', raw };
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
                const rightStart = this.parseSelect();

                right = this.parseSetOperation(
                    rightStart,
                    precedence + 1
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

        if (
            this.peekKeyword('ELSE') ||
            this.peekKeyword('END') ||
            this.peekKeyword('CATCH')
        ) {
            return null;
        }

        let stmt: Statement | null = null;
        const startOffset = token.offset;

        try {
            if (this.isLabelStatementStart()) {
                stmt = this.parseLabel();
            } else {
            const val = token.value;

            switch (val) {
                case 'SELECT': stmt = this.parseQueryExpression(); break;
                case 'INSERT': stmt = this.parseInsert(); break;
                case 'UPDATE':
                    stmt = this.peek(1)?.value.toUpperCase() === 'STATISTICS'
                        ? this.parseUpdateStatistics()
                        : this.parseUpdate();
                    break;
                case 'DELETE': stmt = this.parseDelete(); break;
                case 'DECLARE':
                    stmt = this.isCursorDeclarationStart()
                        ? this.parseDeclareCursor()
                        : this.parseDeclare();
                    break;
                case 'MERGE': stmt = this.parseMerge(); break;
                case 'SET': stmt = this.parseSet(); break;
                case 'CREATE': stmt = this.parseCreate(false); break;
                case 'ALTER':
                    // Check if this is an ALTER TABLE statement
                    if (this.peek(1)?.value.toUpperCase() === 'TABLE') {
                        stmt = this.parseAlterTable();
                    } else if (this.peek(1)?.value.toUpperCase() === 'INDEX') {
                        stmt = this.parseAlterIndex();
                    } else {
                        // Fallback for ALTER PROC, ALTER VIEW, etc.
                        stmt = this.parseCreate(true);
                    }
                    break;
                case 'DROP': stmt = this.parseDrop(); break;
                case 'IF': stmt = this.parseIf(); break;
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
                case 'GOTO': stmt = this.parseGoto(); break;
                case 'WAITFOR': stmt = this.parseWaitFor(); break;
                case 'OPEN': stmt = this.parseOpenCursor(); break;
                case 'FETCH': stmt = this.parseFetchCursor(); break;
                case 'CLOSE': stmt = this.parseCloseCursor(); break;
                case 'DEALLOCATE': stmt = this.parseDeallocateCursor(); break;
                case 'BEGIN':
                    if (this.peek(1)?.value === 'TRY') {
                        stmt = this.parseTryCatch();
                    } else if (
                        this.peek(1)?.value === 'TRANSACTION' ||
                        this.peek(1)?.value === 'TRAN' ||
                        this.peek(1)?.value === 'DISTRIBUTED'
                    ) {
                        stmt = this.parseTransaction();
                    } else {
                        stmt = this.parseBlock();
                    }
                    break;
                case 'COMMIT':
                case 'ROLLBACK':
                case 'SAVE':
                    stmt = this.parseTransaction();
                    break;
                case 'TRUNCATE':
                    return this.parseTruncate();
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
            }

        } catch (e) {
            const errorMsg =
                e instanceof Error ? e.message : String(e);

            const errorEnd = this.peek()
                ? this.peek()!.offset + this.peek()!.value.length
                : startOffset + 1;

            const errors: string[] = [];

            // FIX: use centralized error pipeline
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

    private isLabelStatementStart(): boolean {
        const token = this.peek();
        const next = this.peek(1);

        if (!token || !next) {
            return false;
        }

        const validName =
            token.type === TokenType.Identifier ||
            token.type === TokenType.Keyword;

        return (
            validName &&
            next.type === TokenType.Operator &&
            next.value === ':'
        );
    }

    private isCursorDeclarationStart(): boolean {
        if (!this.peekKeyword('DECLARE')) {
            return false;
        }

        const nameToken = this.peek(1);
        const cursorToken = this.peek(2);

        const validName =
            nameToken &&
            (
                nameToken.type === TokenType.Identifier ||
                nameToken.type === TokenType.Keyword
            );

        return !!(
            validName &&
            cursorToken?.value === 'CURSOR'
        );
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
        let top: TopClause | null = null;

        if (this.peekKeyword('TOP')) {
            const topToken = this.matchKeyword('TOP');
            let topEnd = topToken.offset + topToken.value.length;
            let topIncomplete = false;
            const topErrors: string[] = [];

            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            let quantity: Expression | null = null;

            try {
                const next = this.peek();
                if (
                    !next ||
                    next.type === TokenType.Semicolon ||
                    (
                        next.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(next.value)
                    )
                ) {
                    // nothing after TOP or TOP (
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_TOP_QUANTITY',
                        'Expected expression after TOP',
                        topEnd,
                        topEnd
                    );
                } else if (hasParens && next.type === TokenType.CloseParen) {
                    // TOP () — empty parens, consume the ) and mark incomplete
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_TOP_QUANTITY',
                        'Expected expression after TOP',
                        topEnd,
                        topEnd
                    );
                } else if (hasParens) {
                    // full expression allowed inside parens: TOP (@n), TOP (10 + 5)
                    quantity = this.parseExpression();
                    topEnd = quantity.end;
                } else {
                    // bare TOP n — exactly one token, no operators
                    const tok = this.consume();
                    const numVal = Number(tok.value);
                    quantity = {
                        type: 'Literal',
                        variant: numVal !== numVal ? 'string' : 'number', // NaN check
                        value: numVal !== numVal ? tok.value : numVal,
                        start: tok.offset,
                        end: tok.offset + tok.value.length,
                    };
                    topEnd = quantity.end;
                }
            } catch (e) {
                topIncomplete = true;
                this.addRecoverableError(
                    topErrors,
                    'PARSE_TOP_QUANTITY',
                    e instanceof Error ? e.message : String(e),
                    topEnd,
                    topEnd
                );
            }

            if (hasParens) {
                if (this.peek()?.type === TokenType.CloseParen) {
                    const closeParen = this.consume();
                    topEnd = closeParen.offset + closeParen.value.length;
                } else {
                    // SELECT TOP (10  — unclosed paren
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_TOP_CLOSE_PAREN',
                        'Expected ) after TOP expression',
                        topEnd,
                        topEnd
                    );
                }
            }

            let percent = false;
            if (this.peekKeyword('PERCENT')) {
                const percentToken = this.consume();
                percent = true;
                topEnd = percentToken.offset + percentToken.value.length;
            }

            let withTies = false;
            if (this.peekKeyword('WITH')) {
                const withToken = this.consume();
                topEnd = withToken.offset + withToken.value.length;
                if (this.peekKeyword('TIES')) {
                    const tiesToken = this.consume();
                    withTies = true;
                    topEnd = tiesToken.offset + tiesToken.value.length;
                } else {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_TOP_WITH_TIES',
                        'Expected TIES after WITH',
                        topEnd,
                        topEnd
                    );
                }
            }

            top = {
                type: 'TopClause',
                quantity,
                percent,
                withTies,
                start: topToken.offset,
                end: topEnd,
                ...(topIncomplete ? { incomplete: true } : {}),
                ...(topErrors.length ? { errors: topErrors } : {}),
            };
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

                this.resyncToSelectBoundary();
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

            let mode: 'JSON' | 'XML' | null = null;

            if (this.peekKeyword('JSON')) {
                this.consume();
                mode = 'JSON';
            } else if (this.peekKeyword('XML')) {
                this.consume();
                mode = 'XML';
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_FOR',
                    'Expected JSON or XML after FOR',
                    endOffset
                );
            }

            if (mode) {
                const next = this.peek();

                if (
                    !next ||
                    next.type === TokenType.Semicolon
                ) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_SELECT_FOR',
                        'Expected FOR directive',
                        endOffset
                    );
                } else {
                    const directive =
                        this.consume().value.toUpperCase();

                    if (mode === 'JSON') {
                        const options: ForJsonOption[] = [];

                        while (this.peek()?.type === TokenType.Comma) {
                            this.consume();
                            options.push(this.parseForJsonOption());
                        }

                        forClause = {
                            mode: 'JSON',
                            directive: directive as 'AUTO' | 'PATH',
                            ...(options.length ? { options } : {})
                        };
                    } else {
                        let argument: string | undefined;

                        if (this.peek()?.type === TokenType.OpenParen) {
                            argument = this.parseParenthesizedTokenText();
                        }

                        const options: ForXmlOption[] = [];

                        while (this.peek()?.type === TokenType.Comma) {
                            this.consume();
                            options.push(this.parseForXmlOption());
                        }

                        forClause = {
                            mode: 'XML',
                            directive: directive as 'AUTO' | 'PATH' | 'RAW' | 'EXPLICIT',
                            ...(argument !== undefined ? { argument } : {}),
                            ...(options.length ? { options } : {})
                        };
                    }

                    endOffset = this.lastConsumedEnd();
                }
            }
        }

        let optionClause: OptionClause | null = null;

        if (this.peekKeyword('OPTION')) {
            try {
                optionClause = this.parseOptionClause();
                endOffset = optionClause.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_SELECT_OPTION',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'SelectStatement',
            distinct,
            columns,
            ...(top ? { top } : {}),
            ...(into ? { into } : {}),
            ...(from ? { from } : {}),
            ...(where ? { where } : {}),
            ...(groupBy ? { groupBy } : {}),
            ...(having ? { having } : {}),
            ...(orderBy ? { orderBy } : {}),
            ...(offset ? { offset } : {}),
            ...(fetch ? { fetch } : {}),
            ...(forClause ? { forClause } : {}),
            ...(optionClause ? { optionClause } : {}),
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
                        const node = this.parseMultipartIdentifier(
                            undefined,
                            { allowStructuralFirstSegment: true }
                        );
                        if (node.type === 'Identifier') return node;
                        throw new Error(
                            'Wildcards are not allowed in an INSERT column list'
                        );
                    }, {
                        isBoundary:
                            this.isIdentifierListBoundary.bind(this)
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
            ...(columns ? { columns } : {}),
            ...(columnNodes ? { columnNodes } : {}),
            ...(output ? { output } : {}),
            ...(values ? { values } : {}),
            ...(selectQuery ? { selectQuery } : {}),
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
        let top: TopClause | null = null;

        if (this.peekKeyword('TOP')) {
            const topResult =
                this.parseDmlTopClause(
                    errors,
                    'UPDATE'
                );

            top = topResult.top;
            endOffset = topResult.endOffset;
            incomplete =
                incomplete || topResult.incomplete;
        }

        // 1. Target
        let targetNode: Expression | null = null;
        let targetHints: string[] | undefined;

        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value)
            ) {
                targetNode =
                    this.parseMultipartIdentifier();

                endOffset = targetNode.end;

                if (
                    this.peekKeyword('WITH') ||
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    targetHints = this.parseTableHints();
                    endOffset = this.lastConsumedEnd();
                }
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

        let optionClause: OptionClause | null = null;

        if (this.peekKeyword('OPTION')) {
            try {
                optionClause = this.parseOptionClause();
                endOffset = optionClause.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_OPTION',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'UpdateStatement',
            ...(top ? { top } : {}),
            target: targetNode,
            ...(targetHints?.length ? { targetHints } : {}),
            ...(assignments?.length ? { assignments } : {}),
            ...(output ? { output } : {}),
            ...(from ? { from } : {}),
            ...(where ? { where } : {}),
            ...(optionClause ? { optionClause } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseUpdateStatistics(): UpdateStatisticsNode {
        const startToken = this.matchKeyword('UPDATE');
        this.matchKeyword('STATISTICS');

        let incomplete = false;
        const errors: string[] = [];
        let table: IdentifierNode | null = null;
        let statistics: string | null = null;
        let options: StatisticsOptionNode[] | undefined;

        try {
            const tableExpr = this.parseMultipartIdentifier();
            if (tableExpr.type === 'Identifier') {
                table = tableExpr;
            } else {
                throw new Error('Expected table name after UPDATE STATISTICS');
            }

            const next = this.peek();
            if (
                next &&
                next.type !== TokenType.Semicolon &&
                !(
                    next.type === TokenType.Keyword &&
                    next.value === 'WITH'
                )
            ) {
                if (next.type === TokenType.OpenParen) {
                    this.consume();
                    const statsNames = this.parseList<string>(() =>
                        this.consume().value
                    , {
                        isBoundary: (token?: Token) =>
                            !token || token.type === TokenType.CloseParen
                    });
                    this.match(TokenType.CloseParen);
                    statistics = statsNames.join(', ');
                } else {
                    statistics = this.consume().value;
                }
            }

            if (this.peekKeyword('WITH')) {
                this.consume();
                options = this.parseUpdateStatisticsOptions();
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_UPDATE_STATISTICS',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                this.lastConsumedEnd()
            );
        }

        return {
            type: 'UpdateStatisticsStatement',
            table,
            ...(statistics !== null ? { statistics } : {}),
            ...(options?.length ? { options } : {}),
            start: startToken.offset,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseUpdateStatisticsOptions(): StatisticsOptionNode[] {
        return this.parseList<StatisticsOptionNode>(() => {
            const startToken = this.consume();
            let value: string | undefined;

            if (this.peek()?.value === '=') {
                this.consume();

                const parts: string[] = [];
                while (this.peek()) {
                    const token = this.peek()!;
                    if (
                        token.type === TokenType.Comma ||
                        token.type === TokenType.Semicolon ||
                        (
                            token.type === TokenType.Keyword &&
                            RESYNC_KEYWORDS.has(token.value)
                        )
                    ) {
                        break;
                    }

                    parts.push(this.consume().value);
                }

                value = parts.join(' ').trim();
            }

            return {
                type: 'StatisticsOption',
                name: startToken.value,
                ...(value ? { value } : {}),
                start: startToken.offset,
                end: this.lastConsumedEnd()
            };
        }, {
            isBoundary: (token?: Token) =>
                !token ||
                token.type === TokenType.Semicolon ||
                (
                    token.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(token.value)
                )
        });
    }

    private parseFrom(): TableReference[] {
        const fromToken = this.matchKeyword('FROM');

        let incomplete = false;
        const errors: string[] = [];

        const refs: TableReference[] = [];

        try {
            while (this.pos < this.tokens.length) {
                // stop at next clause
                if (isFromBoundary(this.peek())) {
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
                if (isFromBoundary(this.peek())) {
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
        let aliasColumns: string[] | undefined;
        let hints: string[] | undefined;
        let pivot: PivotClause | null = null;
        let unpivot: UnpivotClause | null = null;

        const startToken = this.peek();
        const startOffset = forcedStart ?? startToken?.offset ?? 0;
        let endOffset = startOffset;

        // ------------------------------------------------------------
        // 1. SOURCE
        // ------------------------------------------------------------
        try {
            source =
                this.parseTableSourceExpression();

            if (source) {
                endOffset = source.end;
            }

        } catch (e) {
            incomplete = true;
        }

        const parseOptionalAlias = (): string | null => {
            const token = this.peek();

            if (!source) {
                return null;
            }

            if (token?.value === 'AS') {
                this.consume();

                const id =
                    this.parseMultipartIdentifier();

                if (id.type === 'Identifier') {
                    endOffset = id.end;
                    return id.name;
                }

                throw new Error(
                    'Wildcards cannot be used as table aliases'
                );
            }

            if (canStartAlias(token)) {
                const id =
                    this.parseMultipartIdentifier();

                if (id.type === 'Identifier') {
                    endOffset = id.end;
                    return id.name;
                }

                throw new Error(
                    'Wildcards cannot be used as table aliases'
                );
            }

            return null;
        };

        // ------------------------------------------------------------
        // 2. ALIAS
        // ------------------------------------------------------------
        try {
            alias = parseOptionalAlias();
        } catch {
            incomplete = true;
        }

        try {
            if (
                alias &&
                (
                    source?.type === 'SubqueryExpression' ||
                    source?.type === 'ValuesTableExpression' ||
                    source?.type === 'FunctionCall'
                ) &&
                this.peek()?.type === TokenType.OpenParen
            ) {
                this.consume();

                aliasColumns = this.parseList(() => {
                    const columnExpr =
                        this.parseMultipartIdentifier(
                            undefined,
                            { allowStructuralFirstSegment: true }
                        );

                    if (
                        columnExpr.type === 'Identifier' &&
                        columnExpr.name
                    ) {
                        return columnExpr.name;
                    }

                    throw new Error(
                        'Expected identifier in derived table column list'
                    );
                }, {
                    isBoundary:
                        this.isIdentifierListBoundary.bind(this)
                });

                const closeParen = this.match(TokenType.CloseParen);
                endOffset = closeParen.offset + closeParen.value.length;
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
        // 5. PIVOT / UNPIVOT
        // ------------------------------------------------------------
        try {
            if (this.peekKeyword('PIVOT')) {
                pivot =
                    this.parsePivotClause(
                        alias || undefined
                    );
                alias = null;
                endOffset = pivot.end;

                const pivotAlias =
                    parseOptionalAlias();

                if (pivotAlias) {
                    alias = pivotAlias;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_PIVOT_ALIAS',
                        'Expected alias after PIVOT clause',
                        endOffset,
                        endOffset
                    );
                }
            } else if (this.peekKeyword('UNPIVOT')) {
                unpivot =
                    this.parseUnpivotClause(
                        alias || undefined
                    );
                alias = null;
                endOffset = unpivot.end;

                const unpivotAlias =
                    parseOptionalAlias();

                if (unpivotAlias) {
                    alias = unpivotAlias;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_UNPIVOT_ALIAS',
                        'Expected alias after UNPIVOT clause',
                        endOffset,
                        endOffset
                    );
                }
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                this.peekKeyword('UNPIVOT')
                    ? 'PARSE_UNPIVOT'
                    : 'PARSE_PIVOT',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        // ------------------------------------------------------------
        // 6. JOINS
        // ------------------------------------------------------------
        const joins: JoinNode[] = [];

        while (isJoinToken(this.peek())) {
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
            ...(aliasColumns?.length ? { aliasColumns } : {}),
            hints,
            ...(pivot ? { pivot } : {}),
            ...(unpivot ? { unpivot } : {}),
            joins,
            start: startOffset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parsePivotClause(
        sourceAlias?: string
    ): PivotClause {
        const pivotToken =
            this.matchKeyword('PIVOT');
        const errors: string[] = [];
        let incomplete = false;
        let endOffset =
            pivotToken.offset + pivotToken.value.length;

        this.match(TokenType.OpenParen);

        let aggregate: Expression | null = null;
        let forColumn: IdentifierNode | null = null;
        let inColumns: IdentifierNode[] = [];

        try {
            aggregate =
                this.parseExpression();
            endOffset = aggregate.end;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_PIVOT_AGGREGATE',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            this.matchKeyword('FOR');
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_PIVOT_FOR',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            const id =
                this.parseMultipartIdentifier();

            if (id.type === 'Identifier') {
                forColumn = id;
                endOffset = id.end;
            } else {
                throw new Error(
                    'Expected pivot FOR column'
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_PIVOT_COLUMN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            this.matchKeyword('IN');
            endOffset = this.lastConsumedEnd();
            this.match(TokenType.OpenParen);
            endOffset = this.lastConsumedEnd();

            inColumns = this.parseList(() => {
                const id =
                    this.parseMultipartIdentifier();

                if (id.type === 'Identifier') {
                    return id;
                }

                throw new Error(
                    'Expected pivot IN column'
                );
            });

            if (inColumns.length > 0) {
                endOffset =
                    inColumns[
                        inColumns.length - 1
                    ].end;
            }

            const inClose =
                this.match(TokenType.CloseParen);
            endOffset =
                inClose.offset + inClose.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_PIVOT_IN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            const closeParen =
                this.match(TokenType.CloseParen);
            endOffset =
                closeParen.offset + closeParen.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_PIVOT_CLOSE_PAREN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        return {
            type: 'PivotClause',
            aggregate,
            forColumn,
            inColumns,
            ...(sourceAlias ? { sourceAlias } : {}),
            start: pivotToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseUnpivotClause(
        sourceAlias?: string
    ): UnpivotClause {
        const unpivotToken =
            this.matchKeyword('UNPIVOT');
        const errors: string[] = [];
        let incomplete = false;
        let endOffset =
            unpivotToken.offset + unpivotToken.value.length;

        this.match(TokenType.OpenParen);

        let valueColumn: IdentifierNode | null = null;
        let forColumn: IdentifierNode | null = null;
        let inColumns: IdentifierNode[] = [];

        try {
            const id =
                this.parseMultipartIdentifier();

            if (id.type === 'Identifier') {
                valueColumn = id;
                endOffset = id.end;
            } else {
                throw new Error(
                    'Expected unpivot value column'
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_UNPIVOT_VALUE_COLUMN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            this.matchKeyword('FOR');
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_UNPIVOT_FOR',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            const id =
                this.parseMultipartIdentifier();

            if (id.type === 'Identifier') {
                forColumn = id;
                endOffset = id.end;
            } else {
                throw new Error(
                    'Expected unpivot FOR column'
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_UNPIVOT_COLUMN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            this.matchKeyword('IN');
            endOffset = this.lastConsumedEnd();
            this.match(TokenType.OpenParen);
            endOffset = this.lastConsumedEnd();

            inColumns = this.parseList(() => {
                const id =
                    this.parseMultipartIdentifier();

                if (id.type === 'Identifier') {
                    return id;
                }

                throw new Error(
                    'Expected unpivot IN column'
                );
            });

            if (inColumns.length > 0) {
                endOffset =
                    inColumns[
                        inColumns.length - 1
                    ].end;
            }

            const inClose =
                this.match(TokenType.CloseParen);
            endOffset =
                inClose.offset + inClose.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_UNPIVOT_IN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        try {
            const closeParen =
                this.match(TokenType.CloseParen);
            endOffset =
                closeParen.offset + closeParen.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_UNPIVOT_CLOSE_PAREN',
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        return {
            type: 'UnpivotClause',
            valueColumn,
            forColumn,
            inColumns,
            ...(sourceAlias ? { sourceAlias } : {}),
            start: unpivotToken.offset,
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
        let joinHint: JoinHint | undefined;
        let endOffset = startToken.offset + startToken.value.length;

        // 1. Determine canonical Join Type
        const firstToken = this.consume();
        const first = firstToken.value.toUpperCase();
        endOffset = firstToken.offset + firstToken.value.length;

        try {
            switch (first) {
                case JoinKeywords.HASH:
                case JoinKeywords.MERGE:
                case JoinKeywords.LOOP:
                    joinHint = first as JoinHint;
                    rawType = `${first} JOIN`;

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push(`Expected JOIN after ${first}`);
                    }

                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.JOIN:
                    rawType = JoinKeywords.JOIN;
                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.INNER:
                    rawType = 'INNER JOIN';

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = `INNER ${joinHint} JOIN`;
                    }

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

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = rawType.replace(' JOIN', ` ${joinHint} JOIN`);
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

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = rawType.replace(' JOIN', ` ${joinHint} JOIN`);
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

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = rawType.replace(' JOIN', ` ${joinHint} JOIN`);
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
                tableTarget =
                    this.parseTableSourceExpression();
                if (tableTarget) {
                    endOffset = tableTarget.end;
                }
            }

        } catch (e) {
            incomplete = true;

            errors.push(
                e instanceof Error ? e.message : String(e)
            );
        }

        // 3. Alias
        let alias: string | undefined;
        let aliasColumns: string[] | undefined;

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
                        canStartAlias(potentialAlias)
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

        if (
            alias &&
            (
                tableTarget?.type === 'SubqueryExpression' ||
                tableTarget?.type === 'ValuesTableExpression' ||
                tableTarget?.type === 'FunctionCall'
            ) &&
            this.peek()?.type === TokenType.OpenParen
        ) {
            try {
                this.consume();

                aliasColumns = this.parseList(() => {
                    const columnExpr =
                        this.parseMultipartIdentifier(
                            undefined,
                            { allowStructuralFirstSegment: true }
                        );

                    if (
                        columnExpr.type === 'Identifier' &&
                        columnExpr.name
                    ) {
                        return columnExpr.name;
                    }

                    throw new Error(
                        'Expected identifier in derived table column list'
                    );
                }, {
                    isBoundary:
                        this.isIdentifierListBoundary.bind(this)
                });

                const closeParen = this.match(TokenType.CloseParen);
                endOffset = closeParen.offset + closeParen.value.length;
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
            tableTarget?.type === 'Identifier' &&
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
            ...(joinHint ? { joinHint } : {}),
            table: tableTarget,
            alias,
            ...(aliasColumns?.length ? { aliasColumns } : {}),
            hints,
            on,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDmlTopClause(
        errors: string[],
        codePrefix: 'UPDATE' | 'DELETE'
    ): {
        top: TopClause | null;
        endOffset: number;
        incomplete: boolean;
    } {
        let incomplete = false;
        let top: TopClause | null = null;
        let endOffset =
            this.peek()?.offset ?? this.lastConsumedEnd();

        if (!this.peekKeyword('TOP')) {
            return { top, endOffset, incomplete };
        }

        const topToken = this.consume();
        const topStart = topToken.offset;
        endOffset = topToken.offset + topToken.value.length;

        const hasParens =
            this.peek()?.type === TokenType.OpenParen;

        let quantity: Expression | null = null;
        let topEnd = endOffset;

        if (hasParens) {
            const openParen = this.consume();
            endOffset =
                openParen.offset + openParen.value.length;
        }

        try {
            const next = this.peek();

            if (
                !next ||
                next.type === TokenType.Semicolon ||
                (
                    next.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(next.value)
                )
            ) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    `PARSE_${codePrefix}_TOP`,
                    'Expected TOP value',
                    endOffset,
                    endOffset
                );
            } else if (hasParens && next.type === TokenType.CloseParen) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    `PARSE_${codePrefix}_TOP`,
                    'Expected TOP value',
                    endOffset,
                    endOffset
                );
            } else if (hasParens) {
                quantity = this.parseExpression();
                endOffset = quantity.end;
                topEnd = endOffset;
            } else {
                const quantityToken = this.consume();
                endOffset =
                    quantityToken.offset +
                    quantityToken.value.length;

                const numVal = Number(quantityToken.value);

                quantity = {
                    type: 'Literal',
                    value:
                        Number.isNaN(numVal)
                            ? quantityToken.value
                            : numVal,
                    variant:
                        Number.isNaN(numVal)
                            ? 'string'
                            : 'number',
                    start: quantityToken.offset,
                    end:
                        quantityToken.offset +
                        quantityToken.value.length,
                };
                topEnd = quantity.end;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                `PARSE_${codePrefix}_TOP`,
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset
            );
        }

        if (hasParens) {
            if (this.peek()?.type === TokenType.CloseParen) {
                const closeParen = this.consume();
                endOffset =
                    closeParen.offset + closeParen.value.length;
                topEnd = endOffset;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    `PARSE_${codePrefix}_TOP_CLOSE_PAREN`,
                    'Expected ) after TOP expression',
                    endOffset,
                    endOffset
                );
            }
        }

        top = {
            type: 'TopClause',
            quantity,
            percent: false,
            withTies: false,
            start: topStart,
            end: topEnd,
        };

        return { top, endOffset, incomplete };
    }

    private parseDelete(): DeleteNode {
        const startToken = this.matchKeyword('DELETE');

        let incomplete = false;
        const errors: string[] = [];
        let output: OutputClauseNode | undefined;
        let top: TopClause | null = null;
        let endOffset =
            startToken.offset + startToken.value.length;

        // Optional TOP clause
        if (this.peekKeyword('TOP')) {
            const topResult =
                this.parseDmlTopClause(
                    errors,
                    'DELETE'
                );

            top = topResult.top;
            endOffset = topResult.endOffset;
            incomplete =
                incomplete || topResult.incomplete;
        }

        // Optional first FROM
        // DELETE FROM T ...
        if (this.peekKeyword('FROM')) {
            const fromToken = this.consume();
            endOffset =
                fromToken.offset + fromToken.value.length;
        }

        // 1. Target
        let target: Expression | null = null;

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

        let optionClause: OptionClause | null = null;

        if (this.peekKeyword('OPTION')) {
            try {
                optionClause = this.parseOptionClause();
                endOffset = optionClause.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_DELETE_OPTION',
                    e instanceof Error ? e.message : String(e),
                    endOffset
                );
            }
        }

        return {
            type: 'DeleteStatement',
            ...(top ? { top } : {}),
            target,
            ...(output ? { output } : {}),
            ...(from ? { from } : {}),
            ...(where ? { where } : {}),
            ...(optionClause ? { optionClause } : {}),
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

                    this.recoverToStatementBoundary([
                        ','
                    ]);
                }

                //optional AS
                //
                // T-SQL supports:
                //
                // DECLARE @X INT
                // DECLARE @X AS INT
                if (
                    this.peekKeyword('AS')
                ) {
                    const asToken =
                        this.consume();

                    endOffset =
                        asToken.offset +
                        asToken.value.length;
                }

                // 2) TABLE variable
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

                        // IMPORTANT:
                        // propagate child recoverability
                        if (tableDef.incomplete) {
                            incomplete = true;
                        }

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

                        // IMPORTANT:
                        // avoid swallowing next statement
                        this.recoverToStatementBoundary([
                            ')'
                        ]);

                        endOffset =
                            this.lastConsumedEnd();
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



                // 4) scalar datatype
                try {
                    const next = this.peek();

                    if (
                        next &&
                        next.type !== TokenType.Comma &&
                        next.type !== TokenType.Semicolon &&
                        next.value !== '=' &&
                        !RESYNC_KEYWORDS.has(next.value)
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

                    this.recoverToStatementBoundary([
                        ','
                    ]);

                    endOffset =
                        this.lastConsumedEnd();
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
                            !RESYNC_KEYWORDS.has(next.value)
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

                            this.recoverToStatementBoundary([
                                ','
                            ]);
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

                        // CRITICAL:
                        // prevent swallowing next statement
                        this.recoverToStatementBoundary([
                            ','
                        ]);

                        endOffset =
                            this.lastConsumedEnd();
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

            this.recoverToStatementBoundary();
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

            const valueStarter = this.peek();
            const isMissingValueBoundary =
                !valueStarter ||
                valueStarter.type === TokenType.Comma ||
                valueStarter.type === TokenType.Semicolon ||
                (
                    valueStarter.type === TokenType.Keyword &&
                    ['OUTPUT', 'FROM', 'WHERE', 'OPTION'].includes(
                        valueStarter.value.toUpperCase()
                    )
                );

            if (isMissingValueBoundary) {
                state.incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_UPDATE_ASSIGNMENT_VALUE',
                    'Expected assignment value',
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
                        this.canStartExpressionToken(next)
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
            const SESSION_OPTION_STATEMENT_STARTERS = new Set([
                'SELECT', 'UPDATE', 'DELETE', 'INSERT', 'MERGE',
                'CREATE', 'ALTER', 'DROP', 'TRUNCATE',
                'BEGIN', 'IF', 'WHILE', 'SET', 'DECLARE',
                'EXEC', 'EXECUTE', 'RETURN', 'PRINT',
                'RAISERROR', 'THROW', 'WITH', 'GO'
            ]);

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
                    (
                        (
                            this.isStructuralKeyword(token.value) &&
                            !SESSION_OPTION_TERMINALS.has(token.value)
                        ) ||
                        SESSION_OPTION_STATEMENT_STARTERS.has(token.value)
                    )
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
        incomplete?: boolean;
    } {
        this.match(TokenType.OpenParen);

        const columns: ColumnDefinition[] = [];
        const constraints: ConstraintNode[] = [];

        let incomplete = false;
        let nextTableConstraintMissingComma = false;

        while (this.peek()) {
            const token = this.peek()!;

            // recovery boundary
            if (
                token.type === TokenType.Semicolon
            ) {
                incomplete = true;
                break;
            }

            // proper close
            if (token.type === TokenType.CloseParen) {
                break;
            }

            const value = token.value;

            try {
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

                    if (nextTableConstraintMissingComma) {
                        constraint.missingLeadingComma = true;
                        nextTableConstraintMissingComma = false;
                    }

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
                    this.parseMultipartIdentifier(
                        undefined,
                        { allowStructuralFirstSegment: true }
                    );

                if (nameExpr.type !== 'Identifier') {
                    incomplete = true;

                    throw new Error(
                        'Wildcards are not allowed as column names in table definitions'
                    );
                }

                const name = nameExpr.name;

                if (this.peekKeyword('AS')) {
                    const computed =
                        this.parseComputedColumnTail();

                    columns.push({
                        name,
                        ...computed,
                        start: startToken.offset,
                        end: this.lastConsumedEnd()
                    });

                    if (
                        this.peek()?.type === TokenType.Comma
                    ) {
                        this.consume();
                    }

                    continue;
                }

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
                            incomplete = true;
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

                // missing datatype
                if (!dataType.trim()) {
                    incomplete = true;
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
                        if (this.looksLikeTableConstraintAfterColumn()) {
                            nextTableConstraintMissingComma = true;
                            break;
                        }

                        const constraint =
                            this.parseConstraint(name);

                        columnConstraints.push(
                            constraint
                        );

                        if (
                            constraint.incomplete
                        ) {
                            incomplete = true;
                        }

                        if (
                            this.peek()?.type === TokenType.Comma ||
                            this.peek()?.type === TokenType.CloseParen
                        ) {
                            break;
                        }

                        continue;
                    }

                    incomplete = true;
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

            } catch {
                incomplete = true;

                this.resyncToBoundary(
                    this.isTableDefinitionRecoveryBoundary.bind(this)
                );

                if (
                    this.peek()?.type === TokenType.Comma
                ) {
                    this.consume();
                    continue;
                }

                if (
                    this.peek() &&
                    !this.isTableDefinitionRecoveryBoundary(this.peek())
                ) {
                    continue;
                }

                break;
            }
        }

        // missing closing paren
        if (
            this.peek()?.type === TokenType.CloseParen
        ) {
            this.consume();
        } else {
            incomplete = true;
        }

        return {
            columns,
            constraints,
            ...(incomplete
                ? { incomplete: true }
                : {})
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

                        if (
                            tableDef.incomplete ||
                            tableDef.columns.length === 0
                        ) {
                            incomplete = true;
                        }

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
            objectType === 'FUNCTION' ||
            objectType === 'TRIGGER'
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

                            if (this.peekKeyword('AS')) {
                                this.consume();
                            }

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
                        }, {
                            isBoundary:
                                this.isParameterListBoundary.bind(this)
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

            if (this.peekKeyword('WITH')) {
                endOffset =
                    this.skipCreatePreambleUntil([
                        'AS',
                        'RETURNS',
                        'GO'
                    ]);
            }

            if (
                objectType === 'FUNCTION' &&
                this.peekKeyword('RETURNS')
            ) {
                this.consume();
                endOffset =
                    this.lastConsumedEnd();

                endOffset =
                    this.skipCreatePreambleUntil([
                        'AS',
                        'GO'
                    ]);
            }

            if (objectType === 'TRIGGER') {
                endOffset =
                    this.skipCreatePreambleUntil([
                        'AS',
                        'GO'
                    ]);
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
                    const beforePos =
                        this.pos;
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
                        if (
                            this.pos > beforePos
                        ) {
                            continue;
                        }

                        if (
                            this.peek() &&
                            !stopKeywords.includes(
                                this.peek()!.value
                            )
                        ) {
                            this.consume();
                            continue;
                        }

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
                if (this.peekKeyword('WITH')) {
                    endOffset =
                        this.skipCreatePreambleUntil([
                            'AS',
                            'GO'
                        ]);
                }

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

        else if (
            objectType === 'SCHEMA' ||
            objectType === 'SEQUENCE' ||
            objectType === 'SYNONYM'
        ) {
            endOffset =
                this.skipCreatePreambleUntil([
                    'GO'
                ]);
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

        let ifExists = false;
        if (this.peekKeyword('IF')) {
            this.consume(); // Consume 'IF'
            try {
                this.matchKeyword('EXISTS');
                ifExists = true;
                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(errors, 'PARSE_DROP_IF_EXISTS', "Expected 'EXISTS' after 'IF'", endOffset);
            }
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
            ifExists,
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

        let sourceName:
            | string
            | undefined;

        let outputName = '';

        let wildcard = false;

        let incomplete = false;

        const errors: string[] = [];

        const STOP_KEYWORDS = [
            'FROM',
            'WHERE',
            'GROUP',
            'ORDER',
            'HAVING',

            'UNION',
            'ALL',
            'EXCEPT',
            'INTERSECT',

            'JOIN',
            'ON',
            'APPLY',
            'INTO',

            'OUTER',
            'VALUES',
            'OUTPUT',
            'FOR',

            'OPTION',
            'FETCH',
            'OFFSET',
            'CROSS',

            'PIVOT',
            'UNPIVOT',
            'WITHIN',

            'WHEN',
            'THEN',

            // block/control flow
            'BEGIN',
            'END',
            'ELSE',
            'CATCH',

            // statement starters
            ...Array.from(
                RESYNC_KEYWORDS
            )
        ];

        const startOffset =
            this.peek()?.offset ?? 0;

        const parseColumnAlias = (): string => {
            const nextToken =
                this.peek();

            if (!nextToken) {
                throw new Error(
                    'Expected column alias'
                );
            }

            if (nextToken.type === TokenType.String) {
                const aliasToken =
                    this.consume();

                return aliasToken.value.slice(1, -1);
            }

            const aliasExpr =
                this.parseMultipartIdentifier();

            if (
                aliasExpr.type ===
                'Identifier'
            ) {
                return aliasExpr.name;
            }

            throw new Error(
                'Wildcards cannot be used as column aliases'
            );
        };

        // -------------------------------------------------
        // Expression parse with recovery
        // -------------------------------------------------

        try {

            // ---------------------------------------------
            // Assignment style:
            // Alias = Expression
            // ---------------------------------------------

            if (
                this.peek()?.type ===
                TokenType.Identifier &&
                this.peek(1)?.value === '='
            ) {
                alias =
                    this.consume().value;

                this.consume(); // =

                expression =
                    this.parseExpression();
            }

            // ---------------------------------------------
            // Standard expression column
            // ---------------------------------------------

            else {
                expression =
                    this.parseExpression();

                const nextToken =
                    this.peek();

                const nextVal =
                    nextToken?.value;

                // AS alias
                if (nextVal === 'AS') {
                    this.consume();
                    alias =
                        parseColumnAlias();
                }

                // implicit alias
                else if (
                    nextToken &&
                    nextToken.type !==
                    TokenType.Semicolon &&
                    nextToken.type !==
                    TokenType.Comma &&
                    (
                        nextToken.type ===
                        TokenType.Identifier ||

                        nextToken.type ===
                        TokenType.String ||

                        nextToken.type ===
                        TokenType.Keyword
                    ) &&
                    !STOP_KEYWORDS.includes(
                        nextVal!
                    )
                ) {
                    alias =
                        parseColumnAlias();
                }
            }
        }

        // -------------------------------------------------
        // Recovery
        // -------------------------------------------------

        catch (e) {

            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_COLUMN',
                e instanceof Error
                    ? e.message
                    : String(e),
                startOffset,
                this.peek()?.offset ??
                startOffset
            );

            this.resyncToSelectBoundary();

            // placeholder recovery expression
            expression = {
                type: 'Identifier',
                name: '__ERROR__',
                parts: ['__ERROR__'],
                start: startOffset,
                end:
                    this.peek()?.offset ??
                    startOffset
            };


        }

        // -------------------------------------------------
        // Derive metadata
        // -------------------------------------------------

        switch (expression.type) {

            case 'Identifier':
                sourceName =
                    expression.parts.length > 0
                        ? expression.parts[
                        expression.parts.length - 1
                        ]
                        : expression.name;
                break;

            case 'MemberExpression':
                sourceName =
                    expression.property;
                break;

            case 'WildcardExpression':
                wildcard = true;
                sourceName = '*';
                break;
        }

        // -------------------------------------------------
        // Output name
        // -------------------------------------------------

        outputName =
            alias ??
            sourceName ??
            'expression';

        // -------------------------------------------------
        // End offset
        // -------------------------------------------------

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
            end: endOffset,
            ...(incomplete
                ? { incomplete: true }
                : {}),
            ...(errors.length
                ? { errors }
                : {})
        };
    }

    private parseExpression(
        precedence: Precedence = Precedence.LOWEST,
        stopTokens?: Set<string>
    ): Expression {
        let left = this.parsePrefix();

        while (this.pos < this.tokens.length) {
            const startPos = this.pos;

            const nextToken = this.peek();

            // RULE #1:
            // hard stop at statement terminator
            if (
                !nextToken ||
                nextToken.type === TokenType.Semicolon
            ) {
                break;
            }

            // RULE #2:
            // normalize DOT token
            const val =
                nextToken.type === TokenType.Dot
                    ? '.'
                    : nextToken.value;

            // RULE #3:
            // statement/query structural boundaries
            //
            // IMPORTANT:
            // only terminate at LOWEST precedence
            // otherwise recursive Pratt parsing breaks.
            if (
                nextToken.type === TokenType.Keyword
            ) {
                // explicit grammar-owned stops
                if (
                    stopTokens?.has(val)
                ) {
                    break;
                }

                // legacy fallback behavior
                if (
                    !stopTokens &&
                    precedence === Precedence.LOWEST &&
                    (
                        STRUCTURAL_KEYWORDS.has(val) ||
                        RESYNC_KEYWORDS.has(val) ||

                        val === 'BEGIN' ||
                        val === 'END' ||
                        val === 'ELSE' ||
                        val === 'CATCH'
                    )
                ) {
                    break;
                }
            }

            const nextPrecedence =
                PRECEDENCE_MAP[val] ??
                Precedence.LOWEST;

            if (
                val === 'WITHIN' &&
                left.type === 'FunctionCall'
            ) {
                const withinGroup =
                    this.parseWithinGroupClause();

                left = {
                    ...left,
                    withinGroup,
                    end:
                        withinGroup.length > 0
                            ? withinGroup[withinGroup.length - 1].end
                            : this.lastConsumedEnd()
                };

                continue;
            }

            // RULE #4:
            // Pratt precedence termination
            if (nextPrecedence <= precedence) {
                break;
            }

            // consume operator
            const operatorToken =
                this.consume();

            const operator =
                operatorToken.value;

            // -------------------------------------------------
            // IS [NOT] NULL
            // -------------------------------------------------

            if (val === 'IS') {
                let isNot = false;

                if (this.peek()?.value === 'NOT') {
                    this.consume();
                    isNot = true;
                }

                const nullToken =
                    this.matchValue('NULL');

                left = {
                    type: 'UnaryExpression',
                    operator: isNot
                        ? 'IS NOT NULL'
                        : 'IS NULL',
                    right: left,
                    start: left.start,
                    end:
                        nullToken.offset +
                        nullToken.value.length
                };
            }

            // -------------------------------------------------
            // NOT IN / NOT BETWEEN / NOT LIKE / prefix NOT
            // -------------------------------------------------

            else if (val === 'NOT') {
                const next =
                    this.peek();

                const nextVal =
                    next?.value;

                // NOT IN
                if (nextVal === 'IN') {
                    this.consume();

                    left =
                        this.parseInExpression(
                            left,
                            true
                        );
                }

                // NOT BETWEEN
                else if (
                    nextVal === 'BETWEEN'
                ) {
                    this.consume();

                    left =
                        this.parseBetweenExpression(
                            left,
                            true,
                            nextPrecedence
                        );
                }

                // NOT LIKE
                else if (
                    nextVal === 'LIKE'
                ) {
                    this.consume();

                    const right =
                        this.parseExpression(
                            nextPrecedence, stopTokens
                        );

                    left = {
                        type: 'BinaryExpression',
                        left,
                        operator: 'NOT LIKE',
                        right,
                        start: left.start,
                        end: right.end
                    };
                }

                // prefix NOT
                else {
                    const right =
                        this.parseExpression(
                            Precedence.PREFIX, stopTokens
                        );

                    left = {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right,
                        start:
                            operatorToken.offset,
                        end: right.end
                    };
                }
            }

            // -------------------------------------------------
            // BETWEEN
            // -------------------------------------------------

            else if (val === 'BETWEEN') {
                left =
                    this.parseBetweenExpression(
                        left,
                        false,
                        nextPrecedence
                    );
            }

            // -------------------------------------------------
            // IN
            // -------------------------------------------------

            else if (val === 'IN') {
                left =
                    this.parseInExpression(
                        left,
                        false
                    );
            }

            // -------------------------------------------------
            // COLLATE
            // -------------------------------------------------

            else if (val === 'COLLATE') {
                const collationToken =
                    this.consume();

                left = {
                    type: 'BinaryExpression',
                    left,
                    operator: 'COLLATE',
                    right: {
                        type: 'Literal',
                        value:
                            collationToken.value,
                        variant: 'string',
                        start:
                            collationToken.offset,
                        end:
                            collationToken.offset +
                            collationToken.value.length
                    },
                    start: left.start,
                    end:
                        collationToken.offset +
                        collationToken.value.length
                };
            }

            // -------------------------------------------------
            // Standard binary operators
            // -------------------------------------------------

            else {
                const right =
                    this.parseExpression(
                        nextPrecedence, stopTokens
                    );

                left = {
                    type: 'BinaryExpression',
                    left,
                    operator:
                        operator.toUpperCase(),
                    right,
                    start: left.start,
                    end: right.end
                };
            }

            // RULE #5:
            // infinite loop protection
            if (this.pos === startPos) {
                throw new Error(
                    `Parser stuck at token ${val} (offset: ${nextToken.offset}).`
                );
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

        const token =
            this.consume();

        const value =
            token.value;
        const upperValue =
            value.toUpperCase();

        const start =
            token.offset;

        switch (token.type) {

            // -------------------------------------------------
            // Numeric literal
            // -------------------------------------------------

            case TokenType.Number:

                return {
                    type: 'Literal',
                    value: Number(value),
                    variant: 'number',
                    start,
                    end: start + value.length
                };

            // -------------------------------------------------
            // Variable
            // -------------------------------------------------

            case TokenType.Variable:

                return {
                    type: 'Variable',
                    name: value,
                    start,
                    end: start + value.length
                };

            // -------------------------------------------------
            // String literal
            // -------------------------------------------------

            case TokenType.String: {

                const content =
                    value.startsWith("'") &&
                        value.endsWith("'")
                        ? value.substring(
                            1,
                            value.length - 1
                        )
                        : value;

                return {
                    type: 'Literal',
                    value: content,
                    variant: 'string',
                    start,
                    end: start + value.length
                };
            }

            // -------------------------------------------------
            // Temp table
            // -------------------------------------------------

            case TokenType.TempTable:

                return this.parseMultipartIdentifier(token);

            // -------------------------------------------------
            // Operators
            // -------------------------------------------------

            case TokenType.Operator:

                // wildcard
                if (value === '*') {

                    return {
                        type:
                            'WildcardExpression',
                        start,
                        end: start + 1
                    } as WildcardExpression;
                }

                // folded negative number
                if (value === '-') {

                    const next =
                        this.peek();

                    if (
                        next?.type ===
                        TokenType.Number
                    ) {

                        const numToken =
                            this.consume();

                        return {
                            type: 'Literal',
                            value: Number(
                                `-${numToken.value}`
                            ),
                            variant: 'number',
                            start,
                            end:
                                numToken.offset +
                                numToken.value.length
                        };
                    }

                    // unary minus
                    const right =
                        this.parseExpression(
                            Precedence.PREFIX
                        );

                    return {
                        type: 'UnaryExpression',
                        operator: '-',
                        right,
                        start,
                        end: right.end
                    };
                }

                // unary plus
                if (value === '+') {

                    const next =
                        this.peek();

                    if (
                        next?.type ===
                        TokenType.Number
                    ) {

                        const numToken =
                            this.consume();

                        return {
                            type: 'Literal',
                            value: Number(
                                numToken.value
                            ),
                            variant: 'number',
                            start,
                            end:
                                numToken.offset +
                                numToken.value.length
                        };
                    }

                    const right =
                        this.parseExpression(
                            Precedence.PREFIX
                        );

                    return {
                        type: 'UnaryExpression',
                        operator: '+',
                        right,
                        start,
                        end: right.end
                    };
                }

                // bitwise not
                if (value === '~') {

                    const right =
                        this.parseExpression(
                            Precedence.PREFIX
                        );

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

            // -------------------------------------------------
            // IDENTIFIERS + EXPRESSION KEYWORDS
            // -------------------------------------------------

            case TokenType.Identifier:
            case TokenType.Keyword: {

                // ---------------------------------------------
                // Dedicated keyword expressions FIRST
                // ---------------------------------------------

                // NULL literal
                if (upperValue === 'NULL') {

                    return {
                        type: 'Literal',
                        value: null,
                        variant: 'null',
                        start,
                        end: start + value.length
                    };
                }

                // CASE expression
                if (upperValue === 'CASE') {
                    return this.parseCaseExpression();
                }

                // EXISTS (...)
                if (upperValue === 'EXISTS') {
                    return this.parseExists(token);
                }

                // CAST / TRY_CAST / CONVERT / PARSE / TRY_PARSE
                if (
                    upperValue === 'CAST' ||
                    upperValue === 'TRY_CAST' ||
                    upperValue === 'CONVERT' ||
                    upperValue === 'PARSE' ||
                    upperValue === 'TRY_PARSE'
                ) {

                    this.pos--;

                    return this.parseCastExpression();
                }

                // NOT / NOT EXISTS
                if (upperValue === 'NOT') {

                    // NOT EXISTS (...)
                    if (
                        this.peekKeyword('EXISTS')
                    ) {

                        const existsToken =
                            this.consume();

                        const existsExpr =
                            this.parseExists(
                                existsToken
                            );

                        return {
                            type: 'UnaryExpression',
                            operator: 'NOT',
                            right: existsExpr,
                            start,
                            end: existsExpr.end
                        };
                    }

                    // generic NOT
                    const right =
                        this.parseExpression(
                            Precedence.NOT
                        );

                    return {
                        type: 'UnaryExpression',
                        operator: 'NOT',
                        right,
                        start,
                        end: right.end
                    };
                }

                const canBeFunctionCall =
                    this.peek()?.type ===
                    TokenType.OpenParen;

                if (
                    token.type === TokenType.Keyword &&
                    canBeFunctionCall &&
                    (
                        RESYNC_KEYWORDS.has(value) ||
                        STRUCTURAL_KEYWORDS.has(value)
                    )
                ) {
                    return this.parseTableValuedFunction({
                        type: 'Identifier',
                        name: value,
                        parts: [value],
                        start,
                        end: start + value.length
                    });
                }

                // ---------------------------------------------
                // Reject statement keywords unless they are
                // being used as function names like LEFT(...)
                // ---------------------------------------------

                if (
                    token.type === TokenType.Keyword &&
                    !canBeFunctionCall &&
                    (
                        RESYNC_KEYWORDS.has(value) ||
                        STRUCTURAL_KEYWORDS.has(value)
                    )
                ) {
                    this.pos--;

                    throw new Error(
                        `Unexpected keyword in expression: ${value}`
                    );
                }

                // ---------------------------------------------
                // Multipart identifier
                // ---------------------------------------------

                this.pos--;

                const idNode =
                    this.parseMultipartIdentifier();

                // ---------------------------------------------
                // Function call
                // ---------------------------------------------

                if (
                    this.peek()?.type ===
                    TokenType.OpenParen
                ) {

                    this.consume(); // (

                    const args:
                        Expression[] = [];
                    let distinct = false;

                    if (
                        idNode.type !==
                        'Identifier'
                    ) {
                        throw new Error(
                            'Wildcards cannot be used as function names'
                        );
                    }

                    if (
                        this.peekKeyword(
                            'DISTINCT'
                        )
                    ) {
                        this.consume();
                        distinct = true;
                    }

                    // subquery arg
                    if (
                        this.peekKeyword(
                            'SELECT'
                        )
                    ) {

                        const subquery = this.parseSelect() as QueryStatement;

                        const closeParen =
                            this.match(
                                TokenType.CloseParen
                            );

                        args.push({
                            type:
                                'SubqueryExpression',
                            query: subquery,
                            start:
                                subquery.start,
                            end:
                                closeParen.offset +
                                closeParen.value.length
                        });
                    }

                    // normal args
                    else {

                        args.push(
                            ...this.parseList(() =>
                                this.parseExpression(
                                    Precedence.LOWEST
                                )
                            )
                        );
                    }

                    const closeParen =
                        this.match(
                            TokenType.CloseParen
                        );

                    let result:
                        Expression = {

                        type:
                            'FunctionCall',

                        name:
                            idNode.name,

                        args,

                        ...(distinct
                            ? { distinct: true }
                            : {}),

                        start:
                            idNode.start,

                        end:
                            closeParen.offset +
                            closeParen.value.length
                    };

                    // window function
                    if (
                        this.peekKeyword(
                            'OVER'
                        )
                    ) {
                        result =
                            this.parseOverClause(
                                result
                            );
                    }

                    return result;
                }

                return idNode;
            }

            // -------------------------------------------------
            // Parentheses
            // -------------------------------------------------

            case TokenType.OpenParen:

                // subquery
                if (
                    this.peekKeyword(
                        'SELECT'
                    )
                ) {

                    const query = this.parseSelect() as QueryStatement;

                    const closeParen =
                        this.match(
                            TokenType.CloseParen
                        );

                    return {
                        type:
                            'SubqueryExpression',
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
                    this.match(
                        TokenType.CloseParen
                    );

                return {
                    type:
                        'GroupingExpression',
                    expression: inner,
                    start,
                    end:
                        closeParen.offset +
                        closeParen.value.length
                } satisfies GroupingExpression;

            // -------------------------------------------------
            // Fallback
            // -------------------------------------------------

            default:

                if (
                    token.type === TokenType.Semicolon ||
                    token.type === TokenType.CloseParen ||
                    token.type === TokenType.Comma
                ) {
                    this.pos--;
                }

                throw new Error(
                    `Unexpected token at line ${token.line}: ${token.value} (${TokenType[token.type]})`
                );
        }
    }

    /**
     * Helper to keep parsePrefix clean
     */
    private parseExists(
        existsToken: Token
    ): ExistsExpression {

        // EXISTS (
        this.match(
            TokenType.OpenParen
        );

        // subquery
        const subquery =
            this.parseSelect() as QueryStatement;

        // )
        const closeParen =
            this.match(
                TokenType.CloseParen
            );

        return {
            type: 'ExistsExpression',
            query: subquery,
            start: existsToken.offset,
            end:
                closeParen.offset +
                closeParen.value.length
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

    private canStartExpressionToken(token: Token | undefined): boolean {
        if (!token) {
            return false;
        }

        if (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.Comma
        ) {
            return false;
        }

        if (
            token.type === TokenType.Keyword &&
            this.isStructuralKeyword(token.value)
        ) {
            return this.peek(1)?.type === TokenType.OpenParen;
        }

        return !RESYNC_KEYWORDS.has(token.value);
    }

    private parseCaseExpression(): Expression {
        // CASE token already consumed
        const startToken =
            this.tokens[this.pos - 1];

        const startOffset =
            startToken.offset;

        let incomplete = false;

        let input:
            | Expression
            | undefined = undefined;

        const branches: {
            when: Expression;
            then: Expression;
        }[] = [];

        let elseBranch:
            | Expression
            | undefined = undefined;

        // -------------------------------------------------
        // Simple CASE input
        // -------------------------------------------------

        try {
            if (
                this.peek()?.value !== 'WHEN'
            ) {
                input =
                    this.parseExpression(
                        Precedence.LOWEST,
                        new Set(['WHEN'])
                    );
            }
        }
        catch {
            incomplete = true;

            this.resyncToCaseBoundary();
        }

        // -------------------------------------------------
        // WHEN / THEN branches
        // -------------------------------------------------

        while (
            this.peek()?.value === 'WHEN'
        ) {
            this.consume(); // WHEN

            let when: Expression;
            let then: Expression;

            // -----------------------------
            // WHEN expression
            // -----------------------------

            try {
                when =
                    this.parseExpression(
                        Precedence.LOWEST,
                        new Set(['THEN'])
                    );
            }
            catch {
                incomplete = true;

                this.resyncToCaseBoundary();

                when = {
                    type: 'Identifier',
                    name: '__ERROR__',
                    parts: ['__ERROR__'],
                    start: this.peek()?.offset ?? startOffset,
                    end: this.peek()?.offset ?? startOffset
                };
            }

            // -----------------------------
            // THEN
            // -----------------------------

            try {
                this.matchKeyword('THEN');
            }
            catch {
                incomplete = true;

                this.addIssue(
                    'PARSE_CASE_THEN',
                    'Expected THEN in CASE expression',
                    this.peek()?.offset ?? startOffset,
                    this.peek()?.offset ?? startOffset
                );

                this.resyncToCaseBoundary();
            }

            // -----------------------------
            // THEN expression
            // -----------------------------

            if (
                !this.peek() ||
                this.peek()?.type === TokenType.Semicolon ||
                (
                    this.peek()?.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(this.peek()!.value)
                )
            ) {
                incomplete = true;

                then = {
                    type: 'Identifier',
                    name: '__ERROR__',
                    parts: ['__ERROR__'],
                    start: this.peek()?.offset ?? startOffset,
                    end: this.peek()?.offset ?? startOffset
                };

                branches.push({
                    when,
                    then
                });

                break;
            }
            else {
                try {
                    then =
                        this.parseExpression(
                            Precedence.LOWEST,
                            new Set([
                                'WHEN',
                                'ELSE',
                                'END'
                            ])
                        );
                }
                catch {
                    incomplete = true;

                    this.resyncToCaseBoundary();

                    then = {
                        type: 'Identifier',
                        name: '__ERROR__',
                        parts: ['__ERROR__'],
                        start: this.peek()?.offset ?? startOffset,
                        end: this.peek()?.offset ?? startOffset
                    };
                }
            }

            branches.push({
                when,
                then
            });
        }

        // -------------------------------------------------
        // ELSE branch
        // -------------------------------------------------

        if (
            this.peek()?.value === 'ELSE'
        ) {
            this.consume(); // ELSE

            try {
                elseBranch =
                    this.parseExpression(
                        Precedence.LOWEST,
                        new Set(['END'])
                    );
            }
            catch {
                incomplete = true;

                this.resyncToCaseBoundary();
            }
        }

        // -------------------------------------------------
        // END
        // -------------------------------------------------

        let endOffset =
            startOffset;

        try {
            const endToken =
                this.matchKeyword('END');

            endOffset =
                endToken.offset +
                endToken.value.length;
        }
        catch {
            incomplete = true;

            // preserve outer parser state
            const current =
                this.peek();

            if (current) {
                endOffset =
                    current.offset;
            }
        }

        // -------------------------------------------------
        // Final node
        // -------------------------------------------------

        return {
            type: 'CaseExpression',
            input,
            branches,
            elseBranch,
            start: startOffset,
            end: endOffset,
            ...(incomplete
                ? { incomplete: true }
                : {})
        };
    }

    private parseList<T>(
        parserFn: () => T,
        options?: {
            isBoundary?: (token?: Token) => boolean;
        }
    ): T[] {

        const list: T[] = [];
        const isBoundary =
            options?.isBoundary ??
            this.isDefaultListBoundary.bind(this);

        // ---------------------------------------------
        // Empty list
        // ---------------------------------------------

        if (
            isBoundary(
                this.peek()
            )
        ) {
            return list;
        }

        // ---------------------------------------------
        // Parse recoverably
        // ---------------------------------------------

        while (
            this.pos < this.tokens.length
        ) {

            const beforePos =
                this.pos;

            try {

                const item =
                    parserFn();

                list.push(item);
            }

            catch {

                // -------------------------------------
                // Recovery:
                // move to next comma or clause boundary
                // -------------------------------------

                this.resyncToBoundary(
                    isBoundary
                );

                // no forward progress possible
                if (
                    this.pos === beforePos
                ) {
                    break;
                }
            }

            // -----------------------------------------
            // Comma continuation
            // -----------------------------------------

            if (
                this.peek()?.type ===
                TokenType.Comma
            ) {

                this.consume();

                // trailing comma
                if (
                    isBoundary(
                        this.peek()
                    )
                ) {
                    break;
                }

                continue;
            }

            break;
        }

        return list;
    }

    private isIdentifierListBoundary(
        token?: Token
    ): boolean {
        return (
            !token ||
            token.type === TokenType.CloseParen
        );
    }

    private isDefaultListBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen
        ) {
            return true;
        }

        if (
            token === this.peek() &&
            token.type === TokenType.Keyword &&
            this.peek(1)?.type === TokenType.OpenParen
        ) {
            return false;
        }

        return (
            token.type === TokenType.Keyword &&
            (
                STRUCTURAL_KEYWORDS.has(token.value) ||
                RESYNC_KEYWORDS.has(token.value)
            )
        );
    }

    private isParameterListBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen
        ) {
            return true;
        }

        return (
            token.type === TokenType.Keyword &&
            (
                token.value === 'AS' ||
                token.value === 'RETURNS'
            )
        );
    }

    private isCreateIndexIncludeBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen
        ) {
            return true;
        }

        return (
            token.type === TokenType.Keyword &&
            (
                token.value === 'WHERE' ||
                token.value === 'WITH' ||
                token.value === 'OPTION'
            )
        );
    }

    private isIndexOptionBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        return (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen
        );
    }

    private isCteColumnListBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (
            token.type === TokenType.Semicolon ||
            token.type === TokenType.CloseParen
        ) {
            return true;
        }

        return (
            token.type === TokenType.Keyword &&
            token.value === 'AS'
        );
    }

    private isTableDefinitionRecoveryBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        return (
            token.type === TokenType.Comma ||
            token.type === TokenType.CloseParen ||
            token.type === TokenType.Semicolon ||
            (
                token.type === TokenType.Keyword &&
                RESYNC_KEYWORDS.has(token.value)
            )
        );
    }

    private parseIf(): IfNode {
        const startToken =
            this.matchKeyword('IF');

        let incomplete = false;

        const errors: string[] = [];

        let condition:
            | Expression
            | null = null;

        let thenBranch:
            | Statement
            | null = null;

        let elseBranch:
            | Statement
            | undefined;

        let endOffset =
            startToken.offset +
            startToken.value.length;

        try {
            const next =
                this.peek();

            if (
                next &&
                next.type !==
                TokenType.Semicolon &&
                !this.isStructuralKeyword(
                    next.value
                )
            ) {
                condition =
                    this.parseExpression(
                        Precedence.LOWEST,
                        new Set([
                            'BEGIN',
                            'ELSE',
                            'END'
                        ])
                    );

                if (condition) {
                    endOffset =
                        condition.end;
                }

                if (
                    condition.type === 'Identifier' &&
                    condition.name === 'SELECT'
                ) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_IF_CONDITION',
                        'Incomplete IF condition',
                        condition.start,
                        condition.end
                    );
                }
            }
            else {
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
                e instanceof Error
                    ? e.message
                    : String(e),
                startToken.offset,
                endOffset
            );
        }

        try {
            const stmt =
                this.parseStatement();

            if (stmt) {
                thenBranch = stmt;
                endOffset = stmt.end;

                if ((stmt as any).incomplete) {
                    incomplete = true;
                }
            }

            else {
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
                e instanceof Error
                    ? e.message
                    : String(e),
                endOffset
            );
        }

        if (this.peekKeyword('ELSE')) {
            const elseToken =
                this.consume();

            try {
                const stmt =
                    this.parseStatement();

                if (stmt) {
                    elseBranch = stmt;
                    endOffset = stmt.end;

                    if ((stmt as any).incomplete) {
                        incomplete = true;
                    }
                }

                else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        'PARSE_IF_ELSE',
                        'Expected statement after ELSE',
                        elseToken.offset,
                        elseToken.offset +
                        elseToken.value.length
                    );
                }

            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_IF_ELSE',
                    e instanceof Error
                        ? e.message
                        : String(e),
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
            ...(incomplete
                ? { incomplete: true }
                : {}),
            ...(errors.length
                ? { errors }
                : {})
        };
    }

    private parseBlock(): BlockNode {
        const startToken = this.matchKeyword('BEGIN');

        let incomplete = false;
        const errors: string[] = [];

        const body: Statement[] = [];

        let endOffset =
            startToken.offset +
            startToken.value.length;

        while (
            this.pos < this.tokens.length &&
            !this.peekKeyword('END')
        ) {
            try {
                const beforePos = this.pos;
                const stmt = this.parseStatement();

                if (stmt) {
                    body.push(stmt);
                    endOffset = stmt.end;
                }
                else {
                    if (this.pos > beforePos) {
                        continue;
                    }

                    if (
                        this.peekKeyword('END') ||
                        this.peekKeyword('ELSE') ||
                        this.peekKeyword('CATCH')
                    ) {
                        break;
                    }

                    if (
                        this.peek()?.type ===
                        TokenType.Semicolon
                    ) {
                        this.consume();
                        continue;
                    }

                    break;
                }
            }
            catch {
                incomplete = true;

                this.resyncToBlockBoundary();
            }
        }

        try {
            if (this.peekKeyword('END')) {
                const endToken =
                    this.consume();

                endOffset =
                    endToken.offset +
                    endToken.value.length;
            }

            else {
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
                e instanceof Error
                    ? e.message
                    : String(e),
                endOffset
            );
        }

        return {
            type: 'BlockStatement',
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

    private parseWith(): WithNode {
        // Capture the 'WITH' token that was just peeked/consumed
        const startToken = this.matchKeyword('WITH');
        const ctes: CTENode[] = [];
        let incomplete = false;
        const errors: string[] = [];

        while (true) {
            // Use the multipart identifier for the CTE name
            const nameExpr = this.parseMultipartIdentifier();
            let columns: string[] | undefined = undefined;
            let name = '*';

            // Validation: CTE names must be identifiers, not wildcards
            if (nameExpr.type === 'Identifier') {
                name = nameExpr.name;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_WITH_CTE_NAME',
                    'Wildcards are not allowed as CTE names',
                    nameExpr.start,
                    nameExpr.end
                );
            }

            // Optional column list: WITH MyCTE (Col1, Col2)
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume();
                columns = this.parseList(() => {
                    const columnExpr =
                        this.parseMultipartIdentifier(
                            undefined,
                            { allowStructuralFirstSegment: true }
                        );

                    if (
                        columnExpr.type === 'Identifier' &&
                        columnExpr.name
                    ) {
                        return columnExpr.name;
                    }

                    throw new Error(
                        'Expected identifier in CTE column list'
                    );
                }, {
                    isBoundary:
                        this.isIdentifierListBoundary.bind(this)
                });
                this.match(TokenType.CloseParen);
            }

            this.matchKeyword('AS');
            this.match(TokenType.OpenParen);

            // Parse the CTE query
            const query = this.parseQueryExpression() as QueryStatement;
            const closeParen = this.match(TokenType.CloseParen);

            ctes.push({
                name,
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
        const bodyStart = this.peek()?.offset ?? this.lastConsumedEnd();
        let body = this.parseStatement();

        if (!body) {
            incomplete = true;

            const message =
                'A Common Table Expression (CTE) must be followed by a query or DML statement.';

            this.addRecoverableError(
                errors,
                'PARSE_WITH_BODY',
                message,
                bodyStart,
                bodyStart + 1
            );

            body = {
                type: 'ErrorStatement',
                message,
                start: bodyStart,
                end: bodyStart + 1
            };
        }

        return {
            type: 'WithStatement',
            ctes,
            body,
            start: startToken.offset,
            end: body.end,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseOverClause(expr: Expression): OverExpression {
        const overToken = this.matchKeyword('OVER');
        this.match(TokenType.OpenParen);

        const windowStart = overToken.offset;
        let windowIncomplete = false;
        const windowErrors: string[] = [];

        let partitionBy: Expression[] | undefined = undefined;
        if (this.peekKeyword('PARTITION')) {
            try {
                this.consume(); // PARTITION
                this.matchKeyword('BY');
                partitionBy = this.parseList(() => this.parseExpression());
            } catch (e) {
                windowIncomplete = true;
                this.addRecoverableError(
                    windowErrors,
                    'PARSE_OVER_PARTITION_BY',
                    e instanceof Error ? e.message : String(e),
                    this.lastConsumedEnd()
                );
            }
        }

        let orderBy: OrderByNode[] | undefined = undefined;
        if (this.peekKeyword('ORDER')) {
            try {
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
            } catch (e) {
                windowIncomplete = true;
                this.addRecoverableError(
                    windowErrors,
                    'PARSE_OVER_ORDER_BY',
                    e instanceof Error ? e.message : String(e),
                    this.lastConsumedEnd()
                );
            }
        }

        // Frame clause — ROWS|RANGE BETWEEN ... AND ... or ROWS|RANGE <boundary>
        let frame: FrameClause | undefined = undefined;
        if (this.peekKeyword('ROWS') || this.peekKeyword('RANGE')) {
            frame = this.parseFrameClause();
            if (frame.incomplete) {
                windowIncomplete = true;
                windowErrors.push(...(frame.errors ?? []));
            }
        }

        // Defensive close paren — frame error recovery may have consumed it
        // or the user may have an unclosed OVER clause mid-edit
        let windowEnd = this.lastConsumedEnd();
        if (this.peek()?.type === TokenType.CloseParen) {
            const closeParen = this.consume();
            windowEnd = closeParen.offset + closeParen.value.length;
        } else {
            windowIncomplete = true;
            this.addRecoverableError(
                windowErrors,
                'PARSE_OVER_CLOSE_PAREN',
                'Expected ) to close OVER clause',
                windowEnd
            );
        }

        const window: WindowDefinition = {
            type: 'WindowDefinition',
            partitionBy,
            orderBy,
            ...(frame ? { frame } : {}),
            start: windowStart,
            end: windowEnd,
            ...(windowIncomplete ? { incomplete: true } : {}),
            ...(windowErrors.length ? { errors: windowErrors } : {}),
        };

        return {
            type: 'OverExpression',
            expression: expr,
            window,
            start: expr.start,
            end: windowEnd
        };
    }

    private parseFrameClause(): FrameClause {
        const unitToken = this.consume(); // ROWS or RANGE
        const unit = unitToken.value.toUpperCase() as FrameUnit;
        let frameEnd = unitToken.offset + unitToken.value.length;
        let incomplete = false;
        const errors: string[] = [];

        let from: FrameBoundary | null = null;
        let to: FrameBoundary | undefined = undefined;

        if (this.peekKeyword('BETWEEN')) {
            this.consume(); // BETWEEN
            frameEnd = this.lastConsumedEnd();

            // parse start boundary
            try {
                const result = this.parseFrameBoundary();
                from = result.boundary;
                frameEnd = result.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_FRAME_START_BOUNDARY',
                    e instanceof Error ? e.message : String(e),
                    frameEnd,
                    frameEnd
                );
            }

            // AND
            if (this.peekKeyword('AND')) {
                this.consume();
                frameEnd = this.lastConsumedEnd();

                // parse end boundary
                try {
                    const result = this.parseFrameBoundary();
                    to = result.boundary;
                    frameEnd = result.end;
                } catch (e) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_FRAME_END_BOUNDARY',
                        e instanceof Error ? e.message : String(e),
                        frameEnd,
                        frameEnd
                    );
                }
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_FRAME_AND',
                    'Expected AND in frame clause BETWEEN',
                    frameEnd,
                    frameEnd
                );

                // Recovery: if the user omitted AND but immediately wrote a
                // valid end boundary, consume it so the OVER clause can still
                // close cleanly and outer statement parsing stays aligned.
                if (this.canStartFrameBoundary(this.peek())) {
                    try {
                        const result = this.parseFrameBoundary();
                        to = result.boundary;
                        frameEnd = result.end;
                    } catch {
                        // Keep the original AND error only.
                    }
                }
            }

        } else {
            // single boundary form: ROWS UNBOUNDED PRECEDING etc.
            const next = this.peek();
            if (
                !next ||
                next.type === TokenType.CloseParen ||
                next.type === TokenType.Semicolon ||
                (next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value))
            ) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_FRAME_BOUNDARY',
                    'Expected frame boundary after ROWS/RANGE',
                    frameEnd,
                    frameEnd
                );
            } else {
                try {
                    const result = this.parseFrameBoundary();
                    from = result.boundary;
                    frameEnd = result.end;
                } catch (e) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_FRAME_BOUNDARY',
                        e instanceof Error ? e.message : String(e),
                        frameEnd,
                        frameEnd
                    );
                }
            }
        }

        return {
            type: 'FrameClause',
            unit,
            from,
            ...(to ? { to } : {}),
            start: unitToken.offset,
            end: frameEnd,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    private parseFrameBoundary(): { boundary: FrameBoundary; end: number } {
        const next = this.peek();

        if (!next) {
            throw new Error('Expected frame boundary');
        }

        // UNBOUNDED PRECEDING | UNBOUNDED FOLLOWING
        if (this.peekKeyword('UNBOUNDED')) {
            const unboundedToken = this.consume();
            const end = unboundedToken.offset + unboundedToken.value.length;

            if (this.peekKeyword('PRECEDING')) {
                const t = this.consume();
                return {
                    boundary: { type: 'UNBOUNDED_PRECEDING' },
                    end: t.offset + t.value.length
                };
            } else if (this.peekKeyword('FOLLOWING')) {
                const t = this.consume();
                return {
                    boundary: { type: 'UNBOUNDED_FOLLOWING' },
                    end: t.offset + t.value.length
                };
            } else {
                throw new Error('Expected PRECEDING or FOLLOWING after UNBOUNDED');
            }
        }

        // CURRENT ROW
        if (this.peekKeyword('CURRENT')) {
            this.consume();
            const rowToken = this.matchKeyword('ROW');
            return {
                boundary: { type: 'CURRENT_ROW' },
                end: rowToken.offset + rowToken.value.length
            };
        }

        // <expr> PRECEDING | <expr> FOLLOWING
        const value = this.parseExpression();

        if (this.peekKeyword('PRECEDING')) {
            const t = this.consume();
            return {
                boundary: { type: 'PRECEDING', value },
                end: t.offset + t.value.length
            };
        } else if (this.peekKeyword('FOLLOWING')) {
            const t = this.consume();
            return {
                boundary: { type: 'FOLLOWING', value },
                end: t.offset + t.value.length
            };
        } else {
            throw new Error('Expected PRECEDING or FOLLOWING after frame expression');
        }
    }

    private canStartFrameBoundary(token?: Token): boolean {
        if (!token) {
            return false;
        }

        if (this.peekKeyword('UNBOUNDED') || this.peekKeyword('CURRENT')) {
            return true;
        }

        if (
            token.type === TokenType.CloseParen ||
            token.type === TokenType.Semicolon
        ) {
            return false;
        }

        if (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value)) {
            return false;
        }

        return true;
    }

    private hasName(expr: Expression): expr is (IdentifierNode | MemberExpression) & Expression {
        return expr.type === 'Identifier' || expr.type === 'MemberExpression';
    }

    private lastConsumedEnd(): number {
        const last = this.tokens[this.pos - 1];
        if (!last) return 0;
        return last.offset + last.value.length;
    }

    private parseQueryExpression(): QueryStatement {
        const left = this.parseSelect();
        return this.parseSetOperation(left);
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

                // statement boundary — DECLARE, SELECT, IF, CREATE etc.
                if (
                    token.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(value)
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
                            const node = this.parseMultipartIdentifier(
                                undefined,
                                { allowStructuralFirstSegment: true }
                            );
                            if (node.type === 'Identifier') return node;
                            throw new Error(
                                'Wildcards are not allowed in an OUTPUT INTO column list'
                            );
                        }, {
                            isBoundary:
                                this.isIdentifierListBoundary.bind(this)
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
        return stringifyExpressionNode(expr);
    }

    private resync(): void {
        // 1. Always move forward at least one token to avoid infinite loops
        this.consume();

        // 2. Skip tokens until we find a semicolon or a major statement keyword
        while (this.pos < this.tokens.length) {
            const val = this.peek()?.value;
            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
                break;
            }
            if (RESYNC_KEYWORDS.has(val!)) break;
            this.consume();
        }
    }

    private parseMerge(): MergeNode {
        const startToken = this.matchKeyword('MERGE');

        let incomplete = false;
        const errors: string[] = [];
        let endOffset =
            startToken.offset + startToken.value.length;

        let top: TopClause | null = null;
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
            const topToken = this.consume();
            let topEnd =
                topToken.offset + topToken.value.length;
            const topErrors: string[] = [];
            let topIncomplete = false;

            const hasParens =
                this.peek()?.type === TokenType.OpenParen;

            if (hasParens) {
                this.consume();
            }

            try {
                const next = this.peek();
                let quantity: Expression | null = null;

                if (
                    !next ||
                    next.type === TokenType.Semicolon ||
                    (
                        next.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(next.value)
                    )
                ) {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_MERGE_TOP',
                        'Expected TOP value',
                        topEnd,
                        topEnd
                    );
                } else if (hasParens && next.type === TokenType.CloseParen) {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_MERGE_TOP',
                        'Expected TOP value',
                        topEnd,
                        topEnd
                    );
                } else if (hasParens) {
                    quantity = this.parseExpression();
                    topEnd = quantity.end;
                } else {
                    const quantityToken = this.consume();
                    const numVal = Number(quantityToken.value);
                    quantity = {
                        type: 'Literal',
                        variant:
                            numVal !== numVal
                                ? 'string'
                                : 'number',
                        value:
                            numVal !== numVal
                                ? quantityToken.value
                                : numVal,
                        start: quantityToken.offset,
                        end:
                            quantityToken.offset +
                            quantityToken.value.length,
                    };
                    topEnd = quantity.end;
                }

                top = {
                    type: 'TopClause',
                    quantity,
                    percent: false,
                    withTies: false,
                    start: topToken.offset,
                    end: topEnd,
                    ...(topIncomplete ? { incomplete: true } : {}),
                    ...(topErrors.length ? { errors: topErrors } : {}),
                };
                endOffset = top.end;
            } catch {
                topIncomplete = true;
                this.addRecoverableError(
                    topErrors,
                    'PARSE_MERGE_TOP',
                    'Expected TOP value',
                    topEnd,
                    topEnd
                );

                top = {
                    type: 'TopClause',
                    quantity: null,
                    percent: false,
                    withTies: false,
                    start: topToken.offset,
                    end: topEnd,
                    incomplete: true,
                    errors: topErrors,
                };
                endOffset = top.end;
            }

            if (hasParens) {
                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                    if (top) {
                        top.end = endOffset;
                    }
                } else {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        'PARSE_MERGE_TOP_CLOSE_PAREN',
                        'Expected ) after TOP expression',
                        topEnd,
                        topEnd
                    );
                    if (top) {
                        top.incomplete = true;
                        top.errors = topErrors;
                    }
                }
            }
        }

        // ------------------------------------------------------------
        // TARGET
        // MERGE [INTO] dbo.Table WITH (...) AS t
        // ------------------------------------------------------------
        try {
            if (this.peekKeyword('INTO')) {
                this.consume();
                endOffset = this.lastConsumedEnd();
            }

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

        let optionClause: OptionClause | null = null;

        if (this.peekKeyword('OPTION')) {
            try {
                optionClause = this.parseOptionClause();
                endOffset = optionClause.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_MERGE_OPTION',
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
            ...(optionClause ? { optionClause } : {}),
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
                    endOffset = this.lastConsumedEnd();

                    if (this.peekKeyword('SOURCE')) {
                        this.consume();
                        condition = 'NOT MATCHED BY SOURCE';
                        endOffset = this.lastConsumedEnd();
                    } else if (this.peekKeyword('TARGET')) {
                        this.consume();
                        condition = 'NOT MATCHED BY TARGET';
                        endOffset = this.lastConsumedEnd();
                    } else {
                        throw new Error(
                            'Expected SOURCE or TARGET after BY in MERGE clause'
                        );
                    }
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
            !this.isStructuralKeyword(this.peek()!.value) &&
            !RESYNC_KEYWORDS.has(this.peek()!.value)
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
                    let isOutput = false;

                    if (this.peek()) {
                        value = this.parseExpression();
                        endOffset = value.end;

                        while (this.peekKeyword('OUTPUT') || this.peekKeyword('OUT')) {
                            isOutput = true;
                            this.consume();
                            endOffset = this.lastConsumedEnd();
                        }
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
                        value,
                        ...(isOutput ? { isOutput: true } : {})
                    });

                    continue;
                }

                // positional:
                // EXEC proc 1, 'abc'
                const value = this.parseExpression();
                let isOutput = false;

                while (this.peekKeyword('OUTPUT') || this.peekKeyword('OUT')) {
                    isOutput = true;
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                }

                args.push({
                    value,
                    ...(isOutput ? { isOutput: true } : {})
                });
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
            keyword.value.toUpperCase() as
            | 'CAST'
            | 'TRY_CAST'
            | 'CONVERT'
            | 'PARSE'
            | 'TRY_PARSE';

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
        let style: Expression | null = null;
        let culture: Expression | null = null;

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

                        if (this.peek()?.type === TokenType.Comma) {
                            this.consume(); // ,
                            end = this.lastConsumedEnd();

                            if (this.peek()) {
                                style =
                                    this.parseExpression();
                                end = style.end;
                            }
                        }
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
                    ...(style ? { style } : {}),
                    start,
                    end,
                    ...(incomplete ? { incomplete: true } : {}),
                    ...(errors.length ? { errors } : {})
                };
            }

            // --------------------------------
            // CAST(expr AS type)
            // TRY_CAST(expr AS type)
            // PARSE(expr AS type [USING culture])
            // TRY_PARSE(expr AS type [USING culture])
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
                    this.parseDataTypeName(
                        kind === 'PARSE' || kind === 'TRY_PARSE'
                            ? ['USING']
                            : []
                    );
                end = this.lastConsumedEnd();

                if (
                    (kind === 'PARSE' || kind === 'TRY_PARSE') &&
                    this.peekKeyword('USING')
                ) {
                    this.consume();
                    end = this.lastConsumedEnd();

                    if (this.peek()) {
                        culture = this.parseExpression();
                        end = culture.end;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            'PARSE_CAST_USING',
                            `Expected culture expression after USING in ${kind}`,
                            end,
                            end
                        );
                    }
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
            ...(style ? { style } : {}),
            ...(culture ? { culture } : {}),
            start,
            end,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDataTypeName(stopKeywords: string[] = []): string {
        const parts: string[] = [];
        let parenDepth = 0;
        const stopSet = new Set(stopKeywords.map(x => x.toUpperCase()));

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
                stopSet.has(token.value.toUpperCase())
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

    private parseConstraintColumnListSafe(): string[] {
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

            const id = this.parseMultipartIdentifier();

            if (id.type !== 'Identifier') {
                break;
            }

            result.push(id.name);

            if (this.peekKeyword('ASC') || this.peekKeyword('DESC')) {
                this.consume();
            }
        }

        return result;
    }

    private looksLikeTableConstraintAfterColumn(): boolean {
        const t0 = this.peek()?.value;
        const t1 = this.peek(1)?.value;
        const t2 = this.peek(2)?.value;
        const t3 = this.peek(3)?.value;

        if (
            t0 === 'PRIMARY' &&
            t1 === 'KEY' &&
            (
                t2 === 'CLUSTERED' ||
                t2 === 'NONCLUSTERED' ||
                t2 === '('
            )
        ) {
            return true;
        }

        if (
            t0 === 'UNIQUE' &&
            (
                t1 === 'CLUSTERED' ||
                t1 === 'NONCLUSTERED' ||
                t1 === '('
            )
        ) {
            return true;
        }

        if (
            t0 === 'FOREIGN' &&
            t1 === 'KEY' &&
            t2 === '('
        ) {
            return true;
        }

        if (
            t0 === 'CONSTRAINT' &&
            (
                (t2 === 'PRIMARY' && t3 === 'KEY') ||
                t2 === 'UNIQUE' ||
                (t2 === 'FOREIGN' && t3 === 'KEY')
            )
        ) {
            return true;
        }

        return false;
    }

    private parseComputedColumnTail(): {
        dataType: string;
        computedExpression?: Expression | null;
        persisted?: boolean;
    } {
        this.matchKeyword('AS');

        let computedExpression: Expression | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            this.consume();
            computedExpression = this.parseExpression(
                Precedence.LOWEST
            );

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
            } else {
                throw new Error(
                    'Expected ) after computed column expression'
                );
            }
        } else {
            computedExpression = this.parseExpression(
                Precedence.LOWEST,
                new Set(['PERSISTED'])
            );
        }

        const persisted = this.peekKeyword('PERSISTED');
        if (persisted) {
            this.consume();
        }

        return {
            dataType: '',
            computedExpression,
            ...(persisted ? { persisted: true } : {})
        };
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

                if (
                    this.peek()?.value === 'CLUSTERED' ||
                    this.peek()?.value === 'NONCLUSTERED'
                ) {
                    this.consume();
                }

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    this.consume();

                    columns =
                        this.parseConstraintColumnListSafe();

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

                if (
                    this.peek()?.value === 'CLUSTERED' ||
                    this.peek()?.value === 'NONCLUSTERED'
                ) {
                    this.consume();
                }

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (
                    this.peek()?.type === TokenType.OpenParen
                ) {
                    this.consume();

                    columns =
                        this.parseConstraintColumnListSafe();

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
            }, {
                isBoundary: this.isCreateIndexIncludeBoundary.bind(this)
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
                }, {
                    isBoundary: this.isCreateIndexIncludeBoundary.bind(this)
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
                }, {
                    isBoundary: this.isIndexOptionBoundary.bind(this)
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
            const beforePos = this.pos;
            const stmt = this.parseStatement();
            if (stmt) {
                tryBody.push(stmt);
                endOffset = stmt.end;
            } else {
                if (this.pos > beforePos) {
                    continue;
                }

                if (this.peek()?.type === TokenType.Semicolon) {
                    this.consume();
                    continue;
                }

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
            const beforePos = this.pos;
            const stmt = this.parseStatement();
            if (stmt) {
                catchBody.push(stmt);
                endOffset = stmt.end;
            } else {
                if (this.pos > beforePos) {
                    continue;
                }

                if (this.peek()?.type === TokenType.Semicolon) {
                    this.consume();
                    continue;
                }

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

    private parseGoto(): GotoNode {
        const token = this.matchKeyword('GOTO');
        let incomplete = false;
        const errors: string[] = [];
        let label: string | null = null;
        let endOffset = token.offset + token.value.length;

        const next = this.peek();

        if (
            next &&
            (
                next.type === TokenType.Identifier ||
                next.type === TokenType.Keyword
            )
        ) {
            label = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_GOTO_LABEL',
                'Expected label after GOTO',
                endOffset,
                endOffset
            );
        }

        return {
            type: 'GotoStatement',
            label,
            start: token.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseLabel(): LabelNode {
        const nameToken = this.consume();
        const colonToken = this.consume();

        return {
            type: 'LabelStatement',
            name: nameToken.value,
            start: nameToken.offset,
            end: colonToken.offset + colonToken.value.length
        };
    }

    private parseWaitFor(): WaitForNode {
        const startToken = this.matchKeyword('WAITFOR');
        let incomplete = false;
        const errors: string[] = [];
        let kind: 'TIME' | 'DELAY' | null = null;
        let value: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        if (this.peekKeyword('TIME')) {
            this.consume();
            kind = 'TIME';
            endOffset = this.lastConsumedEnd();
        } else if (this.peekKeyword('DELAY')) {
            this.consume();
            kind = 'DELAY';
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_WAITFOR_KIND',
                'Expected TIME or DELAY after WAITFOR',
                endOffset,
                endOffset
            );
        }

        if (kind) {
            try {
                if (
                    this.peek() &&
                    this.peek()?.type !== TokenType.Semicolon &&
                    !(
                        this.peek()?.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(this.peek()!.value)
                    )
                ) {
                    value = this.parseExpression();
                    endOffset = value.end;
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_WAITFOR_VALUE',
                        `Expected ${kind} value after WAITFOR ${kind}`,
                        endOffset,
                        endOffset
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_WAITFOR_VALUE',
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                    endOffset
                );
            }
        }

        return {
            type: 'WaitForStatement',
            kind,
            value,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDeclareCursor(): DeclareCursorNode {
        const startToken = this.matchKeyword('DECLARE');
        let incomplete = false;
        const errors: string[] = [];
        let name: string | null = null;
        let query: QueryStatement | null = null;
        const options: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        const nameToken = this.peek();
        if (
            nameToken &&
            (
                nameToken.type === TokenType.Identifier ||
                nameToken.type === TokenType.Keyword
            )
        ) {
            name = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_NAME',
                'Expected cursor name after DECLARE',
                endOffset,
                endOffset
            );
        }

        if (this.peekKeyword('CURSOR')) {
            this.consume();
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_KEYWORD',
                'Expected CURSOR keyword in cursor declaration',
                endOffset,
                endOffset
            );
        }

        while (this.peek()) {
            const value = this.peek()!.value;
            if (value === 'FOR') {
                break;
            }
            if (
                this.peek()?.type === TokenType.Semicolon ||
                (
                    this.peek()?.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(this.peek()!.value)
                )
            ) {
                break;
            }

            options.push(this.consume().value);
            endOffset = this.lastConsumedEnd();
        }

        if (this.peekKeyword('FOR')) {
            this.consume();
            endOffset = this.lastConsumedEnd();
            try {
                query = this.parseQueryExpression();
                endOffset = query.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_CURSOR_QUERY',
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                    endOffset
                );
            }
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_FOR',
                'Expected FOR query in cursor declaration',
                endOffset,
                endOffset
            );
        }

        return {
            type: 'DeclareCursorStatement',
            name,
            ...(options.length ? { options } : {}),
            query,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseOpenCursor(): OpenCursorNode {
        const startToken = this.matchKeyword('OPEN');
        let incomplete = false;
        const errors: string[] = [];
        let name: string | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        if (
            this.peek() &&
            (
                this.peek()!.type === TokenType.Identifier ||
                this.peek()!.type === TokenType.Keyword
            )
        ) {
            name = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_OPEN_NAME',
                'Expected cursor name after OPEN',
                endOffset,
                endOffset
            );
        }

        return {
            type: 'OpenCursorStatement',
            name,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseFetchCursor(): FetchCursorNode {
        const startToken = this.matchKeyword('FETCH');
        let incomplete = false;
        const errors: string[] = [];
        let direction: string | undefined;
        let offset: Expression | null | undefined;
        let name: string | null = null;
        let into: string[] | undefined;
        let endOffset = startToken.offset + startToken.value.length;

        const directionToken = this.peek();
        if (
            directionToken &&
            ['NEXT', 'PRIOR', 'FIRST', 'LAST', 'ABSOLUTE', 'RELATIVE'].includes(directionToken.value)
        ) {
            direction = this.consume().value;
            endOffset = this.lastConsumedEnd();

            if (direction === 'ABSOLUTE' || direction === 'RELATIVE') {
                try {
                    offset = this.parseExpression();
                    endOffset = offset.end;
                } catch (e) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        'PARSE_CURSOR_FETCH_OFFSET',
                        e instanceof Error ? e.message : String(e),
                        endOffset,
                        endOffset
                    );
                }
            }
        }

        if (this.peekKeyword('FROM')) {
            this.consume();
            endOffset = this.lastConsumedEnd();
        }

        if (
            this.peek() &&
            (
                this.peek()!.type === TokenType.Identifier ||
                this.peek()!.type === TokenType.Keyword
            )
        ) {
            name = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_FETCH_NAME',
                'Expected cursor name after FETCH',
                endOffset,
                endOffset
            );
        }

        if (this.peekKeyword('INTO')) {
            this.consume();
            endOffset = this.lastConsumedEnd();
            into = this.parseList(() => {
                const token = this.peek();
                if (!token || token.type !== TokenType.Variable) {
                    throw new Error('Expected variable in FETCH INTO list');
                }
                return this.consume().value;
            }, {
                isBoundary: (token?: Token) =>
                    !token ||
                    token.type === TokenType.Semicolon ||
                    (
                        token.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(token.value)
                    )
            });
            endOffset = this.lastConsumedEnd();
        }

        return {
            type: 'FetchCursorStatement',
            ...(direction ? { direction } : {}),
            ...(offset !== undefined ? { offset } : {}),
            name,
            ...(into ? { into } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseCloseCursor(): CloseCursorNode {
        const startToken = this.matchKeyword('CLOSE');
        let incomplete = false;
        const errors: string[] = [];
        let name: string | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        if (
            this.peek() &&
            (
                this.peek()!.type === TokenType.Identifier ||
                this.peek()!.type === TokenType.Keyword
            )
        ) {
            name = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_CLOSE_NAME',
                'Expected cursor name after CLOSE',
                endOffset,
                endOffset
            );
        }

        return {
            type: 'CloseCursorStatement',
            name,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseDeallocateCursor(): DeallocateCursorNode {
        const startToken = this.matchKeyword('DEALLOCATE');
        let incomplete = false;
        const errors: string[] = [];
        let name: string | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        if (
            this.peek() &&
            (
                this.peek()!.type === TokenType.Identifier ||
                this.peek()!.type === TokenType.Keyword
            )
        ) {
            name = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_CURSOR_DEALLOCATE_NAME',
                'Expected cursor name after DEALLOCATE',
                endOffset,
                endOffset
            );
        }

        return {
            type: 'DeallocateCursorStatement',
            name,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseTransaction(): TransactionNode {
        const startToken =
            this.consume(); // BEGIN / COMMIT / ROLLBACK / SAVE

        const action =
            startToken.value as TransactionAction;

        let incomplete = false;
        const errors: string[] = [];

        let endOffset =
            startToken.offset +
            startToken.value.length;

        let distributed = false;
        let name: string | undefined;

        // -------------------------------------------------
        // BEGIN DISTRIBUTED TRANSACTION
        // -------------------------------------------------

        if (
            action === 'BEGIN' &&
            this.peekKeyword('DISTRIBUTED')
        ) {

            this.consume();

            distributed = true;

            endOffset =
                this.lastConsumedEnd();
        }

        // -------------------------------------------------
        // Optional TRAN / TRANSACTION
        // -------------------------------------------------

        const nextValue =
            this.peek()?.value?.toUpperCase();

        if (
            nextValue === 'TRANSACTION' ||
            nextValue === 'TRAN'
        ) {
            this.consume();

            endOffset =
                this.lastConsumedEnd();
        }

        // -------------------------------------------------
        // Optional transaction/savepoint name
        //
        // CRITICAL:
        // Do NOT consume statement keywords
        // like UPDATE/SELECT/INSERT/etc
        // as transaction names.
        // -------------------------------------------------

        const next =
            this.peek();

        const hasName =
            next &&
            next.type !== TokenType.Semicolon &&
            (
                next.type === TokenType.Identifier ||
                next.type === TokenType.Variable
            );

        if (hasName) {

            try {

                name =
                    this.consume().value;

                endOffset =
                    this.lastConsumedEnd();
            }
            catch (e) {

                incomplete = true;

                this.addRecoverableError(
                    errors,
                    'PARSE_TRANSACTION_NAME',
                    e instanceof Error
                        ? e.message
                        : String(e),
                    endOffset
                );
            }
        }

        // -------------------------------------------------
        // SAVE TRAN requires name
        // -------------------------------------------------

        else if (action === 'SAVE') {

            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_TRANSACTION_SAVE_NAME',
                'SAVE TRANSACTION requires a savepoint name',
                endOffset
            );
        }

        return {
            type: 'TransactionStatement',
            action,

            ...(name !== undefined
                ? { name }
                : {}),

            ...(distributed
                ? { distributed: true }
                : {}),

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

    private parseAlterTable(): AlterTableNode {
        const startToken = this.matchKeyword('ALTER');
        this.matchKeyword('TABLE');
        const table = this.parseMultipartIdentifier() as IdentifierNode;
        let incomplete = false;
        const errors: string[] = [];

        const actionToken = this.consume(); // ADD or DROP
        const actionVal = actionToken.value.toUpperCase();
        let action: AlterTableAction;

        if (actionVal === 'ADD') {
            if (this.peekKeyword('CONSTRAINT')) {
                // FIX: Do NOT consume 'CONSTRAINT' here.
                // parseConstraint() needs to see that token to correctly parse the name.
                action = {
                    kind: 'ADD_CONSTRAINT',
                    constraint: this.parseConstraint()
                };
            } else {
                if (this.peekKeyword('COLUMN')) this.consume();
                action = {
                    kind: 'ADD_COLUMN',
                    column: this.parseColumnDefinition()
                };
            }
        } else if (actionVal === 'DROP') {
            const isConstraint = this.peekKeyword('CONSTRAINT');
            const isColumn = this.peekKeyword('COLUMN');
            if (isConstraint || isColumn) this.consume();

            let ifExists = false;
            if (this.peekKeyword('IF')) {
                this.consume(); // IF
                this.matchKeyword('EXISTS');
                ifExists = true;
            }

            const name = this.consume().value;
            action = isConstraint
                ? { kind: 'DROP_CONSTRAINT', name, ifExists }
                : { kind: 'DROP_COLUMN', name, ifExists };
        }
        else if (actionVal === 'ALTER') {
            if (this.peekKeyword('COLUMN')) this.consume(); // optional COLUMN keyword
            action = {
                kind: 'ALTER_COLUMN',
                column: this.parseColumnDefinition()
            };
        } else {
            incomplete = true;

            this.addRecoverableError(
                errors,
                'PARSE_ALTER_TABLE_ACTION',
                `Unsupported ALTER TABLE action: ${actionVal}`,
                actionToken.offset,
                actionToken.offset + actionToken.value.length
            );

            action = {
                kind: 'DROP_COLUMN',
                name: actionToken.value,
                ifExists: false
            };

            while (
                this.peek() &&
                this.peek()?.type !== TokenType.Semicolon
            ) {
                this.consume();
            }
        }

        return {
            type: 'AlterTableStatement',
            table,
            action,
            start: startToken.offset,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseAlterIndex(): AlterIndexNode {
        const startToken = this.matchKeyword('ALTER');
        this.matchKeyword('INDEX');

        let incomplete = false;
        const errors: string[] = [];

        let indexName = '';
        let indexNameNode: IdentifierNode | null = null;
        let table: IdentifierNode | null = null;
        let action: AlterIndexAction | null = null;

        try {
            if (this.peekKeyword('ALL')) {
                const allToken = this.consume();
                indexName = allToken.value;
            } else {
                const nameExpr = this.parseMultipartIdentifier();
                if (nameExpr.type === 'Identifier') {
                    indexName = nameExpr.name;
                    indexNameNode = nameExpr;
                } else {
                    throw new Error('Expected index name');
                }
            }

            this.matchKeyword('ON');
            const tableExpr = this.parseMultipartIdentifier();
            if (tableExpr.type === 'Identifier') {
                table = tableExpr;
            } else {
                throw new Error('Expected table name after ON');
            }

            const actionToken = this.consume();
            const actionVal = actionToken.value.toUpperCase();

            if (actionVal === 'REBUILD') {
                let partition: Expression | null = null;
                let options: IndexOptionNode[] | undefined;

                if (this.peekKeyword('PARTITION')) {
                    this.consume();
                    if (this.peek()?.value === '=') {
                        this.consume();
                    }
                    partition = this.parseExpression();
                }

                if (this.peekKeyword('WITH')) {
                    options = this.parseIndexOptionsWithClause();
                }

                action = {
                    kind: 'REBUILD',
                    ...(partition ? { partition } : {}),
                    ...(options?.length ? { options } : {})
                };
            } else if (actionVal === 'REORGANIZE') {
                let partition: Expression | null = null;

                if (this.peekKeyword('PARTITION')) {
                    this.consume();
                    if (this.peek()?.value === '=') {
                        this.consume();
                    }
                    partition = this.parseExpression();
                }

                action = {
                    kind: 'REORGANIZE',
                    ...(partition ? { partition } : {})
                };
            } else if (actionVal === 'DISABLE') {
                action = { kind: 'DISABLE' };
            } else if (actionVal === 'SET') {
                action = {
                    kind: 'SET',
                    options: this.parseIndexOptionsBareClause()
                };
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    'PARSE_ALTER_INDEX_ACTION',
                    `Unsupported ALTER INDEX action: ${actionVal}`,
                    actionToken.offset,
                    actionToken.offset + actionToken.value.length
                );

                action = {
                    kind: 'UNKNOWN',
                    raw: actionToken.value
                };

                while (
                    this.peek() &&
                    this.peek()?.type !== TokenType.Semicolon
                ) {
                    this.consume();
                }
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                'PARSE_ALTER_INDEX',
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                this.lastConsumedEnd()
            );
        }

        return {
            type: 'AlterIndexStatement',
            indexName,
            indexNameNode,
            table,
            action,
            start: startToken.offset,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {})
        };
    }

    private parseIndexOptionsWithClause(): IndexOptionNode[] {
        this.matchKeyword('WITH');
        return this.parseIndexOptionsBareClause();
    }

    private parseIndexOptionsBareClause(): IndexOptionNode[] {
        this.match(TokenType.OpenParen);

        const options =
            this.parseList<IndexOptionNode>(() => {
                const optionToken = this.consume();
                const start = optionToken.offset;

                let value = '';

                if (this.peek()?.value === '=') {
                    this.consume();
                    value = this.consume().value;
                }

                return {
                    type: 'IndexOption',
                    name: optionToken.value,
                    value,
                    start,
                    end: this.lastConsumedEnd()
                };
            }, {
                isBoundary: (token?: Token) =>
                    !token ||
                    token.type === TokenType.CloseParen
            });

        this.match(TokenType.CloseParen);

        return options;
    }

    private parseTruncate(): TruncateNode {
        const startToken = this.matchKeyword('TRUNCATE');
        this.matchKeyword('TABLE');
        const table = this.parseMultipartIdentifier() as IdentifierNode;

        return {
            type: 'TruncateStatement',
            table,
            start: startToken.offset,
            end: table.end
        };
    }

    private parseColumnDefinition(): ColumnDefinition {
        const startToken = this.peek()!;
        const nameExpr = this.parseMultipartIdentifier(
            undefined,
            { allowStructuralFirstSegment: true }
        );

        if (nameExpr.type !== 'Identifier') {
            throw new Error('Wildcards are not allowed as column names in table definitions');
        }

        const name = nameExpr.name;

        if (this.peekKeyword('AS')) {
            return {
                name,
                ...this.parseComputedColumnTail(),
                start: startToken.offset,
                end: this.lastConsumedEnd()
            };
        }

        // 1. Data Type
        let dataType = '';
        let parenDepth = 0;
        while (this.peek()) {
            const next = this.peek()!;
            const val = next.value.toUpperCase();

            if (parenDepth === 0) {
                // Stop if we hit a separator or a column constraint keyword
                if (next.type === TokenType.Comma || next.type === TokenType.CloseParen || next.type === TokenType.Semicolon) break;
                if (['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'DEFAULT', 'NOT', 'NULL', 'REFERENCES', 'IDENTITY'].includes(val)) break;
            }

            if (next.type === TokenType.OpenParen) parenDepth++;

            const tokenValue = this.consume().value;

            // Smarter spacing logic: 
            // Only add space if both the last char and current token are "word" characters.
            // This keeps "VARCHAR(255)" tight but "DOUBLE PRECISION" spaced.
            if (dataType.length > 0) {
                const lastChar = dataType[dataType.length - 1];
                const isCurrentWord = /^[A-Za-z0-9_]+$/.test(tokenValue);
                const isLastWord = /^[A-Za-z0-9_]+$/.test(lastChar);

                if (isCurrentWord && isLastWord) {
                    dataType += ' ';
                }
            }

            dataType += tokenValue;

            if (next.type === TokenType.CloseParen) parenDepth--;
        }

        // 2. Inline Constraints
        const constraints: ConstraintNode[] = [];
        while (this.peek()) {
            const next = this.peek()!;
            const val = next.value.toUpperCase();

            // Standard boundary check
            if (next.type === TokenType.Comma || next.type === TokenType.CloseParen || next.type === TokenType.Semicolon) break;

            if (['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'DEFAULT', 'NOT', 'NULL', 'REFERENCES', 'IDENTITY'].includes(val)) {
                // parseConstraint handles its own name-check and keyword consumption
                constraints.push(this.parseConstraint(name));

                // Check if the constraint was followed by a separator
                if (this.peek()?.type === TokenType.Comma || this.peek()?.type === TokenType.CloseParen) break;
                continue;
            }

            // Skip unexpected tokens to reach next boundary
            this.consume();
        }

        return {
            name,
            dataType,
            ...(constraints.length ? { constraints } : {}),
            start: startToken.offset,
            end: this.lastConsumedEnd()
        };
    }

    private recoverToStatementBoundary(
        extra: string[] = []
    ) {
        this.recoverTo([
            ';',
            ...extra,
            ...RESYNC_KEYWORDS
        ]);
    }

    private resyncToBlockBoundary(): void {
        while (this.pos < this.tokens.length) {
            const token = this.peek();

            if (!token) {
                return;
            }

            if (
                token.type === TokenType.Semicolon ||
                token.value === 'END' ||
                token.value === 'ELSE' ||
                token.value === 'CATCH'
            ) {
                return;
            }

            this.consume();
        }
    }

    private resyncToCaseBoundary(): void {
        while (this.pos < this.tokens.length) {
            const token = this.peek();

            if (!token) {
                return;
            }

            // ---------------------------------------------
            // Statement boundary
            //
            // Leave semicolon for outer statement/parser.
            // ---------------------------------------------

            if (
                token.type === TokenType.Semicolon
            ) {
                return;
            }

            // ---------------------------------------------
            // CASE-owned boundaries
            //
            // Consume WHEN / THEN / ELSE so CASE parser
            // can continue safely.
            // ---------------------------------------------

            if (
                token.type === TokenType.Keyword &&
                (
                    token.value === 'WHEN' ||
                    token.value === 'THEN' ||
                    token.value === 'ELSE'
                )
            ) {
                this.consume();
                return;
            }

            // ---------------------------------------------
            // END belongs to CASE parser itself.
            // Do NOT consume it here.
            // ---------------------------------------------

            if (
                token.type === TokenType.Keyword &&
                token.value === 'END'
            ) {
                return;
            }

            // ---------------------------------------------
            // Outer statement recovery boundary
            // ---------------------------------------------

            if (
                token.type === TokenType.Keyword &&
                RESYNC_KEYWORDS.has(token.value)
            ) {
                return;
            }

            this.consume();
        }
    }

    private resyncToBoundary(
        isBoundary: (token?: Token) => boolean
    ): void {
        while (this.pos < this.tokens.length) {
            const token = this.peek();

            if (!token) {
                return;
            }

            // ---------------------------------------------
            // Column separator
            //
            // Consume comma so caller resumes at next
            // column expression cleanly.
            // ---------------------------------------------

            if (
                token.type === TokenType.Comma
            ) {
                this.consume();
                return;
            }

            // ---------------------------------------------
            // Statement boundary
            //
            // Leave semicolon for outer parser loop.
            // ---------------------------------------------

            if (
                token.type === TokenType.Semicolon
            ) {
                return;
            }

            if (isBoundary(token)) {
                return;
            }

            this.consume();
        }
    }

    private resyncToSelectBoundary(): void {
        this.resyncToBoundary(
            this.isDefaultListBoundary.bind(this)
        );
    }

}
