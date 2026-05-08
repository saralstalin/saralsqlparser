import {
    parseOne,
    parseAst,
    expectSql
} from './parser.helpers';

describe('T-SQL Parser - RETURN', () => {
    test('should parse bare RETURN', () => {
        const stmt = parseOne<any>(`RETURN`);

        expect(stmt.type).toBe('ReturnStatement');
        expect(stmt.value).toBeNull();
        expect(stmt.incomplete).toBeUndefined();
    });

    test('should parse RETURN literal', () => {
        const stmt = parseOne<any>(`RETURN 1`);

        expect(stmt.type).toBe('ReturnStatement');
        expectSql(stmt.value, '1');
    });

    test('should parse RETURN string literal', () => {
        const stmt = parseOne<any>(`RETURN 'done'`);

        expect(stmt.type).toBe('ReturnStatement');
        expectSql(stmt.value, `'done'`);
    });

    test('should parse RETURN variable', () => {
        const stmt = parseOne<any>(`RETURN @Result`);

        expect(stmt.type).toBe('ReturnStatement');
        expect(stmt.value.type).toBe('Variable');
        expect(stmt.value.name).toBe('@Result');
    });

    test('should parse RETURN arithmetic expression', () => {
        const stmt = parseOne<any>(`RETURN 1 + 2 * 3`);

        expect(stmt.type).toBe('ReturnStatement');
        expectSql(stmt.value, '1 + 2 * 3');
    });

    test('should parse RETURN grouping expression', () => {
        const stmt = parseOne<any>(`RETURN (1 + 2) * 3`);

        expect(stmt.type).toBe('ReturnStatement');
        expectSql(stmt.value, '(1 + 2) * 3');
    });

    test('should parse RETURN function call', () => {
        const stmt = parseOne<any>(`RETURN LEN(@Name)`);

        expect(stmt.type).toBe('ReturnStatement');
        expectSql(stmt.value, 'LEN(@Name)');
    });

    test('should parse RETURN CASE expression', () => {
        const stmt = parseOne<any>(`
            RETURN CASE
                WHEN @Flag = 1 THEN 100
                ELSE 0
            END
        `);

        expect(stmt.type).toBe('ReturnStatement');
        expectSql(
            stmt.value,
            'CASE WHEN @Flag = 1 THEN 100 ELSE 0 END'
        );
    });

    test('should parse RETURN in IF branch', () => {
        const ast = parseAst(`
            IF @X = 1
                RETURN 10
        `);

        const ifStmt = ast.body[0] as any;

        expect(ifStmt.type).toBe('IfStatement');

        const branch = Array.isArray(ifStmt.thenBranch)
            ? ifStmt.thenBranch[0]
            : ifStmt.thenBranch;

        expect(branch.type).toBe('ReturnStatement');
        expectSql(branch.value, '10');
    });

    test('should parse RETURN inside BEGIN END block', () => {
        const ast = parseAst(`
            BEGIN
                RETURN 5
            END
        `);

        const block = ast.body[0] as any;

        expect(block.type).toBe('BlockStatement');
        expect(block.body).toHaveLength(1);
        expect(block.body[0].type).toBe('ReturnStatement');
        expectSql(block.body[0].value, '5');
    });
});

describe('T-SQL Parser - RAISERROR', () => {
    test('should parse RAISERROR with standard 3 args', () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1)
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.args).toHaveLength(3);

        expectSql(stmt.args[0], `'bad'`);
        expectSql(stmt.args[1], '16');
        expectSql(stmt.args[2], '1');

        expect(stmt.options).toBeUndefined();
    });

    test('should parse RAISERROR variable message', () => {
        const stmt = parseOne<any>(`
            RAISERROR(@msg, 16, 1)
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.args).toHaveLength(3);

        expect(stmt.args[0].type).toBe('Variable');
        expect(stmt.args[0].name).toBe('@msg');
    });

    test('should parse RAISERROR function argument', () => {
        const stmt = parseOne<any>(`
            RAISERROR(FORMATMESSAGE('bad %d', @Id), 16, 1)
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.args).toHaveLength(3);

        expect(stmt.args[0].type).toBe('FunctionCall');
    });

    test('should parse RAISERROR arithmetic argument', () => {
        const stmt = parseOne<any>(`
            RAISERROR(@Msg, 10 + 6, 1)
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.args).toHaveLength(3);

        expectSql(stmt.args[1], '10 + 6');
    });

    test('should parse RAISERROR WITH NOWAIT', () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1) WITH NOWAIT
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.options).toEqual([
            'NOWAIT'
        ]);
    });

    test('should parse RAISERROR WITH LOG', () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1) WITH LOG
        `);

        expect(stmt.options).toEqual([
            'LOG'
        ]);
    });

    test('should parse RAISERROR WITH multiple options', () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1)
            WITH LOG, NOWAIT, SETERROR
        `);

        expect(stmt.options).toEqual([
            'LOG',
            'NOWAIT',
            'SETERROR'
        ]);
    });

    test('should parse RAISERROR inside IF', () => {
        const ast = parseAst(`
            IF @X = 1
                RAISERROR('bad',16,1)
        `);

        const ifStmt = ast.body[0] as any;

        const branch = Array.isArray(ifStmt.thenBranch)
            ? ifStmt.thenBranch[0]
            : ifStmt.thenBranch;

        expect(branch.type).toBe('RaiseErrorStatement');
        expect(branch.args).toHaveLength(3);
    });

    test('should parse RAISERROR inside BEGIN END block', () => {
        const ast = parseAst(`
            BEGIN
                RAISERROR('bad',16,1)
            END
        `);

        const block = ast.body[0] as any;

        expect(block.type).toBe('BlockStatement');
        expect(block.body).toHaveLength(1);
        expect(block.body[0].type).toBe('RaiseErrorStatement');
    });

    test('should recover missing closing paren', () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad',16,1
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.incomplete).toBe(true);
    });

    test('should recover empty WITH clause', () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad',16,1) WITH
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.incomplete).toBe(true);
    });

    test('should recover missing opening paren', () => {
        const stmt = parseOne<any>(`
            RAISERROR 'bad',16,1
        `);

        expect(stmt.type).toBe('RaiseErrorStatement');
        expect(stmt.incomplete).toBe(true);
    });
});