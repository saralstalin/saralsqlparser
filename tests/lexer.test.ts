import { Lexer, TokenType } from '../src/lexer';

describe('T-SQL Lexer', () => {
    test('should tokenize basic T-SQL identifiers', () => {
        const input = 'SELECT @MyVar, [#MyTemp] FROM [dbo].[Table]';
        const lexer = new Lexer(input);
        const tokens = [];
        let token;
        while ((token = lexer.nextToken()).type !== TokenType.EOF) {
            tokens.push(token);
        }

        expect(tokens[0].value.toLowerCase()).toBe('select');
        expect(tokens[1].type).toBe(TokenType.Variable);
        expect(tokens[1].value).toBe('@MyVar');
        expect(tokens[3].type).toBe(TokenType.TempTable);
        expect(tokens[3].value).toBe('[#MyTemp]');
    });

    test('should handle multi-line comments and whitespace', () => {
        const input = `SELECT -- line comment\n/* block \n comment */ * FROM T`;
        const lexer = new Lexer(input);
        const tokens = [];
        let t;
        while ((t = lexer.nextToken()).type !== TokenType.EOF) tokens.push(t);
        
        expect(tokens.map(t => t.value)).not.toContain('-- line comment');
        expect(tokens[0].value.toLowerCase()).toBe('select');
    });

    
});