import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { ScopeBuilder } from '../src/semantic/scopeBuilder';
import { diagnose, DiagnosticCode, Diagnostic } from '../src/diagnostics/diagnostics';

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => { }));
afterAll(() => jest.restoreAllMocks());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(sql: string): Diagnostic[] {
    const { ast } = new Parser(new Lexer(sql)).parse();
    const scopeResult = new ScopeBuilder().build(ast);
    return diagnose(ast, scopeResult);
}

function only(sql: string, code: DiagnosticCode): Diagnostic[] {
    return run(sql).filter(d => d.code === code);
}

// ─── VAR001: Undeclared variable ─────────────────────────────────────────────

describe('VAR001 — undeclared variable', () => {
    test('fires on undeclared variable in WHERE', () => {
        const d = only(`SELECT Name FROM Users WHERE Id = @Ghost`, DiagnosticCode.UndeclaredVariable);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('error');
    });

    test('fires on undeclared variable in UPDATE SET', () => {
        const d = only(
            `UPDATE Users SET Status = @Ghost WHERE Id = 1`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(1);
    });

    test('does NOT fire on declared variable', () => {
        const d = only(
            `DECLARE @Id INT = 1; SELECT Name FROM Users WHERE Id = @Id`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(0);
    });

    test('does NOT fire on system variables', () => {
        const d = only(
            `SELECT @@ROWCOUNT, @@ERROR, @@IDENTITY`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(0);
    });

    test('fires multiple times for multiple undeclared vars', () => {
        const d = only(
            `SELECT @A + @B + @C`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(3);
    });

    test('fires on undeclared var in HAVING', () => {
        const d = only(
            `SELECT DeptId FROM Employees GROUP BY DeptId HAVING COUNT(*) > @Min`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(1);
    });

    test('fires on undeclared var inside CASE WHEN', () => {
        const d = only(
            `SELECT CASE WHEN @Flag = 1 THEN 'Y' END`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(1);
    });

    test('fires on undeclared var inside subquery', () => {
        const d = only(
            `SELECT * FROM Users WHERE Id IN (SELECT Id FROM T WHERE X = @Ghost)`,
            DiagnosticCode.UndeclaredVariable
        );
        expect(d.length).toBe(1);
    });

    test('parameter declared in proc resolves inside proc body', () => {
        const d = only(`
            CREATE PROCEDURE dbo.Proc1 @Id INT
            AS BEGIN
                SELECT Name FROM Users WHERE Id = @Id;
            END
        `, DiagnosticCode.UndeclaredVariable);
        expect(d.length).toBe(0);
    });
});

// ─── VAR002: Unused variable ─────────────────────────────────────────────────

describe('VAR002 — unused variable', () => {
    test('fires on declared but never used variable', () => {
        const d = only(`DECLARE @Unused INT;`, DiagnosticCode.UnusedVariable);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
    });

    test('fires when variable is only assigned but never read', () => {
        const d = only(
            `DECLARE @X INT; SET @X = 1;`,
            DiagnosticCode.UnusedVariable
        );

        expect(d.length).toBe(1);
    });

    test('does NOT fire when variable is later read', () => {
        const d = only(
            `
        DECLARE @X INT;
        SET @X = 1;
        SELECT @X;
        `,
            DiagnosticCode.UnusedVariable
        );

        expect(d.length).toBe(0);
    });

    test('does NOT fire when initialized and later PRINTED', () => {
        const d = only(
            `
        DECLARE @X INT = 1;
        PRINT @X;
        `,
            DiagnosticCode.UnusedVariable
        );

        expect(d.length).toBe(0);
    });

    test('does NOT fire when variable is used in WHERE', () => {
        const d = only(
            `DECLARE @Id INT = 5; SELECT * FROM T WHERE Id = @Id;`,
            DiagnosticCode.UnusedVariable
        );
        expect(d.length).toBe(0);
    });

    test('fires for each unused variable in multi-declare', () => {
        const d = only(
            `DECLARE @A INT, @B INT, @C INT; SELECT @A;`,
            DiagnosticCode.UnusedVariable
        );
        // @B and @C are unused
        expect(d.length).toBe(2);
    });

    test('does NOT fire on table variables — schema intent differs', () => {
        // Table variables declared for use as temp tables
        // are often populated later; keep them as warning-free for now
        const d = only(
            `DECLARE @T TABLE(Id INT, Name VARCHAR(50));`,
            DiagnosticCode.UnusedVariable
        );
        // Table variables are SymbolKind.Table not Variable, so no warning
        expect(d.length).toBe(0);
    });

    test('does NOT fire when variable is used in RAISERROR', () => {
        const d = only(
            `
            DECLARE @Message VARCHAR(100) = 'bad';
            RAISERROR(@Message, 16, 1);
            `,
            DiagnosticCode.UnusedVariable
        );

        expect(d.length).toBe(0);
    });

    test('does NOT fire when variable is used in THROW', () => {
        const d = only(
            `
            DECLARE @Message VARCHAR(100) = 'bad';
            THROW 50001, @Message, 1;
            `,
            DiagnosticCode.UnusedVariable
        );

        expect(d.length).toBe(0);
    });

    test('does NOT fire when variable is used in WHILE condition and loop body', () => {
        const d = only(
            `
            DECLARE @DepthLevel INT = 0;
            WHILE @DepthLevel < 3
            BEGIN
                SET @DepthLevel = @DepthLevel + 1;
            END
            `,
            DiagnosticCode.UnusedVariable
        );

        expect(d.length).toBe(0);
    });
});

// ─── VAR003: Unused parameter ────────────────────────────────────────────────

describe('VAR003 — unused parameter', () => {
    test('fires on unused procedure parameter', () => {
        const d = only(`
            CREATE PROCEDURE dbo.Proc1 @Id INT, @Name VARCHAR(100)
            AS BEGIN
                SELECT @Id;
            END
        `, DiagnosticCode.UnusedParameter);
        // @Name is unused
        expect(d.length).toBe(1);
        expect(d[0].message).toContain('@Name');
    });

    test('does NOT fire when all parameters are used', () => {
        const d = only(`
            CREATE PROCEDURE dbo.Proc1 @Id INT
            AS BEGIN
                SELECT Name FROM Users WHERE Id = @Id;
            END
        `, DiagnosticCode.UnusedParameter);
        expect(d.length).toBe(0);
    });

    test('does NOT fire for TVP used in INSERT SELECT FROM inside procedure body', () => {
        const d = only(`
            CREATE PROCEDURE dbo.ImportItems
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                INSERT INTO dbo.Target (Id, Name)
                SELECT i.Id, i.Name
                FROM @Items i
                WHERE i.Id > 0;
            END
        `, DiagnosticCode.UnusedParameter);
        expect(d.length).toBe(0);
    });

    test('does NOT fire for parameters used inside TRY CATCH procedure body with TVPs', () => {
        const d = only(`
            CREATE PROCEDURE [dbo].[ProcessItems]
                @InputItems [dbo].[ItemTableType] READONLY,
                @OutputItems [dbo].[ItemTableType] READONLY,
                @UserName VARCHAR(50),
                @AuditMessage VARCHAR(50) = NULL
            AS
            BEGIN
                BEGIN TRY
                    SET @UserName = TRIM(@UserName);

                    INSERT INTO #Tmp (Attribute)
                    SELECT TRIM(src.Attribute)
                    FROM @InputItems src;

                    INSERT INTO #Tmp (Attribute)
                    SELECT TRIM(dst.Attribute)
                    FROM @OutputItems dst;

                    SELECT @AuditMessage;
                END TRY
                BEGIN CATCH
                    SELECT ERROR_MESSAGE() AS Remarks;
                END CATCH
            END
        `, DiagnosticCode.UnusedParameter);

        expect(d.length).toBe(0);
    });
});

// ─── DML001: UPDATE without WHERE ────────────────────────────────────────────

describe('DML001 — UPDATE without WHERE', () => {
    test('fires when WHERE is absent', () => {
        const d = only(`UPDATE Users SET Status = 1`, DiagnosticCode.UpdateWithoutWhere);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
    });

    test('does NOT fire when WHERE is present', () => {
        const d = only(
            `UPDATE Users SET Status = 1 WHERE Id = 5`,
            DiagnosticCode.UpdateWithoutWhere
        );
        expect(d.length).toBe(0);
    });

    test('fires inside a stored procedure body', () => {
        const d = only(`
            CREATE PROCEDURE dbo.Proc1
            AS BEGIN
                UPDATE Users SET Status = 0;
            END
        `, DiagnosticCode.UpdateWithoutWhere);
        expect(d.length).toBe(1);
    });

    test('fires inside IF branch', () => {
        const d = only(
            `IF 1=1 UPDATE Users SET Status = 0`,
            DiagnosticCode.UpdateWithoutWhere
        );
        expect(d.length).toBe(1);
    });

    test('does NOT fire when joined FROM clause limits rows', () => {
        const d = only(
            `
            UPDATE targetRow
            SET Status = 0
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow
                ON allowedRow.Id = targetRow.Id
            `,
            DiagnosticCode.UpdateWithoutWhere
        );
        expect(d.length).toBe(0);
    });

    test('diagnostic start offset points to UPDATE keyword', () => {
        const sql = `UPDATE Users SET Status = 1`;
        const d = only(sql, DiagnosticCode.UpdateWithoutWhere);
        expect(d[0].start).toBe(0);
        expect(d[0].end).toBe(6);
    });
});

// ─── DML002: DELETE without WHERE ────────────────────────────────────────────

describe('DML002 — DELETE without WHERE', () => {
    test('fires when WHERE is absent', () => {
        const d = only(`DELETE FROM Users`, DiagnosticCode.DeleteWithoutWhere);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
    });

    test('does NOT fire when WHERE is present', () => {
        const d = only(
            `DELETE FROM Users WHERE Id = 1`,
            DiagnosticCode.DeleteWithoutWhere
        );
        expect(d.length).toBe(0);
    });

    test('fires inside BEGIN…END block', () => {
        const d = only(`
            BEGIN
                DELETE FROM Users;
            END
        `, DiagnosticCode.DeleteWithoutWhere);
        expect(d.length).toBe(1);
    });
});

// ─── DML003: INSERT without column list ──────────────────────────────────────

describe('DML003 — INSERT without column list', () => {
    test('fires when column list is absent', () => {
        const d = only(
            `INSERT INTO Users VALUES ('Alice', 30)`,
            DiagnosticCode.InsertWithoutColumnList
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
    });

    test('does NOT fire when column list is present', () => {
        const d = only(
            `INSERT INTO Users (Name, Age) VALUES ('Alice', 30)`,
            DiagnosticCode.InsertWithoutColumnList
        );
        expect(d.length).toBe(0);
    });

    test('does NOT fire for INSERT … SELECT', () => {
        // INSERT … SELECT has no VALUES so the rule does not apply
        const d = only(
            `INSERT INTO Archive SELECT * FROM Users`,
            DiagnosticCode.InsertWithoutColumnList
        );
        expect(d.length).toBe(0);
    });

    test('fires for MERGE INSERT action without column list', () => {
        const d = only(
            `MERGE dbo.Target AS T
            USING dbo.Source AS S
            ON T.Id = S.Id
            WHEN NOT MATCHED THEN INSERT VALUES (S.Name);`,
            DiagnosticCode.InsertWithoutColumnList
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
    });
});

// ─── SEL001: SELECT * ────────────────────────────────────────────────────────

describe('SEL001 — SELECT *', () => {
    test('fires on bare SELECT *', () => {
        const d = only(`SELECT * FROM Users`, DiagnosticCode.SelectStar);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('info');
    });

    test('does NOT fire on explicit column list', () => {
        const d = only(`SELECT Id, Name FROM Users`, DiagnosticCode.SelectStar);
        expect(d.length).toBe(0);
    });

    test('fires inside CTE query', () => {
        const d = only(`
            WITH X AS (SELECT * FROM Users)
            SELECT Id FROM X
        `, DiagnosticCode.SelectStar);
        expect(d.length).toBeGreaterThanOrEqual(1);
    });

    test('fires inside subquery in FROM', () => {
        const d = only(
            `SELECT d.Id FROM (SELECT * FROM Users) d`,
            DiagnosticCode.SelectStar
        );
        expect(d.length).toBeGreaterThanOrEqual(1);
    });
});

// ─── SEL002: SELECT * in view ────────────────────────────────────────────────

describe('SEL002 — SELECT * inside CREATE VIEW', () => {
    test('fires as error inside CREATE VIEW', () => {
        const d = only(`
            CREATE VIEW dbo.AllUsers AS
            SELECT * FROM dbo.Users
        `, DiagnosticCode.SelectStarInView);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('error');
    });

    test('SEL001 does NOT also fire inside a view (only SEL002)', () => {
        const all = run(`
            CREATE VIEW dbo.AllUsers AS
            SELECT * FROM dbo.Users
        `);
        const sel001 = all.filter(d => d.code === DiagnosticCode.SelectStar);
        const sel002 = all.filter(d => d.code === DiagnosticCode.SelectStarInView);
        expect(sel002.length).toBe(1);
        expect(sel001.length).toBe(0);
    });

    test('does NOT fire on explicit column list in view', () => {
        const d = only(`
            CREATE VIEW dbo.AllUsers AS
            SELECT Id, Name FROM dbo.Users
        `, DiagnosticCode.SelectStarInView);
        expect(d.length).toBe(0);
    });
});

// ─── DUP002: Duplicate CTE name ──────────────────────────────────────────────

describe('DUP002 — duplicate CTE name', () => {
    test('fires when two CTEs share a name', () => {
        const d = only(`
            WITH
                Users AS (SELECT 1 Id),
                Users AS (SELECT 2 Id)
            SELECT * FROM Users
        `, DiagnosticCode.DuplicateCte);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('error');
    });

    test('does NOT fire for unique CTE names', () => {
        const d = only(`
            WITH
                A AS (SELECT 1 x),
                B AS (SELECT 2 y)
            SELECT * FROM A JOIN B ON A.x = B.y
        `, DiagnosticCode.DuplicateCte);
        expect(d.length).toBe(0);
    });
});

// ─── Sorting and position ─────────────────────────────────────────────────────

describe('diagnostic ordering', () => {
    test('diagnostics are sorted by start offset', () => {
        const d = run(`
            SELECT @A, @B, @C FROM T
        `);
        const offsets = d.map(x => x.start);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    });
});

// ─── Combined scenarios ───────────────────────────────────────────────────────

describe('DML004 â€” UPDATE target WITH (NOLOCK)', () => {
    test('fires when update target alias uses NOLOCK in FROM', () => {
        const d = only(
            `UPDATE u SET Status = 1 FROM Users u WITH (NOLOCK) WHERE Id = 1`,
            DiagnosticCode.UpdateTargetNoLock
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('error');
    });

    test('fires when update target table uses NOLOCK in FROM', () => {
        const d = only(
            `UPDATE Users SET Status = 1 FROM Users WITH (NOLOCK) WHERE Id = 1`,
            DiagnosticCode.UpdateTargetNoLock
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('error');
    });

    test('does NOT fire when NOLOCK is on a non-target joined table', () => {
        const d = only(
            `UPDATE u SET Status = 1 FROM Users u JOIN Audit a WITH (NOLOCK) ON u.Id = a.UserId WHERE u.Id = 1`,
            DiagnosticCode.UpdateTargetNoLock
        );
        expect(d.length).toBe(0);
    });
});

describe('COL001 â€” unknown column', () => {
    test('fires for unknown column on declared table variable alias', () => {
        const d = only(`
            DECLARE @Items TABLE (Id INT, Name VARCHAR(50));
            SELECT item.MissingColumn
            FROM @Items item;
        `, DiagnosticCode.UnknownColumn);

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
        expect(d[0].message).toContain('MissingColumn');
    });

    test('fires for unknown column on PIVOT alias with known output columns', () => {
        const d = only(`
            SELECT pvt.UnknownBucket
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], [South])
            ) pvt;
        `, DiagnosticCode.UnknownColumn);

        expect(d.length).toBe(1);
        expect(d[0].message).toContain('UnknownBucket');
    });

    test('fires for unknown column on UNPIVOT alias with known output columns', () => {
        const d = only(`
            SELECT u.DoesNotExist
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue FOR AttributeName IN ([Color], [Size])
            ) u;
        `, DiagnosticCode.UnknownColumn);

        expect(d.length).toBe(1);
        expect(d[0].message).toContain('DoesNotExist');
    });

    test('does NOT fire for TVP alias when shape is not known in-file', () => {
        const d = only(`
            CREATE PROCEDURE dbo.ImportItems
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                SELECT item.MaybeMissing
                FROM @Items item;
            END
        `, DiagnosticCode.UnknownColumn);

        expect(d.length).toBe(0);
    });
});

describe('LOG001 â€” self comparison', () => {
    test('fires for identifier compared to itself', () => {
        const d = only(`
            SELECT *
            FROM dbo.Users
            WHERE Id = Id;
        `, DiagnosticCode.SelfComparison);

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe('warning');
    });

    test('fires for variable compared to itself', () => {
        const d = only(`
            DECLARE @Id INT = 1;
            SELECT *
            FROM dbo.Users
            WHERE @Id = @Id;
        `, DiagnosticCode.SelfComparison);

        expect(d.length).toBe(1);
    });

    test('does NOT fire when the two sides are different', () => {
        const d = only(`
            SELECT *
            FROM dbo.Users
            WHERE UserId = RoleId;
        `, DiagnosticCode.SelfComparison);

        expect(d.length).toBe(0);
    });
});

describe('joined DML without WHERE', () => {
    test('UPDATE without WHERE does NOT fire when joined FROM clause limits rows', () => {
        const d = only(
            `
            UPDATE targetRow
            SET Status = 0
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow
                ON allowedRow.Id = targetRow.Id
            `,
            DiagnosticCode.UpdateWithoutWhere
        );

        expect(d.length).toBe(0);
    });

    test('DELETE without WHERE does NOT fire when joined FROM clause limits rows', () => {
        const d = only(`
            DELETE targetRow
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow
                ON allowedRow.Id = targetRow.Id
        `, DiagnosticCode.DeleteWithoutWhere);

        expect(d.length).toBe(0);
    });
});

describe('combined real-world scenarios', () => {
    test('dangerous proc: UPDATE without WHERE + unused param', () => {
        const d = run(`
            CREATE PROCEDURE dbo.DangerProc
                @Id INT,
                @Unused VARCHAR(50)
            AS BEGIN
                UPDATE Users SET Status = 0;
            END
        `);
        const codes = d.map(x => x.code);
        expect(codes).toContain(DiagnosticCode.UpdateWithoutWhere);
        expect(codes).toContain(DiagnosticCode.UnusedParameter);
    });

    test('clean proc produces no diagnostics', () => {
        const d = run(`
            CREATE PROCEDURE dbo.CleanProc
                @Id INT
            AS BEGIN
                UPDATE Users SET Status = 1 WHERE Id = @Id;
            END
        `);
        expect(d.length).toBe(0);
    });

    test('multiple DML issues in one script', () => {
        const d = run(`
            UPDATE Orders SET Total = 0;
            DELETE FROM Logs;
            INSERT INTO Archive VALUES (1, 'test');
        `);
        const codes = d.map(x => x.code);
        expect(codes).toContain(DiagnosticCode.UpdateWithoutWhere);
        expect(codes).toContain(DiagnosticCode.DeleteWithoutWhere);
        expect(codes).toContain(DiagnosticCode.InsertWithoutColumnList);
    });
});
