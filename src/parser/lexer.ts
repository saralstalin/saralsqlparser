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
    Dot
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    col: number;
    offset: number; // Absolute character position for LSP integration
}

const COMPOSITE_START = new Set(['>', '<', '!', '=']);
const COMPOSITE_OPERATORS = new Set(['>=', '<=', '<>', '!=']);

export class Lexer {
    private pos = 0;
    private line = 1;
    private col = 1;
    
    // Rule #3: Keywords are stored in UpperCase for normalized comparison
    private keywords = new Set([
        'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'TOP', 'DISTINCT',
        'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES', 'SET', 'CREATE', 'DECLARE',
        'UNION', 'EXCEPT', 'INTERSECT', 'ALL', 'AND', 'OR', 'NOT', 'NULL', 'IN',
        'BETWEEN', 'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
        'OVER', 'PARTITION', 'PROCEDURE', 'PROC', 'FUNCTION', 'VIEW', 'TABLE', 
        'TYPE', 'AS', 'GO', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 
        'OUTER', 'ASC', 'DESC', 'WITH', 'IF',  'BEGIN',  'PRINT', 'OUTPUT', 'OUT'
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

        // 2. Rule #4: Explicit Dot Handling (Structural, not Operator)
        if (char === '.') {
            this.consume();
            return {
                type: TokenType.Dot,
                value: '.',
                line: startLine,
                col: startCol,
                offset: startOffset
            };
        }

        // 3. Identifiers, Keywords, Variables, Temp Tables, Brackets
        if (/[a-zA-Z_@#]/.test(char) || char === '[') {
            return this.readIdentifier(startLine, startCol, startOffset);
        }

        // 4. Rule #2: Robust Number Tokenization
        if (/[0-9]/.test(char)) {
            return this.readNumber(startLine, startCol, startOffset);
        }

        // 5. Rule #1: Composite Operators (>=, <=, <>, !=)
        
        if (COMPOSITE_START.has(char)) {
            let op = this.consume();
            const next = this.peek();
            const combined = op + next;
            
            if (COMPOSITE_OPERATORS.has(combined)) {
                op = combined;
                this.consume();
            }
            return {
                type: TokenType.Operator,
                value: op,
                line: startLine,
                col: startCol,
                offset: startOffset
            };
        }

        // 6. Standard Punctuation & Fallback Operators
        this.consume();
        return {
            type: this.getCharTokenType(char),
            value: char,
            line: startLine,
            col: startCol,
            offset: startOffset
        };
    }

    private readNumber(line: number, col: number, offset: number): Token {
        let val = "";
        let hasDot = false;

        while (this.pos < this.input.length) {
            const ch = this.peek();
            if (/[0-9]/.test(ch)) {
                val += this.consume();
            } else if (ch === '.' && !hasDot && /[0-9]/.test(this.peek(1))) {
                // Rule #2: Only consume dot if followed by a digit
                hasDot = true;
                val += this.consume();
            } else {
                break;
            }
        }

        return { type: TokenType.Number, value: val, line, col, offset };
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
            while (this.pos < this.input.length && /[a-zA-Z0-9_@#]/.test(this.peek())) {
                content += this.consume();
            }
        }

        const fullValue = `${opener}${content}${closer}`;
        
        // Rule #3: Check normalized keywords
        if (opener === "" && !content.startsWith('@') && !content.startsWith('#')) {
            const upper = content.toUpperCase();
            if (this.keywords.has(upper)) {
                return { type: TokenType.Keyword, value: upper, line, col, offset: startOffset };
            }
        }

        let type = TokenType.Identifier;
        if (content.startsWith('@')) type = TokenType.Variable;
        else if (content.startsWith('#')) type = TokenType.TempTable;

        return { type, value: fullValue, line, col, offset: startOffset };
    }

    private readString(line: number, col: number, startOffset: number): Token {
        let value = "";
        if (this.peek() === 'N') value += this.consume();

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

        return { type: TokenType.String, value, line, col, offset: startOffset };
    }

    private getCharTokenType(char: string): TokenType {
        switch (char) {
            case '(': return TokenType.OpenParen;
            case ')': return TokenType.CloseParen;
            case ';': return TokenType.Semicolon;
            case ',': return TokenType.Comma;
            case '.': return TokenType.Dot;
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