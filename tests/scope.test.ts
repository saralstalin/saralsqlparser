import { Lexer } from '../src/lexer';
import { Parser } from '../src/parser';
import { ScopeBuilder } from '../src/scopeBuilder';
import { SymbolKind } from '../src/scope';

function build(sql: string) {
    const parser = new Parser(new Lexer(sql));
    const result = parser.parse();
    const scope = new ScopeBuilder().build(result.ast);

    return {
        ast: result.ast,
        scope
    };
}

function buildScope(sql: string) {
    return build(sql).scope;
}

describe('ScopeBuilder', () => {
    test('DECLARE scalar variable', () => {
        const scope = buildScope(`
            DECLARE @Id INT;
        `);

        const sym = scope.resolve('@Id');

        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Variable);
        expect(sym?.dataType).toBe('INT');
    });

    test('DECLARE multiple variables', () => {
        const scope = buildScope(`
            DECLARE @Id INT, @Name VARCHAR(100), @Amount DECIMAL(18,2);
        `);

        expect(scope.resolve('@Id')?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolve('@Name')?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolve('@Amount')?.kind).toBe(SymbolKind.Variable);
    });

    test('DECLARE table variable', () => {
        const scope = buildScope(`
            DECLARE @Users TABLE(
                Id INT,
                Name VARCHAR(100)
            );
        `);

        const sym = scope.resolve('@Users');

        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(['Id', 'Name']);
    });

    test('CREATE TABLE', () => {
        const scope = buildScope(`
            CREATE TABLE dbo.Users(
                Id INT,
                Name VARCHAR(100)
            );
        `);

        const sym = scope.resolve('dbo.Users');

        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(['Id', 'Name']);
    });

    test('CREATE VIEW', () => {
        const scope = buildScope(`
            CREATE VIEW dbo.ActiveUsers AS
            SELECT Id FROM dbo.Users;
        `);

        expect(scope.resolve('dbo.ActiveUsers')?.kind)
            .toBe(SymbolKind.Table);
    });

    test('CREATE TYPE AS TABLE', () => {
        const scope = buildScope(`
            CREATE TYPE dbo.UserType AS TABLE(
                Id INT,
                Name VARCHAR(50)
            );
        `);

        const sym = scope.resolve('dbo.UserType');

        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Type);
        expect(sym?.columns).toEqual(['Id', 'Name']);
    });

    test('procedure symbol registered globally', () => {
        const scope = buildScope(`
            CREATE PROCEDURE dbo.TestProc
                @Id INT
            AS
            BEGIN
                SELECT @Id;
            END
        `);

        const sym = scope.resolve('dbo.TestProc');

        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Procedure);
    });

    test('procedure parameter local scope', () => {
        const scope = buildScope(`
            CREATE PROCEDURE dbo.TestProc
                @Id INT,
                @Name VARCHAR(100)
            AS
            BEGIN
                SELECT @Id, @Name;
            END
        `);

        const procScope = scope.getChildren().find(x => x.name === 'dbo.TestProc');

        expect(procScope).toBeDefined();

        expect(procScope?.resolveLocal('@Id')?.kind)
            .toBe(SymbolKind.Parameter);

        expect(procScope?.resolveLocal('@Name')?.kind)
            .toBe(SymbolKind.Parameter);

        expect(scope.resolveLocal('@Id')).toBeUndefined();
        expect(scope.resolveLocal('@Name')).toBeUndefined();
    });

    test('block variable shadows parent', () => {
        const scope = buildScope(`
            DECLARE @Id INT;

            BEGIN
                DECLARE @Id VARCHAR(50);
                SELECT @Id;
            END
        `);

        const block = scope.getChildren().find(x => x.name === 'block');

        expect(scope.resolveLocal('@Id')?.dataType).toBe('INT');
        expect(block?.resolveLocal('@Id')?.dataType).toBe('VARCHAR(50)');
        expect(block?.resolve('@Id')?.dataType).toBe('VARCHAR(50)');
    });

    test('block inherits parent symbols', () => {
        const scope = buildScope(`
            DECLARE @Id INT;

            BEGIN
                SELECT @Id;
            END
        `);

        const block = scope.getChildren().find(x => x.name === 'block');

        expect(block?.resolve('@Id')).toBeDefined();
        expect(block?.resolve('@Id')?.kind).toBe(SymbolKind.Variable);
    });

    test('cte visible only inside WITH scope', () => {
        const scope = buildScope(`
            WITH Users AS (
                SELECT 1 Id
            )
            SELECT * FROM Users;
        `);

        const withScope = scope.getChildren().find(x => x.name === 'with');

        expect(withScope?.resolveLocal('Users')?.kind)
            .toBe(SymbolKind.CTE);

        expect(scope.resolveLocal('Users')).toBeUndefined();
    });

    test('table alias in select scope', () => {
        const scope = buildScope(`
            SELECT u.Id
            FROM dbo.Users u;
        `);

        const selectScope = scope.getChildren().find(x => x.name === 'select');

        expect(selectScope?.resolveLocal('u')).toBeDefined();
        expect(selectScope?.resolveLocal('u')?.kind)
            .toBe(SymbolKind.Alias);
    });

    test('join alias registered', () => {
        const scope = buildScope(`
            SELECT *
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `);

        const selectScope = scope.getChildren().find(x => x.name === 'select');

        expect(selectScope?.resolveLocal('u')?.kind)
            .toBe(SymbolKind.Alias);

        expect(selectScope?.resolveLocal('r')?.kind)
            .toBe(SymbolKind.Alias);
    });

    test('nested scopes resolve outward', () => {
        const scope = buildScope(`
            DECLARE @Outer INT;

            BEGIN
                DECLARE @Inner INT;

                BEGIN
                    DECLARE @Deep INT;
                    SELECT @Outer, @Inner, @Deep;
                END
            END
        `);

        const block1 = scope.getChildren().find(x => x.name === 'block')!;
        const block2 = block1.getChildren().find(x => x.name === 'block')!;

        expect(block2.resolve('@Outer')).toBeDefined();
        expect(block2.resolve('@Inner')).toBeDefined();
        expect(block2.resolve('@Deep')).toBeDefined();
    });

    test('findInnermost returns deepest scope', () => {
        const scope = buildScope(`
            DECLARE @A INT;

            BEGIN
                DECLARE @B INT;

                BEGIN
                    DECLARE @C INT;
                    SELECT @C;
                END
            END
        `);

        const block1 = scope.getChildren().find(x => x.name === 'block')!;
        const block2 = block1.getChildren().find(x => x.name === 'block')!;

        const c = block2.resolveLocal('@C')!;
        const deepest = scope.findInnermost(c.location.start);

        expect(deepest.resolveLocal('@C')).toBeDefined();
        expect(deepest.resolve('@B')).toBeDefined();
        expect(deepest.resolve('@A')).toBeDefined();

        expect(deepest.resolveLocal('@C')?.kind).toBe(SymbolKind.Variable);
        expect(deepest.resolve('@B')?.kind).toBe(SymbolKind.Variable);
        expect(deepest.resolve('@A')?.kind).toBe(SymbolKind.Variable);
    });

    test('visible symbols honors shadowing', () => {
        const scope = buildScope(`
            DECLARE @Id INT;

            BEGIN
                DECLARE @Id VARCHAR(10);
                DECLARE @Name VARCHAR(20);
            END
        `);

        const block = scope.getChildren().find(x => x.name === 'block')!;
        const visible = block.getVisibleSymbols();

        const names = visible.map(x => x.name);

        expect(names.filter(x => x === '@Id')).toHaveLength(1);
        expect(names).toContain('@Name');

        const id = visible.find(x => x.name === '@Id');

        expect(id?.dataType).toBe('VARCHAR(10)');
    });
});
