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
            this.col++;
        }
        return char;
    }

    public nextToken(): Token {
        this.skipWhitespaceAndComments();

        const startLine = this.line;
        const startCol = this.col;

        if (this.pos >= this.input.length) {
            return { type: TokenType.EOF, value: '', line: startLine, col: startCol };
        }

        const char = this.peek();

        // 1. Strings (Symmetric consumption with escaped quote support)
        if (char === "'") {
            return this.readString(startLine, startCol);
        }

        // 2. Delimited Identifiers (Preserving brackets/quotes)
        if (char === '[' || char === '"') {
            return this.readDelimitedIdentifier(startLine, startCol);
        }

        // 3. T-SQL Variables (@var)
        if (char === '@') {
            let val = this.consume();
            while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.peek())) {
                val += this.consume();
            }
            return { type: TokenType.Variable, value: val, line: startLine, col: startCol };
        }

        // 4. Temporary Tables (#table)
        if (char === '#') {
            let val = this.consume();
            while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.peek())) {
                val += this.consume();
            }
            return { type: TokenType.TempTable, value: val, line: startLine, col: startCol };
        }

        // 5. Numbers
        if (/[0-9]/.test(char)) {
            let val = "";
            while (this.pos < this.input.length && /[0-9.]/.test(this.peek())) {
                val += this.consume();
            }
            return { type: TokenType.Number, value: val, line: startLine, col: startCol };
        }

        // 6. Identifiers & Keywords
        if (/[a-zA-Z_]/.test(char)) {
            let val = "";
            while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.peek())) {
                val += this.consume();
            }
            const type = this.keywords.has(val.toLowerCase()) ? TokenType.Keyword : TokenType.Identifier;
            return { type, value: val, line: startLine, col: startCol };
        }

        // 7. Multi-char & Single-char Operators (+ and - included)
        if (['=', '>', '<', '!', '+', '-', '*', '/', '%'].includes(char)) {
            let val = this.consume();
            const next = this.peek();
            if ((val === '>' && next === '=') ||
                (val === '<' && (next === '=' || next === '>')) ||
                (val === '!' && next === '=')) {
                val += this.consume();
            }
            return { type: TokenType.Operator, value: val, line: startLine, col: startCol };
        }

        // 8. Punctuation
        if (char === '(') return { type: TokenType.OpenParen, value: this.consume(), line: startLine, col: startCol };
        if (char === ')') return { type: TokenType.CloseParen, value: this.consume(), line: startLine, col: startCol };
        if (char === ',') return { type: TokenType.Comma, value: this.consume(), line: startLine, col: startCol };
        if (char === '.') return { type: TokenType.Operator, value: this.consume(), line: startLine, col: startCol };
        if (char === ';') return { type: TokenType.Semicolon, value: this.consume(), line: startLine, col: startCol };

        // Fallback for unknown characters
        return { type: TokenType.Operator, value: this.consume(), line: startLine, col: startCol };
    }

    private readString(line: number, col: number): Token {
        this.consume(); // Consume opening '
        let value = "'";
        while (this.pos < this.input.length) {
            if (this.peek() === "'") {
                if (this.peek(1) === "'") { // Handle escaped ''
                    value += "''";
                    this.consume();
                    this.consume();
                    continue;
                }
                value += this.consume(); // Consume closing '
                return { type: TokenType.String, value, line, col };
            }
            value += this.consume();
        }
        throw new Error(`Unterminated string starting at ${line}:${col}`);
    }

    private readDelimitedIdentifier(line: number, col: number): Token {
        const opener = this.consume(); // Consume [
        const closer = opener === '[' ? ']' : '"';
        let content = "";

        while (this.pos < this.input.length && this.peek() !== closer) {
            content += this.consume();
        }

        if (this.pos >= this.input.length) {
            throw new Error(`Unterminated delimited identifier starting at ${line}:${col}`);
        }

        this.consume(); // Consume ]

        // Determine type based on content, but keep brackets for the value
        let type = TokenType.Identifier;
        if (content.startsWith('@')) {
            type = TokenType.Variable;
        } else if (content.startsWith('#')) {
            type = TokenType.TempTable;
        }

        // Reconstruction requirement: return the value WITH the delimiters
        return {
            type,
            value: `${opener}${content}${closer}`,
            line,
            col
        };
    }

    private skipWhitespaceAndComments() {
        while (this.pos < this.input.length) {
            const char = this.peek();

            if (/\s/.test(char)) {
                this.consume();
                continue;
            }

            // Line Comments (-- comment)
            if (this.input.startsWith('--', this.pos)) {
                while (this.pos < this.input.length && this.peek() !== '\n') {
                    this.consume();
                }
                continue;
            }

            // Block Comments (/* comment */)
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