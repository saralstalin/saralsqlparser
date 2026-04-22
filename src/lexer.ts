export enum TokenType {
    Keyword,
    Identifier,
    Variable,
    TempTable,
    Operator,
    Number,
    String,
    OpenParen,
    CloseParen,
    Semicolon,
    EOF,
    Comma,
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    col: number;
    offset: number; // Absolute character position for LSP integration
}

export class Lexer {
    private pos = 0;
    private line = 1;
    private col = 1;
    private keywords = new Set([
        'select', 'from', 'where', 'group', 'by', 'having', 'order', 'top', 'distinct',
        'insert', 'update', 'delete', 'into', 'values', 'set', 'create', 'declare',
        'union', 'except', 'intersect', 'all', 'and', 'or', 'not', 'null', 'in',
        'between', 'like', 'case', 'when', 'then', 'else', 'end', 'exists',
        'procedure', 'proc', 'function', 'view', 'table', 'type', 'as', 'go', 'on', 'join',
        'inner', 'left', 'right', 'cross', 'outer', 'asc', 'desc'
    ]);

    constructor(private input: string) { }

    private peek(offset: number = 0) {
        return this.input[this.pos + offset];
    }

    private consume() {
        const char = this.input[this.pos++];
        if (char === '\n') {
            this.line++;
            this.col = 1;
        } else if (char !== '\r') {
            /**
             * FIX: Do not increment column for Carriage Return (\r).
             * This ensures that on Windows (\r\n), the line position 
             * stays consistent with editors like VS Code and SSMS.
             */
            this.col++;
        }
        return char;
    }

    public nextToken(): Token {
        this.skipWhitespaceAndComments();

        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;

        if (this.pos >= this.input.length) {
            return {
                type: TokenType.EOF,
                value: '',
                line: startLine,
                col: startCol,
                offset: startOffset
            };
        }

        const char = this.peek();

        // 1. Strings (N'...' or '...')
        if (char === "'" || (char === 'N' && this.peek(1) === "'")) {
            return this.readString(startLine, startCol, startOffset);
        }

        // 2. Identifiers, Keywords, Variables, Temp Tables, Brackets
        if (/[a-zA-Z_@#]/.test(char) || char === '[') {
            return this.readIdentifier(startLine, startCol, startOffset);
        }

        // 3. Numbers
        if (/[0-9]/.test(char)) {
            let val = "";
            while (this.pos < this.input.length && /[0-9.]/.test(this.peek())) {
                val += this.consume();
            }
            return {
                type: TokenType.Number,
                value: val,
                line: startLine,
                col: startCol,
                offset: startOffset
            };
        }

        // 4. Punctuation & Operators
        this.consume();
        return {
            type: this.getCharTokenType(char),
            value: char,
            line: startLine,
            col: startCol,
            offset: startOffset
        };
    }

    private readIdentifier(line: number, col: number, startOffset: number): Token {
        let opener = "";
        let content = "";
        let closer = "";

        if (this.peek() === '[') {
            opener = this.consume(); // [
            while (this.pos < this.input.length && this.peek() !== ']') {
                content += this.consume();
            }
            closer = this.consume() || ""; // ]
        } else {
            // Standard ID, Variable (@), or TempTable (#)
            while (this.pos < this.input.length && /[a-zA-Z0-9_@#]/.test(this.peek())) {
                content += this.consume();
            }
        }

        const fullValue = `${opener}${content}${closer}`;
        let type = TokenType.Identifier;

        // Keywords are never bracketed or prefixed with @/# in T-SQL
        if (opener === "" && !content.startsWith('@') && !content.startsWith('#')) {
            if (this.keywords.has(content.toLowerCase())) {
                type = TokenType.Keyword;
            }
        } else if (content.startsWith('@')) {
            type = TokenType.Variable;
        } else if (content.startsWith('#')) {
            type = TokenType.TempTable;
        }

        return {
            type,
            value: fullValue,
            line,
            col,
            offset: startOffset
        };
    }

    private readString(line: number, col: number, startOffset: number): Token {
        let value = "";

        if (this.peek() === 'N') {
            value += this.consume();
        }

        const quote = this.consume();
        value += quote;

        while (this.pos < this.input.length) {
            if (this.peek() === "'" && this.peek(1) === "'") {
                value += this.consume();
                value += this.consume();
            } else if (this.peek() === "'") {
                value += this.consume();
                break;
            } else {
                value += this.consume();
            }
        }

        return {
            type: TokenType.String,
            value,
            line,
            col,
            offset: startOffset
        };
    }

    private getCharTokenType(char: string): TokenType {
        switch (char) {
            case '(': return TokenType.OpenParen;
            case ')': return TokenType.CloseParen;
            case ';': return TokenType.Semicolon;
            case ',': return TokenType.Comma;
            default: return TokenType.Operator;
        }
    }

    private skipWhitespaceAndComments() {
        while (this.pos < this.input.length) {
            const char = this.peek();

            if (/\s/.test(char)) {
                this.consume();
                continue;
            }

            if (this.input.startsWith('--', this.pos)) {
                while (this.pos < this.input.length && this.peek() !== '\n') {
                    this.consume();
                }
                continue;
            }

            if (this.input.startsWith('/*', this.pos)) {
                this.consume(); // /
                this.consume(); // *
                while (this.pos < this.input.length && !(this.peek() === '*' && this.peek(1) === '/')) {
                    this.consume();
                }
                if (this.pos < this.input.length) {
                    this.consume(); // *
                    this.consume(); // /
                }
                continue;
            }
            break;
        }
    }
}