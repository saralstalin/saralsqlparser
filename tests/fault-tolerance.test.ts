import { Lexer, TokenType } from '../src/lexer';
import { Parser } from '../src/parser';

describe('Parser Fault Tolerance', () => {
    test('should recover from a missing FROM clause', () => {
        // User is currently typing...
        const sql = 'SELECT Name, FROM Users;';
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);

        const ast = parser.parse().ast;

        // The parser should have "resynced" and still found the statement
        expect(ast.body.length).toBeGreaterThan(0);
        // Ensure it didn't throw an unhandled exception
    });

    test('should isolate errors in multi-batch scripts', () => {
        const sql = `
        SELECT * FROM ValidTable;
        GO
        !@#$%^&*() -- Pure garbage that cannot be a SELECT
        GO
        SELECT * FROM AnotherValidTable;
    `;
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        const ast = parser.parse().ast;

        // Filter for valid SelectStatements
        const validStatements = ast.body.filter(s => s.type === 'SelectStatement');

        // Now it should strictly be 2
        expect(validStatements.length).toBe(2);
    });
});