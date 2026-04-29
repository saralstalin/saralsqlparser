import { Lexer } from '../src/lexer';
import { Parser } from '../src/parser';
import { ScopeBuilder, ScopeBuilderResult } from '../src/scopeBuilder';
import { SymbolKind } from '../src/scope';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function build(sql: string): ScopeBuilderResult {
    const { ast } = new Parser(new Lexer(sql)).parse();
    return new ScopeBuilder().build(ast);
}

// Shorthand when only the root scope is needed
function rootScope(sql: string) {
    return build(sql).root;
}

// ─── 1. Variable Declaration ──────────────────────────────────────────────────

describe('DECLARE', () => {
    test('scalar variable', () => {
        const scope = rootScope(`DECLARE @Id INT;`);
        const sym = scope.resolve('@Id');
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Variable);
        expect(sym?.dataType).toBe('INT');
    });

    test('multiple variables in one statement', () => {
        const scope = rootScope(`
            DECLARE @Id INT, @Name VARCHAR(100), @Amount DECIMAL(18,2);
        `);
        expect(scope.resolve('@Id')?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolve('@Name')?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolve('@Amount')?.kind).toBe(SymbolKind.Variable);
    });

    test('table variable', () => {
        const scope = rootScope(`
            DECLARE @Users TABLE(
                Id   INT,
                Name VARCHAR(100)
            );
        `);
        const sym = scope.resolve('@Users');
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(['Id', 'Name']);
    });

    test('declaration with initialiser visits expression', () => {
        // @Base is referenced inside @Derived's initialiser
        const result = build(`
            DECLARE @Base   INT = 10;
            DECLARE @Derived INT = @Base + 5;
        `);
        const baseSym = result.root.resolve('@Base');
        expect(baseSym?.references.length).toBeGreaterThan(0);
    });
});

// ─── 2. CREATE ────────────────────────────────────────────────────────────────

