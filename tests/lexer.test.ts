import { Lexer, TokenType } from '../src/lexer';

describe('T-SQL Lexer - Tests', () => {
    
    test('Offset Precision: Should track exact positions regardless of whitespace', () => {
        const sql = 'SELECT   [Name],\n@ID';
        const lexer = new Lexer(sql);
        
        const t1 = lexer.nextToken(); // SELECT
        const t2 = lexer.nextToken(); // [Name]
        const t3 = lexer.nextToken(); // ,
        const t4 = lexer.nextToken(); // @ID

        // "SELECT" is at 0
        expect(t1.offset).toBe(0);
        // "   " is 3 spaces, so "[" is at index 9
        expect(t2.offset).toBe(9);
        expect(t2.value).toBe('[Name]');
        // "," is immediately after "]" (index 15)
        expect(t3.offset).toBe(15);
        // "\n" is 1 char, so "@" is at index 17
        expect(t4.offset).toBe(17);
        expect(t4.line).toBe(2);
        expect(t4.col).toBe(1);
    });

    test('T-SQL Identifiers: Should distinguish between Keywords, Variables, and Temp Tables', () => {
        const sql = 'SELECT @Var, #Temp, [KeywordTable]';
        const lexer = new Lexer(sql);
        
        const tokens = [];
        let t;
        while ((t = lexer.nextToken()).type !== TokenType.EOF) tokens.push(t);

        expect(tokens[0].type).toBe(TokenType.Keyword);    // SELECT
        expect(tokens[1].type).toBe(TokenType.Variable);   // @Var
        expect(tokens[3].type).toBe(TokenType.TempTable);  // #Temp
        expect(tokens[5].type).toBe(TokenType.Identifier); // [KeywordTable]
    });

    test('String Literals: Should handle N-prefix and escaped quotes', () => {
        const sql = "N'Unicode String' + 'Standard ''Escaped'' String'";
        const lexer = new Lexer(sql);
        
        const t1 = lexer.nextToken(); // N'Unicode String'
        lexer.nextToken();            // +
        const t3 = lexer.nextToken(); // 'Standard ''Escaped'' String'

        expect(t1.type).toBe(TokenType.String);
        expect(t1.value).toBe("N'Unicode String'");
        
        expect(t3.type).toBe(TokenType.String);
        expect(t3.value).toBe("'Standard ''Escaped'' String'");
        // Ensure the offset points to the first quote
        expect(sql.substring(t3.offset, t3.offset + 1)).toBe("'");
    });

    test('Comments: Should skip and maintain correct offsets for subsequent tokens', () => {
        const sql = `
            /* Multi-line
               Block Comment */
            SELECT -- End of line comment
            * FROM T
        `;
        const lexer = new Lexer(sql);
        
        const t1 = lexer.nextToken(); // SELECT
        const t2 = lexer.nextToken(); // *

        expect(t1.value.toLowerCase()).toBe('select');
        // Verify we can find the token in the original string using the offset
        expect(sql.substring(t1.offset, t1.offset + 6).toLowerCase()).toBe('select');
        
        expect(t2.value).toBe('*');
        expect(sql.substring(t2.offset, t2.offset + 1)).toBe('*');
    });

    test('Edge Case: Bracketed keywords should be Identifiers', () => {
        const sql = 'SELECT [FROM] FROM [SELECT]';
        const lexer = new Lexer(sql);
        
        const t1 = lexer.nextToken(); // SELECT
        const t2 = lexer.nextToken(); // [FROM]
        const t3 = lexer.nextToken(); // FROM

        expect(t1.type).toBe(TokenType.Keyword);
        expect(t2.type).toBe(TokenType.Identifier);
        expect(t2.value).toBe('[FROM]');
        expect(t3.type).toBe(TokenType.Keyword);
    });

    test('Numbers: Should handle decimals', () => {
        const sql = '123.45';
        const lexer = new Lexer(sql);
        const t = lexer.nextToken();
        
        expect(t.type).toBe(TokenType.Number);
        expect(t.value).toBe('123.45');
    });
});