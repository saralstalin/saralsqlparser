import { Lexer } from '../src/lexer';
import { Parser } from '../src/parser';
import { ScopeBuilder } from '../src/scopeBuilder';
import { diagnose, DiagnosticCode, Diagnostic } from '../src/diagnostics';

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
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

    test('does NOT fire when variable is used in SET', () => {
        const d = only(
            `DECLARE @X INT; SET @X = 1;`,
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