describe('CREATE', () => {
    test('CREATE TABLE', () => {
        const scope = rootScope(`
            CREATE TABLE dbo.Users(
                Id   INT,
                Name VARCHAR(100)
            );
        `);
        const sym = scope.resolve('dbo.Users');
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(['Id', 'Name']);
    });

    test('CREATE VIEW', () => {
        const scope = rootScope(`
            CREATE VIEW dbo.ActiveUsers AS
            SELECT Id FROM dbo.Users;
        `);
        expect(scope.resolve('dbo.ActiveUsers')?.kind).toBe(SymbolKind.Table);
    });

    test('CREATE TYPE AS TABLE', () => {
        const scope = rootScope(`
            CREATE TYPE dbo.UserType AS TABLE(
                Id   INT,
                Name VARCHAR(50)
            );
        `);
        const sym = scope.resolve('dbo.UserType');
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Type);
        expect(sym?.columns).toEqual(['Id', 'Name']);
    });

    test('procedure symbol registered in root scope', () => {
        const scope = rootScope(`
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

    test('procedure parameters live in proc child scope, not root', () => {
        const scope = rootScope(`
            CREATE PROCEDURE dbo.TestProc
                @Id   INT,
                @Name VARCHAR(100)
            AS
            BEGIN
                SELECT @Id, @Name;
            END
        `);
        const procScope = scope.getChildren()
            .find(x => x.name === 'dbo.TestProc');

        expect(procScope).toBeDefined();
        expect(procScope?.resolveLocal('@Id')?.kind).toBe(SymbolKind.Parameter);
        expect(procScope?.resolveLocal('@Name')?.kind).toBe(SymbolKind.Parameter);

        // Parameters must NOT leak into root
        expect(scope.resolveLocal('@Id')).toBeUndefined();
        expect(scope.resolveLocal('@Name')).toBeUndefined();
    });

    test('variables declared inside proc body are in proc scope', () => {
        const scope = rootScope(`
            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                DECLARE @Local INT;
                SELECT @Local;
            END
        `);
        const procScope = scope.getChildren()
            .find(x => x.name === 'dbo.Proc1');

        expect(procScope?.resolve('@Local')?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolveLocal('@Local')).toBeUndefined();
    });
});

// ─── 3. Block scoping (T-SQL variable scoping rules) ─────────────────────────

describe('BEGIN…END block scoping', () => {
    // T-SQL: variables are batch/procedure-scoped, NOT block-scoped.
    // A DECLARE inside BEGIN…END is visible after the END.
    test('variable declared inside block is visible in parent scope', () => {
        const scope = rootScope(`
            BEGIN
                DECLARE @Inner INT;
            END
            SELECT @Inner;
        `);
        // Must resolve from root because blocks do NOT create a new scope
        expect(scope.resolve('@Inner')?.kind).toBe(SymbolKind.Variable);
    });

    test('BEGIN…END does NOT create a child scope node', () => {
        const scope = rootScope(`
            DECLARE @A INT;
            BEGIN
                DECLARE @B INT;
            END
        `);
        // Both symbols live in root — no 'block' child scope should exist
        expect(scope.resolveLocal('@A')).toBeDefined();
        expect(scope.resolveLocal('@B')).toBeDefined();
        // No block child scope
        const block = scope.getChildren().find(x => x.name === 'block');
        expect(block).toBeUndefined();
    });

    test('nested blocks both resolve to root', () => {
        const scope = rootScope(`
            DECLARE @Outer INT;

            BEGIN
                DECLARE @Inner INT;

                BEGIN
                    DECLARE @Deep INT;
                END
            END
        `);
        // All three visible from root
        expect(scope.resolveLocal('@Outer')).toBeDefined();
        expect(scope.resolveLocal('@Inner')).toBeDefined();
        expect(scope.resolveLocal('@Deep')).toBeDefined();
    });
});

// ─── 4. CTEs ─────────────────────────────────────────────────────────────────

describe('CTEs', () => {
    test('CTE name is visible inside WITH scope', () => {
        const scope = rootScope(`
            WITH Users AS (SELECT 1 Id)
            SELECT * FROM Users;
        `);
        const withScope = scope.getChildren().find(x => x.name === 'with');
        expect(withScope?.resolveLocal('Users')?.kind).toBe(SymbolKind.CTE);
    });

    test('CTE name does NOT leak into root scope', () => {
        const scope = rootScope(`
            WITH Users AS (SELECT 1 Id)
            SELECT * FROM Users;
        `);
        expect(scope.resolveLocal('Users')).toBeUndefined();
    });

    test('multiple CTEs all registered in WITH scope', () => {
        const scope = rootScope(`
            WITH
                A AS (SELECT 1 x),
                B AS (SELECT 2 y)
            SELECT * FROM A JOIN B ON A.x = B.y;
        `);
        const withScope = scope.getChildren().find(x => x.name === 'with');
        expect(withScope?.resolveLocal('A')?.kind).toBe(SymbolKind.CTE);
        expect(withScope?.resolveLocal('B')?.kind).toBe(SymbolKind.CTE);
    });
});

// ─── 5. SELECT scope / aliases ────────────────────────────────────────────────

describe('SELECT aliases', () => {
    test('table alias registered in select scope', () => {
        const scope = rootScope(`
            SELECT u.Id FROM dbo.Users u;
        `);
        const selectScope = scope.getChildren().find(x => x.name === 'select');
        expect(selectScope?.resolveLocal('u')?.kind).toBe(SymbolKind.Alias);
    });

    test('JOIN alias registered in select scope', () => {
        const scope = rootScope(`
            SELECT *
            FROM   dbo.Users u
            JOIN   dbo.Roles r ON r.Id = u.RoleId;
        `);
        const selectScope = scope.getChildren().find(x => x.name === 'select');
        expect(selectScope?.resolveLocal('u')?.kind).toBe(SymbolKind.Alias);
        expect(selectScope?.resolveLocal('r')?.kind).toBe(SymbolKind.Alias);
    });

    test('table alias does NOT leak into root scope', () => {
        const scope = rootScope(`
            SELECT u.Id FROM dbo.Users u;
        `);
        expect(scope.resolveLocal('u')).toBeUndefined();
    });

    test('column alias registered in select scope', () => {
        const scope = rootScope(`
            SELECT Name AS UserName FROM dbo.Users;
        `);
        const selectScope = scope.getChildren().find(x => x.name === 'select');
        expect(selectScope?.resolveLocal('UserName')?.kind).toBe(SymbolKind.Alias);
    });
});

// ─── 6. Reference tracking ────────────────────────────────────────────────────

describe('reference tracking', () => {
    test('variable used in SET is recorded as reference', () => {
        const result = build(`
            DECLARE @Counter INT = 0;
            SET @Counter = @Counter + 1;
        `);
        const sym = result.root.resolve('@Counter');
        // One reference from SET right-hand side
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable used in WHERE is recorded as reference', () => {
        const result = build(`
            DECLARE @Id INT = 1;
            SELECT Name FROM Users WHERE Id = @Id;
        `);
        const sym = result.root.resolve('@Id');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable used in JOIN ON is recorded', () => {
        const result = build(`
            DECLARE @DeptId INT = 5;
            SELECT e.Name
            FROM   Employees e
            JOIN   Departments d ON d.Id = @DeptId;
        `);
        const sym = result.root.resolve('@DeptId');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable used in HAVING is recorded', () => {
        const result = build(`
            DECLARE @Min INT = 100;
            SELECT DeptId, SUM(Salary) s
            FROM   Employees
            GROUP  BY DeptId
            HAVING SUM(Salary) > @Min;
        `);
        const sym = result.root.resolve('@Min');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable used in PRINT is recorded', () => {
        const result = build(`
            DECLARE @Msg VARCHAR(100) = 'hello';
            PRINT @Msg;
        `);
        const sym = result.root.resolve('@Msg');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable used in UPDATE SET is recorded', () => {
        const result = build(`
            DECLARE @Status INT = 1;
            UPDATE Users SET Status = @Status WHERE Id = 1;
        `);
        const sym = result.root.resolve('@Status');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable used in INSERT VALUES is recorded', () => {
        const result = build(`
            DECLARE @Name VARCHAR(50) = 'Alice';
            INSERT INTO Users (Name) VALUES (@Name);
        `);
        const sym = result.root.resolve('@Name');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('declared but never used has zero references', () => {
        const result = build(`
            DECLARE @Unused INT;
            SELECT 1;
        `);
        const sym = result.root.resolve('@Unused');
        expect(sym?.references.length).toBe(0);
    });
});

// ─── 7. Undeclared variable detection ────────────────────────────────────────

describe('undeclared variable detection', () => {
    test('undeclared variable in WHERE is reported', () => {
        const result = build(`
            SELECT Name FROM Users WHERE Id = @Ghost;
        `);
        expect(result.undeclared.length).toBeGreaterThan(0);
        const names = Array.from(result.references.keys());
        expect(names).toContain('@ghost');
    });

    test('declared variable is NOT in undeclared list', () => {
        const result = build(`
            DECLARE @Id INT = 1;
            SELECT Name FROM Users WHERE Id = @Id;
        `);
        expect(result.undeclared.length).toBe(0);
    });

    test('system variables (@@ROWCOUNT etc.) are never undeclared', () => {
        const result = build(`
            SELECT @@ROWCOUNT;
            SELECT @@ERROR;
            SELECT @@IDENTITY;
        `);
        expect(result.undeclared.length).toBe(0);
    });

    test('undeclared variable in SET is reported', () => {
        const result = build(`
        DECLARE @Real INT = 1;
        SET @Real = @Ghost + 1;  -- @Ghost is undeclared in the RHS expression
    `);
        expect(result.undeclared.length).toBeGreaterThan(0);
    });
});

// ─── 8. Expression visitor coverage ──────────────────────────────────────────

describe('expression visitor', () => {
    test('variable inside CASE WHEN is recorded', () => {
        const result = build(`
            DECLARE @Flag INT = 1;
            SELECT CASE WHEN @Flag = 1 THEN 'Yes' ELSE 'No' END;
        `);
        const sym = result.root.resolve('@Flag');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable inside IN list is recorded', () => {
        const result = build(`
            DECLARE @A INT = 1;
            DECLARE @B INT = 2;
            SELECT x FROM T WHERE Id IN (@A, @B);
        `);
        expect(result.root.resolve('@A')?.references.length).toBeGreaterThanOrEqual(1);
        expect(result.root.resolve('@B')?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable inside BETWEEN is recorded', () => {
        const result = build(`
            DECLARE @Lo INT = 1;
            DECLARE @Hi INT = 10;
            SELECT x FROM T WHERE Id BETWEEN @Lo AND @Hi;
        `);
        expect(result.root.resolve('@Lo')?.references.length).toBeGreaterThanOrEqual(1);
        expect(result.root.resolve('@Hi')?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable inside subquery IN is recorded', () => {
        const result = build(`
            DECLARE @DeptId INT = 3;
            SELECT Name FROM Employees
            WHERE DeptId IN (SELECT Id FROM Depts WHERE ParentId = @DeptId);
        `);
        const sym = result.root.resolve('@DeptId');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test('variable inside OVER PARTITION BY is recorded', () => {
        const result = build(`
            DECLARE @Cat INT = 1;
            SELECT ROW_NUMBER() OVER (PARTITION BY @Cat ORDER BY Id) rn
            FROM T;
        `);
        const sym = result.root.resolve('@Cat');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });
});

// ─── 9. Derived tables ────────────────────────────────────────────────────────

describe('derived tables', () => {
    test('derived table subquery creates nested scope', () => {
        const scope = rootScope(`
            SELECT d.x
            FROM (SELECT 1 AS x) d;
        `);
        // outer select scope
        const selectScope = scope.getChildren().find(x => x.name === 'select');
        expect(selectScope).toBeDefined();
        // inner subquery scope nested inside select
        const subqueryScope = selectScope?.getChildren()
            .find(x => x.name === 'subquery');
        expect(subqueryScope).toBeDefined();
    });

    test('variable inside derived table subquery is recorded', () => {
        const result = build(`
            DECLARE @Val INT = 42;
            SELECT d.x
            FROM (SELECT @Val AS x) d;
        `);
        const sym = result.root.resolve('@Val');
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });
});

// ─── 10. ScopeBuilderResult references map ────────────────────────────────────

describe('ScopeBuilderResult', () => {
    test('references map contains all variable names used', () => {
        const result = build(`
            DECLARE @A INT = 1;
            DECLARE @B INT = 2;
            SELECT @A + @B;
        `);
        expect(result.references.has('@a')).toBe(true);
        expect(result.references.has('@b')).toBe(true);
    });

    test('references map is case-insensitive keyed', () => {
        const result = build(`
            DECLARE @MyVar INT = 99;
            SELECT @myvar + @MYVAR;
        `);
        // All variations land under the same lowercase key
        const refs = result.references.get('@myvar');
        expect(refs).toBeDefined();
        expect(refs!.length).toBe(2);
    });

    test('undeclared list location points to usage site', () => {
        const result = build(`SELECT @Ghost;`);
        expect(result.undeclared.length).toBeGreaterThan(0);
        // Location must be a valid offset object
        const loc = result.undeclared[0].location;
        expect(typeof loc.start).toBe('number');
        expect(typeof loc.end).toBe('number');
        expect(loc.start).toBeGreaterThanOrEqual(0);
    });
});

// ─── 11. Scope utility methods ────────────────────────────────────────────────

describe('Scope utilities', () => {
    test('findInnermost returns deepest scope containing offset', () => {
        const result = build(`
            DECLARE @A INT;

            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                DECLARE @B INT;
                SELECT @B;
            END
        `);

        const procScope = result.root.getChildren()
            .find(x => x.name === 'dbo.Proc1')!;

        const bSym = procScope.resolveLocal('@B')!;
        const deepest = result.root.findInnermost(bSym.location.start);

        expect(deepest.resolve('@B')).toBeDefined();
        expect(deepest.resolve('@A')).toBeDefined(); // visible from parent
    });

    test('getVisibleSymbols returns merged symbols, shadowed ones hidden', () => {
        const scope = rootScope(`
            DECLARE @Id INT;

            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                DECLARE @Id VARCHAR(10);
                DECLARE @Name VARCHAR(20);
            END
        `);

        const procScope = scope.getChildren()
            .find(x => x.name === 'dbo.Proc1')!;

        const visible = procScope.getVisibleSymbols();
        const names = visible.map(x => x.name);

        // @Id shadowed by proc-local VARCHAR(10) version
        expect(names.filter(x => x === '@Id')).toHaveLength(1);
        expect(names).toContain('@Name');

        const id = visible.find(x => x.name === '@Id');
        expect(id?.dataType).toBe('VARCHAR(10)');
    });

    test('contains() correctly identifies offset membership', () => {
        const result = build(`DECLARE @X INT;`);
        expect(result.root.contains(0)).toBe(true);
        expect(result.root.contains(Number.MAX_SAFE_INTEGER)).toBe(true);
    });
});