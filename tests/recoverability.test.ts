import { Lexer } from '../src/lexer';
import {
    Parser,
    Statement,
    SelectNode,
    InsertNode,
    UpdateNode,
    DeleteNode,
    DeclareNode,
    SetNode,
    PrintNode
} from '../src/parser';

const parse = (sql: string) => {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer);
    return parser.parse().ast;
};

function first(sql: string): Statement {
    const ast = parse(sql);
    expect(ast.body.length).toBeGreaterThan(0);
    return ast.body[0];
}

function expectRecoverable(
    sql: string,
    type: Statement['type']
) {
    expect(() => parse(sql)).not.toThrow();

    const stmt = first(sql);

    // Must parse into expected supported node
    expect(stmt.type).toBe(type);

    // Must never hard-fail
    expect(stmt.type).not.toBe('ErrorStatement');

    // incomplete flag is OPTIONAL:
    // only set when parser explicitly knows statement is partial
    if ('incomplete' in stmt) {
        expect(typeof (stmt as any).incomplete)
            .toBe('boolean');
    }

    return stmt;
}

describe('Recoverability - Part 1A - Core Statements', () => {
    describe('SELECT', () => {
        const cases = [
            'SELECT',
            'SELECT FROM',
            'SELECT * FROM',
            'SELECT * FROM WHERE',
            'SELECT Name FROM Users WHERE',
            'SELECT DISTINCT',
            'SELECT DISTINCT FROM',
            'SELECT TOP',
            'SELECT TOP (',
            'SELECT TOP (10',
            'SELECT TOP ()',
            'SELECT TOP 10',
            'SELECT TOP 10 FROM',
            'SELECT TOP 10 PERCENT',
            'SELECT TOP 10 PERCENT FROM',
            'SELECT ,',
            'SELECT Name,',
            'SELECT Name,,Age',
            'SELECT Name, ,Age',
            'SELECT Name FROM ,',
            'SELECT Name FROM Users,',
            'SELECT Name GROUP',
            'SELECT Name ORDER',
            'SELECT Name HAVING',
            'SELECT Name WHERE',
            'SELECT (',
            'SELECT )',
            'SELECT +',
            'SELECT CASE',
            'SELECT CASE WHEN',
            'SELECT CASE WHEN 1=1',
            'SELECT CASE WHEN 1=1 THEN',
            'SELECT CASE WHEN 1=1 THEN 1 ELSE',
            'SELECT Name IN (',
            'SELECT Name BETWEEN',
            'SELECT Name BETWEEN 1',
            'SELECT Name BETWEEN 1 AND',
            'SELECT ABS(',
            'SELECT dbo.',
            'SELECT @',
            'SELECT @@'
        ];

        test.each(cases)('%s', sql => {
            expectRecoverable(sql, 'SelectStatement');
        });

        test('broken SELECT still returns SelectNode', () => {
            const stmt = first('SELECT FROM') as SelectNode;

            expect(stmt.type).toBe('SelectStatement');
            expect(stmt.columns).not.toBeNull();
        });

        test('SELECT preserves partial location', () => {
            const sql = 'SELECT Name FROM';
            const stmt = first(sql);

            expect(stmt.start).toBe(0);
            expect(stmt.end).toBeGreaterThan(0);
            expect(stmt.end).toBeLessThanOrEqual(sql.length);
        });
    });

    describe('INSERT', () => {
        const cases = [
            'INSERT',
            'INSERT INTO',
            'INSERT INTO T',
            'INSERT INTO T(',
            'INSERT INTO T()',
            'INSERT INTO T(Id',
            'INSERT INTO T(Id,',
            'INSERT INTO T(,Id)',
            'INSERT INTO T(=)',
            'INSERT INTO T VALUES',
            'INSERT INTO T VALUES (',
            'INSERT INTO T VALUES ()',
            'INSERT INTO T VALUES (1',
            'INSERT INTO T VALUES (1,',
            'INSERT INTO T VALUES (,1)',
            'INSERT INTO T VALUES (1,), (2)',
            'INSERT INTO T VALUES (1),(2,),',
            'INSERT INTO T SELECT',
            'INSERT INTO T WITH',
            'INSERT INTO VALUES (1)',
            'INSERT T VALUES (1)',
            'INSERT INTO dbo.',
            'INSERT INTO #Temp('
        ];

        test.each(cases)('%s', sql => {
            expectRecoverable(sql, 'InsertStatement');
        });

        test('INSERT returns InsertNode on malformed values', () => {
            const stmt = first('INSERT INTO T VALUES (') as InsertNode;

            expect(stmt.type).toBe('InsertStatement');
            expect(stmt.values).not.toBeNull();
        });

        test('INSERT missing table still returns node', () => {
            const stmt = first('INSERT INTO VALUES (1)') as InsertNode;

            expect(stmt.type).toBe('InsertStatement');
            expect(stmt.incomplete).toBe(true);
        });
    });

    describe('UPDATE', () => {
        const cases = [
            'UPDATE',
            'UPDATE T',
            'UPDATE dbo.',
            'UPDATE T SET',
            'UPDATE T SET Name',
            'UPDATE T SET Name =',
            'UPDATE T SET Name = ,',
            'UPDATE T SET Name = 1,',
            'UPDATE T SET = 1',
            'UPDATE T SET ,',
            'UPDATE T SET Name = 1 WHERE',
            'UPDATE T SET Name = 1 FROM',
            'UPDATE T SET Name = 1 FROM X WHERE',
            'UPDATE SET Name = 1',
            'UPDATE T WHERE',
            'UPDATE T SET Name = (',
            'UPDATE T SET Name = CASE',
            'UPDATE T SET Name = CASE WHEN'
        ];

        test.each(cases)('%s', sql => {
            expectRecoverable(sql, 'UpdateStatement');
        });

        test('UPDATE preserves assignment array', () => {
            const stmt = first('UPDATE T SET Name =') as UpdateNode;

            expect(stmt.type).toBe('UpdateStatement');
            expect(stmt.assignments).not.toBeNull();
        });
    });

    describe('DELETE', () => {
        const cases = [
            'DELETE',
            'DELETE FROM',
            'DELETE FROM WHERE',
            'DELETE FROM T WHERE',
            'DELETE FROM dbo.',
            'DELETE T FROM',
            'DELETE T FROM Users WHERE',
            'DELETE FROM T FROM',
            'DELETE FROM T FROM X WHERE',
            'DELETE WHERE',
            'DELETE FROM ,',
            'DELETE FROM T WHERE (',
            'DELETE FROM T WHERE Name IN ('
        ];

        test.each(cases)('%s', sql => {
            expectRecoverable(sql, 'DeleteStatement');
        });

        test('DELETE returns DeleteNode', () => {
            const stmt = first('DELETE FROM T WHERE') as DeleteNode;

            expect(stmt.type).toBe('DeleteStatement');
        });
    });

    describe('DECLARE', () => {
        const cases = [
            'DECLARE',
            'DECLARE @x',
            'DECLARE @x INT =',
            'DECLARE @x =',
            'DECLARE @x INT = (',
            'DECLARE @x,',
            'DECLARE ,',
            'DECLARE @@x',
        ];

        test.each(cases)('%s', sql => {
            expectRecoverable(sql, 'DeclareStatement');
        });

        test('DECLARE returns DeclareNode', () => {
            const stmt = first('DECLARE @x') as DeclareNode;

            expect(stmt.type).toBe('DeclareStatement');
        });
    });

    describe('SET', () => {
        const cases = [
            'SET',
            'SET @x',
            'SET @x =',
            'SET @x = (',
            'SET @x = CASE',
            'SET @@ROWCOUNT',
            'SET @@ROWCOUNT =',
            'SET @@ROWCOUNT = 1 +',
            'SET NOCOUNT',
            'SET NOCOUNT ON',
            'SET ANSI_NULLS',
            'SET ANSI_NULLS ON',
            'SET TRANSACTION',
            'SET TRANSACTION ISOLATION',
            'SET TRANSACTION ISOLATION LEVEL',
            'SET TRANSACTION ISOLATION LEVEL READ',
            'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
            'SET =',
            'SET ON'
        ];

        test.each(cases)('%s', sql => {
            expect(() => parse(sql)).not.toThrow();

            const stmt = first(sql) as SetNode;

            expect(stmt.type).toBe('SetStatement');
        });

        test('SET variable assignment recovers', () => {
            const stmt = first('SET @x =') as SetNode;

            expect(stmt.incomplete).toBe(true);
        });

        test('SET session option is valid node', () => {
            const stmt = first(
                'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'
            ) as SetNode;

            expect(stmt.type).toBe('SetStatement');
            expect(stmt.variable).toContain('TRANSACTION');
        });
    });

    describe('PRINT', () => {
        const cases = [
            'PRINT',
            'PRINT +',
            'PRINT ,',
            'PRINT )',
            'PRINT (',
            'PRINT CASE',
            'PRINT CASE WHEN',
            'PRINT ABS('
        ];

        test.each(cases)('%s', sql => {
            expectRecoverable(sql, 'PrintStatement');
        });

        test('PRINT null value is recoverable', () => {
            const stmt = first('PRINT') as PrintNode;

            expect(stmt.type).toBe('PrintStatement');
            expect(stmt.value).toBeNull();
        });
    });

    describe('Continuation', () => {
        test('continues after broken SELECT', () => {
            const ast = parse(`
                SELECT FROM;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe('SelectStatement');
        });

        test('continues after broken INSERT', () => {
            const ast = parse(`
                INSERT INTO T VALUES (;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe('SelectStatement');
        });

        test('continues after broken UPDATE', () => {
            const ast = parse(`
                UPDATE T SET Name = ;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe('SelectStatement');
        });

        test('continues after broken DELETE', () => {
            const ast = parse(`
                DELETE FROM T WHERE ;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe('SelectStatement');
        });
    });
});