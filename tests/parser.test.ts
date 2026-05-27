import { Lexer, TokenType } from '../src/parser/lexer';
import { SelectNode, InsertNode, UpdateNode, DeleteNode, DeclareNode, SetNode, CreateNode, CreateIndexNode, DropNode, SetOperatorNode, IfNode, BlockNode, WithNode, OverExpression, TableReference, MemberExpression, IdentifierNode, LiteralNode } from '../src/ast/types';
import { Parser } from '../src/parser/parser';

/**
    * Test Serializer
    * Converts the new Expression objects back to SQL strings for assertion.
    */
function toSql(expr: any): string {
    if (!expr) return '';

    // Handle string inputs (for backward compatibility and TableReference properties)
    if (typeof expr === 'string') {
        // Map internal placeholders used for Derived Tables/Subqueries to the test expectation
        if (expr === 'derived_table' || expr === 'SelectStatement' || expr.includes('JSON.stringify')) {
            return 'SelectStatement';
        }
        return expr;
    }

    switch (expr.type) {
        case 'Literal':
            // Wrap strings in single quotes, return numbers/nulls as strings
            return expr.variant === 'string' ? `'${expr.value}'` : String(expr.value);

        case 'Identifier':
            // Reconstruct multipart names (e.g., dbo.Users)
            return expr.tablePrefix ? `${expr.tablePrefix}.${expr.name}` : expr.name;

        case 'Variable':
            return expr.name; // e.g., @Counter

        case 'BinaryExpression':
            // Recursively stringify left and right sides
            return `${toSql(expr.left)} ${expr.operator} ${toSql(expr.right)}`;

        case 'UnaryExpression': {
            const op = expr.operator.toUpperCase();
            const isPostfix = op.includes('NULL');
            return isPostfix
                ? `${toSql(expr.right)} ${expr.operator}`
                : `${expr.operator} ${toSql(expr.right)}`;
        }

        case 'GroupingExpression':
            // Vital for preserving parentheses in math: (1 + 2) * 3
            return `(${toSql(expr.expression)})`;

        case 'FunctionCall':
            return `${expr.name}(${expr.args.map(toSql).join(', ')})`;

        case 'InExpression':
            // Subquery check handles both nested SelectNodes and placeholders
            const innerIn = (expr.subquery || expr.type === 'SubqueryExpression')
                ? 'SelectStatement'
                : (expr.list ? expr.list.map(toSql).join(', ') : '');
            return `${toSql(expr.left)} ${expr.isNot ? 'NOT ' : ''}IN (${innerIn})`;

        case 'BetweenExpression':
            return `${toSql(expr.left)} ${expr.isNot ? 'NOT ' : ''}BETWEEN ${toSql(expr.lowerBound)} AND ${toSql(expr.upperBound)}`;

        case 'CaseExpression':
            let res = 'CASE';
            if (expr.input) res += ' ' + toSql(expr.input);
            expr.branches.forEach((b: any) => {
                res += ` WHEN ${toSql(b.when)} THEN ${toSql(b.then)}`;
            });
            if (expr.elseBranch) res += ` ELSE ${toSql(expr.elseBranch)}`;
            return res + ' END';

        case 'SubqueryExpression':
            // Standardize all subqueries to this string to satisfy 'toContain' tests
            return 'SelectStatement';
        case 'ValuesTableExpression':
            return 'ValuesTable';
        case 'ExistsExpression':
            return `EXISTS (${toSql(expr.query)})`;

        default:
            // Helpful debugging hint for new nodes
            return expr.type ? `[Unhandled Node: ${expr.type}]` : '';
    }
}

function getTableName(expr: any): string {
    if (!expr) return '';

    if (expr.type === 'Identifier') {
        return expr.parts.join('.');
    }

    if (expr.type === 'MemberExpression') {
        return expr.name; // safe for now
    }

    if (expr.type === 'SubqueryExpression') {
        return 'SUBQUERY';
    }

    if (expr.type === 'ValuesTableExpression') {
        return 'VALUES';
    }

    return '';
}

describe('T-SQL Parser', () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };



    // 1. Basic SELECT
    test('should build AST for a basic SELECT', () => {
        const sql = 'SELECT Name, Age FROM Users WHERE Id = 1;';
        const ast = parse(sql);
        expect(ast).toMatchSnapshot();
    });

    // 2. TOP Clause
    test('should handle T-SQL TOP clause', () => {
        const sql = 'SELECT TOP 10 * FROM Logs;';
        const ast = parse(sql);
        expect(((ast.body[0] as SelectNode).top?.quantity as LiteralNode).value).toBe(10);
    });

    // 3. TOP with Parentheses and Joins
    test('should handle T-SQL TOP (10) and JOINs', () => {
        const sql = `SELECT TOP (10) e.Name FROM Employees AS e INNER JOIN Departments AS d ON e.DeptId = d.Id`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(((ast.body[0] as SelectNode).top?.quantity as LiteralNode).value).toBe(10);
        expect(getTableName(stmt.from?.[0].table)).toBe('Employees');
        expect(stmt.from?.[0].joins[0].type).toBe('INNER JOIN');
        expect(toSql(stmt.from?.[0].joins[0].on)).toBe('e.DeptId = d.Id');
    });

    // 4. Bracketed Identifiers
    test('should handle bracketed identifiers and spaces', () => {
        const sql = `SELECT [First Name] FROM [Sales].[Customer Orders]`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.columns[0].sourceName).toBe('[First Name]');
        expect(stmt.columns[0].outputName).toBe('[First Name]');

        expect(
            getTableName(stmt.from?.[0].table)
        ).toBe('[Sales].[Customer Orders]');
    });

    test('should handle escaped closing bracket inside bracketed identifier', () => {
        const sql = `SELECT [My]]Column] FROM [dbo].[T]`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.columns[0].sourceName).toBe('[My]]Column]');
        expect(getTableName(stmt.from?.[0].table)).toBe('[dbo].[T]');
    });

    // 5. WHERE with complex operators
    test('should handle WHERE clause with T-SQL operators', () => {
        const sql = `SELECT Name FROM Users WHERE Status = 'Active' AND [Date] >= '2025-01-01'`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(toSql(stmt.where)).toMatch(/Status = 'Active' AND \[Date\] >= '2025-01-01'/);
    });

    // 6. ORDER BY
    test('should handle ORDER BY with multiple columns', () => {
        const sql = `SELECT Name FROM Users ORDER BY Name, Id DESC`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(stmt.orderBy).toHaveLength(2);
        expect(stmt.orderBy![0].direction).toBe('ASC');
        expect(stmt.orderBy![1].direction).toBe('DESC');
    });

    // 7. GROUP BY
    test('should handle GROUP BY with multiple columns', () => {
        const sql = `SELECT R, C FROM T GROUP BY R, C`;
        const ast = parse(sql);
        expect((ast.body[0] as SelectNode).groupBy).toHaveLength(2);
    });

    // 8. HAVING
    test('should handle GROUP BY with HAVING clause', () => {
        const sql = `SELECT C FROM T GROUP BY C HAVING SUM(S) > 1000`;
        const ast = parse(sql);
        expect(toSql((ast.body[0] as SelectNode).having)).toBe('SUM(S) > 1000');
    });

    // 9. DISTINCT
    test('should handle SELECT DISTINCT', () => {
        const sql = `SELECT DISTINCT Name FROM Users`;
        expect((parse(sql).body[0] as SelectNode).distinct).toBe(true);
    });

    test('should parse SELECT DISTINCT with leading unary plus concatenation', () => {
        const sql = `
            SELECT DISTINCT + @LineBreak + 'Message ' + CAST(item.RowNum AS VARCHAR(10))
            FROM dbo.Items item
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;
        const expr = stmt.columns[0].expression;

        expect(result.issues).toHaveLength(0);
        expect(stmt.distinct).toBe(true);
        expect(expr.type).toBe('BinaryExpression');
        if (expr.type !== 'BinaryExpression') {
            throw new Error('Expected select expression to be a BinaryExpression');
        }
        const leftConcat = expr.left;
        expect(leftConcat.type).toBe('BinaryExpression');
        if (leftConcat.type !== 'BinaryExpression') {
            throw new Error('Expected left concatenation to be a BinaryExpression');
        }
        expect(leftConcat.left.type).toBe('UnaryExpression');
        if (leftConcat.left.type !== 'UnaryExpression') {
            throw new Error('Expected leading expression to be a UnaryExpression');
        }
        expect(leftConcat.left.operator).toBe('+');
    });

    test('should parse COUNT DISTINCT inside aggregate function arguments', () => {
        const sql = `SELECT COUNT(DISTINCT h.HolidayDate) AS HolidayCount FROM dbo.Holiday h`;
        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;
        const expr = stmt.columns[0].expression;

        expect(result.issues).toEqual([]);
        expect(expr.type).toBe('FunctionCall');

        if (expr.type !== 'FunctionCall') {
            throw new Error('Expected aggregate expression to be a FunctionCall');
        }

        expect(expr.name.toUpperCase()).toBe('COUNT');
        expect(expr.distinct).toBe(true);
        expect(expr.args).toHaveLength(1);
    });

    test('should parse SUM DISTINCT inside aggregate function arguments', () => {
        const sql = `SELECT SUM(DISTINCT o.Amount) AS TotalAmount FROM Orders o`;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test('should parse procedure WITH EXECUTE AS OWNER before AS', () => {
        const sql = `
            CREATE PROCEDURE dbo.Foo
                @p INT
            WITH EXECUTE AS OWNER
            AS
            BEGIN
                SELECT @p;
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test('should parse view WITH SCHEMABINDING before AS', () => {
        const sql = `
            CREATE VIEW dbo.ActiveUsers
            WITH SCHEMABINDING
            AS
            SELECT Id
            FROM dbo.Users
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test('should parse view body starting with CTE', () => {
        const sql = `
            CREATE VIEW dbo.ActiveUsers
            AS
            WITH RecentUsers AS (
                SELECT Id
                FROM dbo.Users
            )
            SELECT Id
            FROM RecentUsers
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.objectType).toBe('VIEW');
        expect((stmt.body as any).type).toBe('WithStatement');
    });

    test('should parse parenthesized view body', () => {
        const sql = `
            CREATE VIEW [dbo].[SomeView]
            AS
            (
                SELECT st.Name, sot.Description
                FROM dbo.SomeTable st
                     JOIN dbo.SomeOtherTable sot ON sot.Id = st.Id
            );
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.objectType).toBe('VIEW');
        expect((stmt.body as any).type).toBe('SelectStatement');
    });

    test('should parse parenthesized standalone select inside procedure body', () => {
        const sql = `
            CREATE PROCEDURE [dbo].[PROC_ATS_GetProductNotifications_2012I1]
            (
                  @ResultCount INT,
                  @RegionId INT
            )
            AS
            BEGIN
                IF(@ResultCount>0)SET ROWCOUNT @ResultCount
                (
                    (
                        SELECT
                            TOP 1 CreationDate, Info, NotificationType
                        FROM PRODUCT productRow WITH (NOLOCK)
                        INNER JOIN ProductCatalog catalogRow WITH (NOLOCK)
                            ON productRow.ID = catalogRow.ProductID
                        INNER JOIN ProductCountry countryRow
                            ON (
                                countryRow.ProductId = productRow.Id
                                AND catalogRow.CatalogID = @RegionId
                            )
                        INNER JOIN ProductNotification notificationRow
                            ON (countryRow.Id = notificationRow.ProductCountryId)
                    )
                )
                ORDER BY CreationDate DESC
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test('should parse parenthesized joined table source in FROM', () => {
        const sql = `
            SELECT baseRow.Id
            FROM (
                dbo.SourceA baseRow
                INNER JOIN dbo.SourceB childRow
                    ON baseRow.Id = childRow.SourceAId
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;

        expect(result.issues).toEqual([]);
        expect(stmt.from).toHaveLength(1);
        expect((stmt.from?.[0].table as any).type).toBe('TableReference');
    });

    test('should not fold spaced comparison operators into composite operators', () => {
        const sql = `
            SELECT recordRow.Id
            FROM dbo.Records recordRow
            WHERE recordRow.CreatedOn > = @Cutoff
              AND recordRow.Score < = @Threshold
        `;

        const lexer = new Lexer(sql);
        const operators: string[] = [];
        while (true) {
            const token = lexer.nextToken();
            if (token.type === TokenType.Operator) {
                operators.push(token.value);
            }
            if (token.type === TokenType.EOF) break;
        }

        expect(operators).toContain('>');
        expect(operators).toContain('<');
        expect(operators).toContain('=');
        expect(operators).not.toContain('>=');
        expect(operators).not.toContain('<=');
    });

    test('should parse procedure with parenthesized joined source in FROM', () => {
        const sql = `
            CREATE PROCEDURE dbo.GetPendingOrderDetails
                @Interval BIGINT = 1440
            AS
            BEGIN
                SELECT itemRow.Sku
                FROM (
                    dbo.InventoryView inventoryRow
                    INNER JOIN dbo.Products itemRow
                        ON inventoryRow.Sku = itemRow.Sku
                    INNER JOIN dbo.Reservations reservationRow
                        ON itemRow.Id = reservationRow.ProductId
                )
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test('should parse scalar function RETURNS clause before AS', () => {
        const sql = `
            CREATE FUNCTION dbo.GetFlag(@Id INT)
            RETURNS INT
            AS
            BEGIN
                RETURN @Id;
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test('should parse inline table function RETURN with CTE query body', () => {
        const sql = `
            CREATE FUNCTION dbo.fnInline()
            RETURNS TABLE
            AS
            RETURN (
                WITH cteX AS (
                    SELECT 1 AS Id
                )
                SELECT Id
                FROM cteX
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0];

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe('CreateStatement');
        if (stmt.type !== 'CreateStatement') {
            throw new Error('Expected CreateStatement');
        }

        const ret = (stmt.body as any[]).find(x => x.type === 'ReturnStatement');
        expect(ret).toBeDefined();
        expect(ret.query?.type).toBe('WithStatement');
    });

    test('should parse trigger and retain body after header clauses', () => {
        const sql = `
            CREATE TRIGGER dbo.trgUsersAudit
            ON dbo.Users
            AFTER INSERT
            AS
            BEGIN
                PRINT 'audit';
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0];

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe('CreateStatement');

        if (stmt.type !== 'CreateStatement') {
            throw new Error('Expected CreateStatement');
        }

        expect(stmt.objectType).toBe('TRIGGER');
    });

    // 10. ALL (Explicit)
    test('should handle SELECT ALL', () => {
        const sql = `SELECT ALL Name FROM Users`;
        expect((parse(sql).body[0] as SelectNode).distinct).toBe(false);
    });

    // 10.5. SELECT ... INTO
    test('should handle SELECT INTO simple', () => {
        const sql = `SELECT Id INTO #Tmp FROM Users`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.into?.name).toBe('#Tmp');
    });

    test('should handle SELECT TOP ... INTO', () => {
        const sql = `SELECT TOP 10 * INTO dbo.Backup FROM Orders`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(((stmt.top?.quantity as LiteralNode).value)).toBe(10);
        expect(stmt.into?.name).toBe('dbo.Backup');
        expect(stmt.into?.parts).toEqual(['dbo', 'Backup']);
    });

    test('should handle SELECT * INTO multipart schema', () => {
        const sql = `SELECT * INTO #Agg FROM X`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.into?.name).toBe('#Agg');
    });

    // 11. Alias: Assignment Style
    test('should handle assignment alias (ID = UserID)', () => {
        const sql = `SELECT ID = UserID FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe('ID');
        expect(col.sourceName).toBe('UserID');
    });

    // 12. Alias: AS Style
    test('should handle AS alias (Name AS UserName)', () => {
        const sql = `SELECT Name AS UserName FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe('UserName');
    });

    // 13. Alias: Implicit Style
    test('should handle implicit alias (Email UserEmail)', () => {
        const sql = `SELECT Email UserEmail FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe('UserEmail');
    });

    // 14. Multipart Identifiers in Columns
    test('should handle u.Name in SELECT', () => {
        const sql = `SELECT u.Name FROM Users u`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];

        expect(col.alias).toBeUndefined();
        expect(col.sourceName).toBe('Name');
        expect(col.outputName).toBe('Name');

        expect(col.expression.type).toBe('Identifier');

        const expr = col.expression as IdentifierNode;

        expect(expr.name).toBe('u.Name');
        expect(expr.parts).toEqual(['u', 'Name']);
    });

    // 15. Table Alias Boundary (WHERE check)
    test('should not swallow WHERE as a table alias', () => {
        const sql = `SELECT Name FROM Users u WHERE ID = 1`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].alias).toBe('u');
        expect(stmt.where).not.toBeNull();
    });

    // 16. Table Alias with AS
    test('should handle Users AS u', () => {
        const sql = `SELECT Name FROM Users AS u`;
        expect((parse(sql).body[0] as SelectNode).from?.[0].alias).toBe('u');
    });

    // 17. IN Clause (List)
    test('should handle IN clause (1, 2, 3)', () => {
        const sql = `SELECT x FROM T WHERE ID IN (1, 2, 3)`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toBe('ID IN (1, 2, 3)');
    });

    // 18. IN Clause (Subquery)
    test('should handle IN clause with subquery', () => {
        const sql = `SELECT x FROM T WHERE ID IN (SELECT ID FROM T2)`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toContain('SelectStatement');
    });

    // 19. BETWEEN Clause
    test('should handle BETWEEN clause', () => {
        const sql = `SELECT x FROM T WHERE Y BETWEEN 1 AND 10`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toBe('Y BETWEEN 1 AND 10');
    });

    // 20. Complex Logical expressions
    test('should handle complex IN and BETWEEN combination', () => {
        const sql = `SELECT * FROM T WHERE A IN (1) AND B BETWEEN 1 AND 2`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toBe('A IN (1) AND B BETWEEN 1 AND 2');
    });

    // 21. INSERT Standard
    test('should handle INSERT INTO ... VALUES', () => {
        const sql = `INSERT INTO Users (Name) VALUES ('Saral')`;
        const node = parse(sql).body[0] as InsertNode;
        expect(node.type).toBe('InsertStatement');
        expect(node.columns).toEqual(['Name']);
        expect(node.columnNodes?.[0]).toMatchObject({
            type: 'Identifier',
            name: 'Name',
            start: sql.indexOf('Name'),
            end: sql.indexOf('Name') + 'Name'.length
        });
    });

    // 22. INSERT from SELECT
    test('should handle INSERT INTO ... SELECT', () => {
        const sql = `INSERT INTO T1 SELECT * FROM T2`;
        const node = parse(sql).body[0] as InsertNode;
        expect(node.selectQuery?.type).toBe('SelectStatement');
    });

    test('should handle INSERT column list with keyword-shaped identifiers', () => {
        const sql = `
            INSERT INTO dbo.OrgLkp
            (
                OrgId,
                OffSet,
                Region
            )
            SELECT
                src.OrgId,
                src.OffSet,
                src.Region
            FROM @InputRows src
        `;

        const node = parse(sql).body[0] as InsertNode;

        expect(node.selectQuery?.type).toBe('SelectStatement');
        expect(node.columns).toEqual([
            'OrgId',
            'OFFSET',
            'Region'
        ]);
    });

    test('should parse CREATE TABLE columns with keyword-shaped identifiers', () => {
        const sql = `
            CREATE TABLE dbo.OrgLkp
            (
                Id INT,
                OffSet VARCHAR(50)
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe('CreateStatement');
        expect(stmt.columns?.map((col: any) => col.name)).toEqual([
            'Id',
            'OFFSET'
        ]);
    });

    // 23. UPDATE Standard
    test('should handle standard UPDATE', () => {
        const sql = `UPDATE Users SET Status = 1 WHERE ID = 1`;
        const node = parse(sql).body[0] as UpdateNode;
        expect(node.type).toBe('UpdateStatement');
        expect(node.assignments?.[0]).toMatchObject({
            type: 'UpdateAssignment',
            column: 'Status',
            start: sql.indexOf('Status'),
            end: sql.indexOf('1') + 1
        });
        expect(node.assignments?.[0].columnNode).toMatchObject({
            type: 'Identifier',
            name: 'Status',
            start: sql.indexOf('Status'),
            end: sql.indexOf('Status') + 'Status'.length
        });
    });

    test('should handle compound UPDATE assignment', () => {
        const sql = `UPDATE ProductStatus SET [Committed] -= @MinusQuantity WHERE ProductId = @ProductID`;
        const node = parse(sql).body[0] as UpdateNode;

        expect(node.type).toBe('UpdateStatement');
        expect(node.assignments?.[0].column).toBe('[Committed]');
        expect(toSql(node.assignments?.[0].value)).toBe('[Committed] - @MinusQuantity');
    });

    test('should handle keyword column name in UPDATE assignment target', () => {
        const sql = `UPDATE T SET OUTPUT = 1 WHERE Id = 1`;
        const node = parse(sql).body[0] as UpdateNode;

        expect(node.type).toBe('UpdateStatement');
        expect(node.assignments?.[0].column).toBe('OUTPUT');
        expect(toSql(node.assignments?.[0].value)).toBe('1');
    });

    // 24. UPDATE with JOIN (T-SQL style)
    test('should handle UPDATE with FROM and JOIN', () => {
        const sql = `UPDATE u SET x = 1 FROM Users u JOIN T2 ON u.id = T2.id`;
        const node = parse(sql).body[0] as UpdateNode;
        expect(getTableName(node.target)).toBe('u');
        expect(node.from?.[0].joins.length).toBe(1);
    });

    test('should handle UPDATE TOP variable', () => {
        const sql = `UPDATE TOP (@n) dbo.Items SET IsActive = 1 WHERE IsActive = 0`;
        const node = parse(sql).body[0] as UpdateNode;
        expect(node.top?.type).toBe('TopClause');
        expect(node.top?.quantity?.type).toBe('Variable');
        expect((node.top?.quantity as any).name).toBe('@n');
    });

    // 25. DELETE Standard
    test('should handle standard DELETE', () => {
        const sql = `DELETE FROM Users WHERE ID = 1`;
        expect(parse(sql).body[0].type).toBe('DeleteStatement');
    });

    // 26. DELETE with JOIN
    test('should handle DELETE with FROM and JOIN', () => {
        const sql = `DELETE u FROM Users u JOIN T2 ON u.id = T2.id`;
        const node = parse(sql).body[0] as DeleteNode;
        expect(getTableName(node.target)).toBe('u');
    });

    test('should handle DELETE TOP variable', () => {
        const sql = `DELETE TOP (@n) FROM dbo.Items WHERE IsActive = 0`;
        const node = parse(sql).body[0] as DeleteNode;
        expect(node.top?.type).toBe('TopClause');
        expect(node.top?.quantity?.type).toBe('Variable');
        expect((node.top?.quantity as any).name).toBe('@n');
    });

    // 27. DECLARE variables
    test('should handle DECLARE with assignment', () => {
        const sql = `DECLARE @ID INT = 10`;
        const node = parse(sql).body[0] as DeclareNode;
        expect(node.variables[0].name).toBe('@ID');
        expect(toSql(node.variables[0].initialValue)).toBe('10');
    });

    // 28. SET variable
    test('should handle SET @Var = Expr', () => {
        const sql = `SET @ID = @ID + 1`;
        expect(toSql((parse(sql).body[0] as SetNode).value)).toBe('@ID + 1');
    });

    test('should handle SET @Var compound assignment', () => {
        const sql = `SET @ID -= 1`;
        expect(toSql((parse(sql).body[0] as SetNode).value)).toBe('@ID - 1');
    });

    // 29. CREATE TABLE
    test('should handle CREATE TABLE', () => {
        const sql = `CREATE TABLE T (ID INT PRIMARY KEY)`;
        const node = parse(sql).body[0] as CreateNode;
        expect(node.objectType).toBe('TABLE');
        expect(node.name).toBe('T');
        expect(node.nameNode).toMatchObject({
            type: 'Identifier',
            name: 'T',
            start: sql.indexOf('T ('),
            end: sql.indexOf('T (') + 1
        });
    });

    // 30. CREATE PROC / VIEW
    test('should handle CREATE VIEW and PROC', () => {
        const sqlV = `CREATE VIEW V AS SELECT 1`;
        const sqlP = `CREATE PROC P AS SELECT 1`;
        expect((parse(sqlV).body[0] as CreateNode).objectType).toBe('VIEW');
        expect((parse(sqlP).body[0] as CreateNode).objectType).toBe('PROCEDURE');
    });

    test('should handle CREATE LOGIN', () => {
        const sql = `
            CREATE LOGIN ReportingUser
            WITH PASSWORD = 'StrongPassword!42',
                 CHECK_POLICY = OFF,
                 DEFAULT_DATABASE = ReportingDb
        `;

        const node = parse(sql).body[0] as CreateNode;

        expect(node.objectType).toBe('LOGIN');
        expect(node.name).toBe('ReportingUser');
    });

    test('should handle CREATE USER', () => {
        const sql = `
            CREATE USER ReportingUser
            FOR LOGIN ReportingLogin
            WITH DEFAULT_SCHEMA = dbo
        `;

        const node = parse(sql).body[0] as CreateNode;

        expect(node.objectType).toBe('USER');
        expect(node.name).toBe('ReportingUser');
    });

    test('should parse indexed view definition and index creation batch', () => {
        const sql = `
            CREATE VIEW dbo.SalesByCustomer
            WITH SCHEMABINDING
            AS
            SELECT salesRow.CustomerId,
                   COUNT_BIG(*) AS OrderCount
            FROM dbo.Sales salesRow
            GROUP BY salesRow.CustomerId;
            GO
            CREATE UNIQUE CLUSTERED INDEX IX_SalesByCustomer
            ON dbo.SalesByCustomer (CustomerId);
        `;

        const ast = parse(sql);
        const statements = ast.body.filter(stmt => stmt.type !== 'BatchSeparatorStatement');
        const viewStmt = statements[0] as CreateNode;
        const indexStmt = statements[1] as CreateIndexNode;

        expect(viewStmt.objectType).toBe('VIEW');
        expect(indexStmt.type).toBe('CreateIndexStatement');
        expect(indexStmt.unique).toBe(true);
        expect(indexStmt.clustered).toBe('CLUSTERED');
        expect(indexStmt.table.name).toBe('dbo.SalesByCustomer');
    });

    test('should preserve GO as a batch separator statement', () => {
        const ast = parse(`
            DECLARE @ID INT = 20
            GO
            DECLARE @ID INT = 30
        `);

        expect(ast.body.map(stmt => stmt.type)).toEqual([
            'DeclareStatement',
            'BatchSeparatorStatement',
            'DeclareStatement'
        ]);
    });

    test('should handle keyword column name in SELECT projection', () => {
        const sql = `SELECT OUTPUT, Name FROM T`;
        const node = parse(sql).body[0] as SelectNode;

        expect(node.type).toBe('SelectStatement');
        expect(node.columns[0].expression.type).toBe('Identifier');
        expect((node.columns[0].expression as any).name).toBe('OUTPUT');
    });

    test('should parse LEFT and RIGHT as scalar function calls in projections', () => {
        const sql = `
            SELECT LEFT(colA, 1) AS LeftValue,
                   RIGHT(colB, 2) AS RightValue
            FROM dbo.SampleRows
        `;

        const node = parse(sql).body[0] as SelectNode;

        expect(node.columns[0].expression.type).toBe('FunctionCall');
        expect((node.columns[0].expression as any).name).toBe('LEFT');
        expect(node.columns[1].expression.type).toBe('FunctionCall');
        expect((node.columns[1].expression as any).name).toBe('RIGHT');
    });

    // 30.5. DROP TABLE / VIEW / PROC
    test('should handle DROP TABLE', () => {
        const sql = `DROP TABLE #Sales`;
        const node = parse(sql).body[0] as DropNode;
        expect(node.type).toBe('DropStatement');
        expect(node.objectType).toBe('TABLE');
        expect(node.target?.name).toBe('#Sales');
    });

    test('should handle DROP VIEW', () => {
        const sql = `DROP VIEW dbo.V1`;
        const node = parse(sql).body[0] as DropNode;
        expect(node.objectType).toBe('VIEW');
        expect(node.target?.name).toBe('dbo.V1');
        expect(node.target?.parts).toEqual(['dbo', 'V1']);
    });

    test('should handle DROP PROC', () => {
        const sql = `DROP PROC dbo.P1`;
        const node = parse(sql).body[0] as DropNode;
        expect(node.objectType).toBe('PROCEDURE');
        expect(node.target?.name).toBe('dbo.P1');
        expect(node.target?.parts).toEqual(['dbo', 'P1']);
    });

    test('should handle DROP FUNCTION', () => {
        const sql = `DROP FUNCTION dbo.fn_Test`;
        const node = parse(sql).body[0] as DropNode;
        expect(node.objectType).toBe('FUNCTION');
        expect(node.target?.name).toBe('dbo.fn_Test');
    });

    test('should handle DROP INDEX', () => {
        const sql = `DROP INDEX IX_Test ON dbo.T1`;
        const node = parse(sql).body[0] as DropNode;
        expect(node.objectType).toBe('INDEX');
        expect(node.target?.name).toBe('IX_Test');
    });

    test('should handle DROP in IF statement', () => {
        const sql = `IF OBJECT_ID('dbo.Sales') IS NOT NULL DROP TABLE dbo.Sales`;
        const node = parse(sql).body[0] as IfNode;
        expect(node.type).toBe('IfStatement');
        const dropStmt = Array.isArray(node.thenBranch) ? node.thenBranch[0] : node.thenBranch;
        if (dropStmt && 'objectType' in dropStmt) {
            expect((dropStmt as DropNode).objectType).toBe('TABLE');
        }
    });

    // 31. Parentheses Precedence
    test('should handle (1 + 2) * 3', () => {
        const sql = `SET @X = (1 + 2) * 3`;
        expect(toSql((parse(sql).body[0] as SetNode).value)).toBe('(1 + 2) * 3');
    });

    // 32. CROSS APPLY
    test('should handle CROSS APPLY', () => {
        const sql = `SELECT * FROM T CROSS APPLY fn(T.id)`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe('CROSS APPLY');
    });

    test('should handle HASH JOIN hint', () => {
        const sql = `SELECT * FROM dbo.Items i HASH JOIN dbo.Categories c ON c.Id = i.CategoryId`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe('INNER JOIN');
        expect(stmt.from?.[0].joins[0].joinHint).toBe('HASH');
    });

    test('should handle MERGE JOIN hint with LEFT JOIN', () => {
        const sql = `SELECT * FROM dbo.Items i LEFT MERGE JOIN dbo.Categories c ON c.Id = i.CategoryId`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe('LEFT OUTER JOIN');
        expect(stmt.from?.[0].joins[0].joinHint).toBe('MERGE');
    });

    test('should handle LOOP JOIN hint with INNER JOIN', () => {
        const sql = `SELECT * FROM dbo.Items i INNER LOOP JOIN dbo.Categories c ON c.Id = i.CategoryId`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe('INNER JOIN');
        expect(stmt.from?.[0].joins[0].joinHint).toBe('LOOP');
    });

    // 33. Derived Tables (Subquery in FROM)
    test('should handle subquery in FROM', () => {
        const sql = `SELECT * FROM (SELECT 1 as x) d`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(toSql(stmt.from?.[0].table)).toContain('SelectStatement');
    });

    test('should handle VALUES derived table in FROM with alias columns', () => {
        const sql = `CREATE PROCEDURE dbo.GetStatus @OrderNumber VARCHAR(100)
AS
BEGIN
    SELECT Status, StatusDate
    FROM (
        VALUES
            ('Ordered', DATEADD(DAY, -1, GETDATE())),
            ('Shipped', NULL)
    ) AS StatusRows (Status, StatusDate);
END`;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);

        const stmt = result.ast.body[0] as CreateNode;
        const statements = stmt.body as BlockNode[];
        const body = statements[0] as BlockNode;
        const select = body.body[0] as SelectNode;
        const tableSource = select.from?.[0];

        expect(tableSource?.table?.type).toBe('ValuesTableExpression');
        expect(tableSource?.alias).toBe('StatusRows');
        expect(tableSource?.aliasColumns).toEqual(['Status', 'StatusDate']);
    });

        test('should handle APPLY subquery alias columns without treating them as hints', () => {
            const sql = `
            SELECT m.ItemCodes
            FROM dbo.SourceTable sourceRow
            CROSS APPLY (
                SELECT sourceInner.Value
                FROM dbo.SourceInner sourceInner
                FOR XML PATH('')
            ) xmlRow (ItemCodes)
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);

            const stmt = result.ast.body[0] as SelectNode;
            const join = stmt.from?.[0].joins[0];

            expect(join?.table?.type).toBe('SubqueryExpression');
            expect(join?.alias).toBe('xmlRow');
            expect(join?.aliasColumns).toEqual(['ItemCodes']);
            expect(join?.hints).toBeUndefined();
        });

    test('should handle XML nodes table-valued function alias columns', () => {
        const sql = `
            SELECT requestRow.valueColumn.value('SessionID[1]', 'VARCHAR(50)')
            FROM @Request.nodes('/Request') AS requestRow(valueColumn)
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);

        const stmt = result.ast.body[0] as SelectNode;
        const tableSource = stmt.from?.[0];

        expect(tableSource?.table?.type).toBe('FunctionCall');
        expect(tableSource?.alias).toBe('requestRow');
        expect(tableSource?.aliasColumns).toEqual(['valueColumn']);
    });

    test('should omit absent SELECT clauses from the AST', () => {
        const stmt = parse(`SELECT Id FROM dbo.Users`).body[0] as SelectNode;

        expect('top' in stmt).toBe(false);
        expect('where' in stmt).toBe(false);
        expect('groupBy' in stmt).toBe(false);
        expect('having' in stmt).toBe(false);
        expect('orderBy' in stmt).toBe(false);
        expect('into' in stmt).toBe(false);
        expect(stmt.from).toBeDefined();
    });

    test('should omit absent INSERT/UPDATE/DELETE clauses from the AST', () => {
        const insertStmt = parse(`INSERT INTO dbo.Users (Id) VALUES (1)`).body[0] as InsertNode;
        expect('selectQuery' in insertStmt).toBe(false);
        expect('output' in insertStmt).toBe(false);

        const updateStmt = parse(`UPDATE dbo.Users SET Name = 'A'`).body[0] as UpdateNode;
        expect('from' in updateStmt).toBe(false);
        expect('where' in updateStmt).toBe(false);
        expect('output' in updateStmt).toBe(false);

        const deleteStmt = parse(`DELETE FROM dbo.Users`).body[0] as DeleteNode;
        expect('from' in deleteStmt).toBe(false);
        expect('where' in deleteStmt).toBe(false);
        expect('output' in deleteStmt).toBe(false);
    });

    test('should parse USE database statement', () => {
        const stmt = parse(`USE [ReportingDb]`).body[0] as any;

        expect(stmt.type).toBe('UseStatement');
        expect(stmt.database?.type).toBe('Identifier');
        expect(stmt.database?.name).toBe('[ReportingDb]');
    });

    // 34. CASE Statements
    test('should handle CASE WHEN', () => {
        const sql = `SELECT CASE WHEN 1=1 THEN 'A' END`;
        expect(toSql((parse(sql).body[0] as SelectNode).columns[0].expression)).toBe("CASE WHEN 1 = 1 THEN 'A' END");
    });

    // 35. EXISTS
    test('should handle EXISTS subquery', () => {
        const sql =
            `SELECT 1 WHERE EXISTS (SELECT 1)`;

        const where =
            (parse(sql).body[0] as SelectNode)
                .where;

        expect(where).toBeDefined();

        expect(where!.type)
            .toBe('ExistsExpression');

        expect(
            toSql(where!)
        ).toContain('EXISTS');
    });
    
    // 36. UNION / EXCEPT
    test('should handle UNION and EXCEPT', () => {
        const sql = `SELECT 1 UNION SELECT 2 EXCEPT SELECT 3`;
        const root = parse(sql).body[0] as SetOperatorNode;

        expect(root.operator).toBe('EXCEPT');
        expect((root.left as SetOperatorNode).operator).toBe('UNION');
    });

    test('should keep INTERSECT higher precedence than UNION', () => {
        const sql = `SELECT 1 UNION SELECT 2 INTERSECT SELECT 3`;
        const root = parse(sql).body[0] as SetOperatorNode;

        expect(root.operator).toBe('UNION');
        expect((root.right as SetOperatorNode).operator).toBe('INTERSECT');
    });

    test('should preserve temp table identifiers in expression position', () => {
        const stmt = parse('SELECT #Temp;').body[0] as SelectNode;
        const expr = stmt.columns[0].expression as IdentifierNode;

        expect(expr.type).toBe('Identifier');
        expect(expr.name).toBe('#Temp');
        expect(expr.parts).toEqual(['#Temp']);
    });

    test('should preserve temp table multipart identifiers in expression position', () => {
        const stmt = parse('SELECT #Temp.Id;').body[0] as SelectNode;
        const expr = stmt.columns[0].expression as IdentifierNode;

        expect(expr.type).toBe('Identifier');
        expect(expr.name).toBe('#Temp.Id');
        expect(expr.parts).toEqual(['#Temp', 'Id']);
    });

    test('should preserve source casing for keyword-like multipart segments', () => {
        const stmt = parse('SELECT dbo.Target FROM dbo.Source;').body[0] as SelectNode;
        const expr = stmt.columns[0].expression as IdentifierNode;

        expect(expr.type).toBe('Identifier');
        expect(expr.name).toBe('dbo.Target');
        expect(expr.parts).toEqual(['dbo', 'Target']);
    });

    test('should parse static member call with double colon', () => {
        const stmt = parse(`SELECT GEOGRAPHY::Point(@Latitude, @Longitude, 4326) AS GeoLocation`).body[0] as SelectNode;
        const expr = stmt.columns[0].expression as any;

        expect(expr.type).toBe('FunctionCall');
        expect(expr.name).toBe('GEOGRAPHY.Point');
        expect(expr.args).toHaveLength(3);
    });

    // 37. IF...ELSE
    test('should handle IF...ELSE', () => {
        const sql = `IF 1=1 PRINT 'A' ELSE PRINT 'B'`;
        expect((parse(sql).body[0] as IfNode).elseBranch).toBeDefined();
    });

    // 38. BEGIN...END Blocks
    test('should handle BEGIN...END', () => {
        const sql = `BEGIN PRINT 'A'; PRINT 'B'; END`;
        expect((parse(sql).body[0] as BlockNode).body).toHaveLength(2);
    });

    // 39. IS NULL / NOT IN (Claude Review Fix)
    test('should handle IS NOT NULL and NOT IN', () => {
        const sql = `SELECT x FROM T WHERE y IS NOT NULL AND z NOT IN (1, 2)`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(toSql(stmt.where)).toContain('IS NOT NULL');
        expect(toSql(stmt.where)).toContain('NOT IN (1, 2)');
    });
});

describe('T-SQL Parser - Advanced Expression & Structural Integrity', () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test('Architectural: should preserve SubqueryExpression as an object in FROM', () => {
        const sql = `SELECT * FROM (SELECT Name FROM Users) AS Derived`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // This proves Claude's point #1: We can now "walk" into the subquery
        const tableSource = stmt.from?.[0].table;
        expect(typeof tableSource).toBe('object');
        if (typeof tableSource === 'object' && tableSource!.type === 'SubqueryExpression') {
            expect(tableSource.query.type).toBe('SelectStatement');
        }
    });

    test('Architectural: should handle complex expressions in GROUP BY and ORDER BY', () => {
        const sql = `SELECT Year FROM Sales GROUP BY DATEPART(year, SaleDate) ORDER BY CASE WHEN Year > 2000 THEN 1 ELSE 0 END`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // Proves Claude's points #2 and #3: GroupBy and OrderBy are now Expression trees
        expect(stmt.groupBy![0].type).toBe('FunctionCall');
        expect(stmt.orderBy![0].expression.type).toBe('CaseExpression');
    });

    test('Fix Check: should correctly stringify prefix vs postfix unary operators', () => {
        // This targets Claude's point #4 (The Unary stringify bug)
        const sql = `SELECT Name FROM Users WHERE NOT ID = 1 AND DeletedAt IS NULL`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // Using toSql to verify the fix: NOT should be before, IS NULL should be after
        const whereSql = toSql(stmt.where);
        expect(whereSql).toContain('NOT');
        expect(whereSql).toMatch(/ID\s*=\s*1/);
        expect(whereSql).toMatch(/DeletedAt IS NULL/);
    });

    test('Lexer Fix: should correctly identify Comma as a distinct token type', () => {
        // This targets Claude's point #6
        const lexer = new Lexer("A, B");
        lexer.nextToken(); // A
        const comma = lexer.nextToken();
        expect(comma.type).toBe(TokenType.Comma);
        expect(comma.value).toBe(',');
    });

    test('Consolidation Fix: parseFrom should handle UPDATE targets correctly', () => {
        // This targets Claude's point #7 (Consolidation)
        const sql = `UPDATE u SET Name = 'Saral' FROM Users u`;
        const ast = parse(sql);
        const updateNode = ast.body[0] as UpdateNode;

        // Verifies parseFrom is used for UPDATE as well
        expect(getTableName(updateNode.from?.[0].table)).toBe('Users');
        expect(updateNode.from?.[0].alias).toBe('u');
    });
});

describe('T-SQL Parser - Deep Expression Validation', () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test('should handle deeply nested function calls and math', () => {
        const sql = `SELECT ROUND(SUM(Sales) * (1 + @TaxRate), 2) FROM Data`;
        const ast = parse(sql);
        const col = (ast.body[0] as SelectNode).columns[0];

        // Structural check: Function -> Binary -> Binary -> Grouping
        expect(col.expression.type).toBe('FunctionCall');
        const func = col.expression as any;
        expect(func.args[0].type).toBe('BinaryExpression');
        expect(func.args[0].operator).toBe('*');
    });

    test('should handle Boolean logic precedence (AND vs OR)', () => {
        // AND should bind tighter than OR
        const sql = `SELECT * FROM T WHERE A = 1 OR B = 2 AND C = 3`;
        const ast = parse(sql);
        const where = (ast.body[0] as SelectNode).where as any;

        expect(where.operator).toBe('OR');
        expect(where.right.operator).toBe('AND'); // Proves AND was grouped first
    });

    test('should handle complex CASE WHEN with nested logic', () => {
        const sql = `
            SELECT CASE 
                WHEN Type = 1 THEN (Price * 0.9)
                WHEN Type IN (2, 3) THEN Price 
                ELSE 0 
            END FROM Products`;
        const ast = parse(sql);
        const expr = (ast.body[0] as SelectNode).columns[0].expression as any;

        expect(expr.type).toBe('CaseExpression');
        expect(expr.branches[0].then.type).toBe('GroupingExpression');
        expect(expr.branches[1].when.type).toBe('InExpression');
    });

    test('should handle complex IN clause with subquery and parameters', () => {
        const sql = `SELECT * FROM Users WHERE ID NOT IN (SELECT UserID FROM Blacklist) AND Status = @Status`;
        const ast = parse(sql);
        const where = (ast.body[0] as SelectNode).where as any;

        expect(where.type).toBe('BinaryExpression');
        expect(where.left.type).toBe('InExpression');
        expect(where.left.isNot).toBe(true);
        expect(where.left.subquery).toBeDefined();
    });


    test('should handle T-SQL casting and collation', () => {
        const sql = `SELECT [dbo].[fn_Compute](Name) COLLATE Latin1_General_CS_AS FROM Users`;
        const ast = parse(sql);
        const col = (ast.body[0] as SelectNode).columns[0];

        // If it's a BinaryExpression (due to COLLATE), check the left side for the Function
        const expr = col.expression.type === 'BinaryExpression'
            ? (col.expression as any).left
            : col.expression;

        expect(expr.type).toBe('FunctionCall');
    });

    test('should handle negative numbers and unary NOT', () => {
        const sql = "SELECT -10 + (NOT 1)"; // Assuming this is your test input
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        const val = stmt.columns[0].expression as any;

        // OLD: expect(val.left.type).toBe('UnaryExpression');
        // NEW: The minus is now folded into the Literal
        expect(val.left.type).toBe('Literal');
        expect(val.left.value).toBe(-10);
        expect(val.left.variant).toBe('number');

        // Verification of the NOT logic (which should still be a UnaryExpression)
        const rightSide = val.right.expression; // Inside the Grouping
        expect(rightSide.type).toBe('UnaryExpression');
        expect(rightSide.operator).toBe('NOT');
    });


    test('Should resolve 3-part identifiers', () => {
        const sql = 'SELECT [DB].[Schema].[Table] FROM T';
        const parser = new Parser(new Lexer(sql));
        const ast = parser.parse().ast;

        const select = ast.body[0] as SelectNode;
        const identifier = select.columns[0].expression as any;

        expect(identifier.type).toBe('Identifier');
        expect(identifier.parts).toEqual(['[DB]', '[Schema]', '[Table]']);
        expect(identifier.name).toBe('[DB].[Schema].[Table]');
    });

    test('Should handle mixed bracketed and standard segments', () => {
        const sql = 'SELECT dbo.[Users] FROM T';
        const parser = new Parser(new Lexer(sql));
        const ast = parser.parse().ast;

        const identifier = (ast.body[0] as any).columns[0].expression;
        expect(identifier.name).toBe('dbo.[Users]');
    });

    test('Should maintain correct offsets for the whole multipart string', () => {
        const sql = 'SELECT   dbo.Table';
        const parser = new Parser(new Lexer(sql));
        const ast = parser.parse().ast;
        const identifier = (ast.body[0] as any).columns[0].expression;

        // "SELECT" (6) + 3 spaces = index 9
        expect(identifier.start).toBe(9);
        // index 9 + "dbo.Table" (9 chars) = index 18
        expect(identifier.end).toBe(18);
    });


    describe('Node Location Accuracy', () => {
        const getSqlFragment = (sql: string, node: { start: number, end: number }) => {
            return sql.substring(node.start, node.end);
        };

        test('SELECT statement should span from SELECT to the end of WHERE', () => {
            const sql = "SELECT Name, Age FROM Users WHERE ID = 10;";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;

            expect(getSqlFragment(sql, stmt)).toBe("SELECT Name, Age FROM Users WHERE ID = 10");
        });

        test('Column nodes should have precise bounds', () => {
            const sql = "SELECT FirstName AS Name FROM Users";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const col = stmt.columns[0];

            // Should include the alias but not the trailing FROM
            expect(getSqlFragment(sql, col)).toBe("FirstName AS Name");
        });

        test('UPDATE statement location spanning', () => {
            const sql = "UPDATE Users SET Active = 1 FROM Profile WHERE PId = 1";
            const ast = parse(sql);
            const stmt = ast.body[0] as UpdateNode;

            expect(getSqlFragment(sql, stmt)).toBe("UPDATE Users SET Active = 1 FROM Profile WHERE PId = 1");
        });

        test('BETWEEN expression location bounds', () => {
            const sql = "SELECT x FROM T WHERE Y BETWEEN 1 AND 10";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const between = stmt.where as any;

            // Should capture 'Y BETWEEN 1 AND 10'
            expect(getSqlFragment(sql, between)).toBe("Y BETWEEN 1 AND 10");
        });

        test('JOIN sequence should expand TableReference bounds', () => {
            const sql = "SELECT * FROM T1 INNER JOIN T2 ON T1.id = T2.id";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from!;

            // The FROM node should span from 'FROM' keyword to the end of the ON clause
            expect(getSqlFragment(sql, from[0])).toBe("FROM T1 INNER JOIN T2 ON T1.id = T2.id");
        });
    });

    describe('T-SQL Window Functions (OVER Clause)', () => {
        const getSqlFragment = (sql: string, node: { start: number, end: number }) => {
            return sql.substring(node.start, node.end);
        };

        test('should handle basic ROW_NUMBER() OVER()', () => {
            const sql = "SELECT ROW_NUMBER() OVER() as row_num FROM T";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const overExpr = stmt.columns[0].expression as OverExpression;

            expect(overExpr.type).toBe('OverExpression');
            expect(overExpr.expression.type).toBe('FunctionCall');
            expect(overExpr.window.type).toBe('WindowDefinition');

            // Exact location check
            expect(getSqlFragment(sql, overExpr)).toBe("ROW_NUMBER() OVER()");
            expect(getSqlFragment(sql, overExpr.window)).toBe("OVER()");
        });

        test('should handle OVER with PARTITION BY and ORDER BY', () => {
            const sql = "SELECT SUM(Salary) OVER(PARTITION BY DeptID ORDER BY Salary DESC) FROM Emp";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const overExpr = stmt.columns[0].expression as OverExpression;

            // Structure check
            expect(overExpr.window.partitionBy).toHaveLength(1);
            expect(overExpr.window.orderBy).toHaveLength(1);
            expect(overExpr.window.orderBy![0].direction).toBe('DESC');

            // Precision location check
            expect(getSqlFragment(sql, overExpr)).toBe("SUM(Salary) OVER(PARTITION BY DeptID ORDER BY Salary DESC)");
            expect(getSqlFragment(sql, overExpr.window)).toBe("OVER(PARTITION BY DeptID ORDER BY Salary DESC)");

            // Verify OrderBy item bounds
            const orderByItem = overExpr.window.orderBy![0];
            expect(getSqlFragment(sql, orderByItem)).toBe("Salary DESC");
        });

        test('should handle multiple columns in PARTITION BY', () => {
            const sql = "SELECT AVG(Price) OVER(PARTITION BY Category, SubCategory) FROM Products";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const overExpr = stmt.columns[0].expression as OverExpression;

            expect(overExpr.window.partitionBy).toHaveLength(2);
            expect(getSqlFragment(sql, overExpr.window.partitionBy![1])).toBe("SubCategory");
        });

        test('should handle Window functions in ORDER BY clause', () => {
            const sql = "SELECT Name FROM T ORDER BY ROW_NUMBER() OVER(ORDER BY Name)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const orderByExpr = stmt.orderBy![0].expression as OverExpression;

            expect(orderByExpr.type).toBe('OverExpression');
            expect(getSqlFragment(sql, orderByExpr)).toBe("ROW_NUMBER() OVER(ORDER BY Name)");
        });
    });


    describe('T-SQL Table Hints', () => {
        const getSqlFragment = (sql: string, node: { start: number, end: number }) => {
            return sql.substring(node.start, node.end);
        };

        test('should parse standard WITH (NOLOCK) hint', () => {
            const sql = "SELECT * FROM Users u WITH (NOLOCK)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toContain('NOLOCK');
            expect(from.alias).toBe('u');

            // Exact location check: Should include FROM keyword through hints
            expect(getSqlFragment(sql, from)).toBe("FROM Users u WITH (NOLOCK)");
        });

        test('should handle multiple hints and complex INDEX hint', () => {
            const sql = "SELECT * FROM Products p WITH (NOLOCK, INDEX(PK_Products), TABLOCK)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toHaveLength(3);
            expect(from.hints).toContain('NOLOCK');
            expect(from.hints).toContain('INDEX(PK_Products)');
            expect(from.hints).toContain('TABLOCK');

            expect(getSqlFragment(sql, from)).toBe("FROM Products p WITH (NOLOCK, INDEX(PK_Products), TABLOCK)");
        });

        test('should parse table constraint WITH index options and ON storage inside CREATE TABLE', () => {
            const sql = `
                CREATE TABLE dbo.GdoDuplicateMessage (
                    DuplicateID INT NOT NULL,
                    CONSTRAINT PK_GdoDuplicateMessage PRIMARY KEY CLUSTERED
                    (
                        DuplicateID ASC
                    )
                    WITH (
                        PAD_INDEX = OFF,
                        STATISTICS_NORECOMPUTE = OFF,
                        IGNORE_DUP_KEY = OFF,
                        ALLOW_ROW_LOCKS = ON,
                        ALLOW_PAGE_LOCKS = ON
                    ) ON [PRIMARY]
                ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as CreateNode;

            expect(result.issues).toEqual([]);
            expect(stmt.constraints).toHaveLength(1);
            expect(stmt.constraints?.[0].kind).toBe('PRIMARY KEY');
            expect(stmt.constraints?.[0].storage?.name).toBe('[PRIMARY]');
            expect(stmt.columns?.some(col => col.name === 'WITH')).toBe(false);
        });

        test('should keep named inline UNIQUE and DEFAULT constraints on their columns', () => {
            const sql = `
                CREATE TABLE [dbo].[Configuration]
                (
                    [Id] INT IDENTITY(1,1) NOT NULL,
                    [ConfigName] VARCHAR(50) CONSTRAINT [UK_Configuration_ConfigName] UNIQUE NOT NULL,
                    [ConfigValue] VARCHAR(2000) NOT NULL,
                    [IsActive] BIT NOT NULL,
                    [UpdatedBy] NVARCHAR(50) NULL,
                    [UpdatedDate] DATETIME CONSTRAINT [DC_Configuration_UpdatedDate] DEFAULT (GETUTCDATE()) NOT NULL,
                    [Comment] VARCHAR(255) NULL,
                    CONSTRAINT PK_Configuration_Id PRIMARY KEY CLUSTERED(Id ASC)
                );
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as CreateNode;
            const configName = stmt.columns?.find(col => col.name === '[ConfigName]');
            const updatedDate = stmt.columns?.find(col => col.name === '[UpdatedDate]');

            expect(result.issues).toEqual([]);
            expect(configName?.constraints?.some(c => c.kind === 'UNIQUE')).toBe(true);
            expect(configName?.constraints?.some(c => c.kind === 'NOT NULL')).toBe(true);
            expect(updatedDate?.constraints?.some(c => c.kind === 'DEFAULT')).toBe(true);
            expect(updatedDate?.constraints?.some(c => c.kind === 'NOT NULL')).toBe(true);
            expect(stmt.constraints).toHaveLength(1);
            expect(stmt.columns?.some(col => col.name === 'NOT')).toBe(false);
        });

        test('should parse inline table indexes inside CREATE TABLE', () => {
            const sql = `
                CREATE TABLE [dbo].[ItemsSelected]
                (
                    [Id] BIGINT IDENTITY(1,1) NOT NULL,
                    [ItemsId] BIGINT,
                    [ContextId] BIGINT,
                    CONSTRAINT [PK_ItemsSelected] PRIMARY KEY CLUSTERED ([Id] ASC),
                    INDEX NC_ItemsSelected_ContextId_ItemsId NONCLUSTERED ([ContextId], [ItemsId])
                )
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as CreateNode;

            expect(result.issues).toEqual([]);
            expect(stmt.indexes).toHaveLength(1);
            expect(stmt.indexes?.[0].name).toBe('NC_ItemsSelected_ContextId_ItemsId');
            expect(stmt.indexes?.[0].clustered).toBe('NONCLUSTERED');
            expect(stmt.indexes?.[0].columns.map(c => c.name)).toEqual(['[ContextId]', '[ItemsId]']);
            expect(stmt.columns?.some(col => col.name === 'INDEX')).toBe(false);
        });

        test('should parse inline indexes inside CREATE TYPE AS TABLE', () => {
            const sql = `
                CREATE TYPE [dbo].[SomeTableType] AS TABLE (
                    [Name] NVARCHAR(30) NOT NULL,
                    [ModelId] VARCHAR(20) NULL,
                    [IsService] BIT NOT NULL,
                    [IsNonSelected] BIT NOT NULL,
                    INDEX [ix_nc_1] ([ModelId]),
                    INDEX [ix_nc_2] ([Name], [IsService]),
                    INDEX [ix_nc_3] ([IsNonSelected])
                );
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as CreateNode;

            expect(result.issues).toEqual([]);
            expect(stmt.objectType).toBe('TYPE');
            expect(stmt.isTableType).toBe(true);
            expect(stmt.indexes).toHaveLength(3);
            expect(stmt.indexes?.map(i => i.name)).toEqual([
                '[ix_nc_1]',
                '[ix_nc_2]',
                '[ix_nc_3]'
            ]);
        });

        test('should handle legacy hint syntax without WITH keyword', () => {
            // T-SQL supports FROM Table (HINT) if an alias is present
            const sql = "SELECT * FROM Orders o (ROWLOCK)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toContain('ROWLOCK');
            expect(getSqlFragment(sql, from)).toBe("FROM Orders o (ROWLOCK)");
        });

        test('should handle hints followed by a JOIN', () => {
            // Note: T2 has a hint here
            const sql = "SELECT * FROM T1 WITH (NOLOCK) JOIN T2 WITH(NOLOCK) ON T1.id = T2.id";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toContain('NOLOCK');
            expect(from.joins[0].hints).toContain('NOLOCK'); // Check T2's hint too!

            // The fragment must match the SQL input exactly
            expect(getSqlFragment(sql, from)).toBe("FROM T1 WITH (NOLOCK) JOIN T2 WITH(NOLOCK) ON T1.id = T2.id");
        });

        test('should parse UPDATE target WITH(ROWLOCK)', () => {
            const sql = `
                UPDATE dbo.WorkQueue WITH(ROWLOCK)
                SET ProcessState = @BatchId
                WHERE Id IN
                    (SELECT TOP(@BatchSize) queueRow.Id
                     FROM dbo.WorkQueue queueRow WITH(NOLOCK)
                     WHERE queueRow.ProcessState = 'I'
                     ORDER BY queueRow.CreatedOnUtc ASC)
            `;
            const ast = parse(sql);
            const stmt = ast.body[0] as UpdateNode;

            expect(stmt.type).toBe('UpdateStatement');
            expect(stmt.target).not.toBeNull();
            expect(stmt.target?.type).toBe('Identifier');
            expect(stmt.targetHints).toContain('ROWLOCK');
            expect(stmt.where).toBeDefined();
        });
    });

    describe('T-SQL Parser - MERGE Statement', () => {
        test('should preserve source casing for MERGE target multipart identifier', () => {
            const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN UPDATE SET Name = S.Name;`;
            const stmt = parse(sql).body[0] as any;

            expect(stmt.target?.type).toBe('Identifier');
            expect(stmt.target?.name).toBe('dbo.Target');
            expect(stmt.target?.parts).toEqual(['dbo', 'Target']);
        });

        test('should parse MERGE with UPDATE and INSERT actions', () => {
            const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN UPDATE SET Name = S.Name
WHEN NOT MATCHED THEN INSERT (Name) VALUES (S.Name);`;
            const ast = parse(sql);
            const stmt = ast.body[0] as any;

            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.targetAlias).toBe('T');
            expect(stmt.using.alias).toBe('S');
            expect(stmt.whenClauses).toHaveLength(2);
            expect(stmt.whenClauses[0].action.type).toBe('MergeUpdateAction');
            expect(stmt.whenClauses[1].action.type).toBe('MergeInsertAction');
            expect(stmt.whenClauses[1].action.columns).toEqual(['Name']);
            expect(stmt.whenClauses[1].action.values).toHaveLength(1);
        });

        test('should parse MERGE TOP clause and DELETE action', () => {
            const sql = `MERGE TOP (10) dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN DELETE;`;
            const ast = parse(sql);
            const stmt = ast.body[0] as any;

            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.top?.type).toBe('TopClause');
            expect(stmt.top?.percent).toBe(false);
            expect(stmt.top?.withTies).toBe(false);
            expect((stmt.top?.quantity as LiteralNode).value).toBe(10);
            expect(stmt.whenClauses).toHaveLength(1);
            expect(stmt.whenClauses[0].action.type).toBe('MergeDeleteAction');
        });

        test('should parse MERGE TOP variable expression', () => {
            const sql = `MERGE TOP (@n) dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN DELETE;`;
            const ast = parse(sql);
            const stmt = ast.body[0] as any;

            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.top?.type).toBe('TopClause');
            expect(stmt.top?.quantity?.type).toBe('Variable');
            expect(stmt.top?.quantity?.name).toBe('@n');
        });

        test('should parse MERGE NOT MATCHED BY SOURCE with INSERT SELECT', () => {
            const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN NOT MATCHED BY SOURCE THEN INSERT (Name) SELECT S.Name;`;
            const ast = parse(sql);
            const stmt = ast.body[0] as any;

            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.whenClauses[0].condition).toBe('NOT MATCHED BY SOURCE');
            expect(stmt.whenClauses[0].action.type).toBe('MergeInsertAction');
            expect(stmt.whenClauses[0].action.columns).toEqual(['Name']);
            expect(stmt.whenClauses[0].action.selectQuery).toBeDefined();
        });

        test('should parse MERGE NOT MATCHED BY TARGET with INSERT action', () => {
            const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN NOT MATCHED BY TARGET THEN INSERT (Name) VALUES (S.Name);`;
            const ast = parse(sql);
            const stmt = ast.body[0] as any;

            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.whenClauses[0].condition).toBe('NOT MATCHED BY TARGET');
            expect(stmt.whenClauses[0].action.type).toBe('MergeInsertAction');
            expect(stmt.whenClauses[0].action.columns).toEqual(['Name']);
            expect(stmt.whenClauses[0].action.values).toHaveLength(1);
        });

        test('should parse MERGE with OUTPUT clause', () => {
            const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN UPDATE SET Name = S.Name
OUTPUT inserted.Id, deleted.Id INTO Audit(InsertedId, DeletedId);`;
            const ast = parse(sql);
            const stmt = ast.body[0] as any;

            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.output).toBeDefined();
            expect(stmt.output.columns.length).toBe(2);
            expect(stmt.output.intoTable.name).toBe('Audit');
            expect(stmt.output.intoColumns).toEqual(['InsertedId', 'DeletedId']);
        });

        test('should parse MERGE INTO with derived USING source and OUTPUT INTO table variable', () => {
            const sql = `MERGE INTO dbo.Target AS tgt
  USING
  (
    SELECT DISTINCT pendingRow.KeyValue, pendingRow.DisplayValue
    FROM @PendingRows pendingRow
) AS srcRows
ON 1 = 0
WHEN NOT MATCHED THEN
    INSERT (KeyValue, DisplayValue)
    VALUES (srcRows.KeyValue, srcRows.DisplayValue)
OUTPUT srcRows.KeyValue, srcRows.DisplayValue, INSERTED.TargetId
INTO @NewRows (KeyValue, DisplayValue, TargetId);`;
            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as any;

            expect(result.issues).toEqual([]);
            expect(stmt.type).toBe('MergeStatement');
            expect(stmt.targetAlias).toBe('tgt');
            expect(stmt.using?.table?.type).toBe('SubqueryExpression');
            expect(stmt.using?.alias).toBe('srcRows');
            expect(stmt.whenClauses[0].action.type).toBe('MergeInsertAction');
            expect(stmt.output).toBeDefined();
            expect(stmt.output.intoTable.name).toBe('@NewRows');
            expect(stmt.output.intoColumns).toEqual(['KeyValue', 'DisplayValue', 'TargetId']);
        });

        test('should not treat following MERGE statement as a JOIN after prior FROM without semicolon', () => {
            const sql = `
                SELECT @MaxDate = MAX(ModifiedOn)
                FROM dbo.StageRows WITH (NOLOCK)

                MERGE INTO dbo.TargetRows tgt
                USING (SELECT RowId FROM dbo.SourceRows) src
                ON tgt.RowId = src.RowId
                WHEN NOT MATCHED BY TARGET THEN
                    INSERT (RowId) VALUES (src.RowId)
                WHEN MATCHED THEN
                    UPDATE SET tgt.RowId = src.RowId;
            `;

            const result = new Parser(new Lexer(sql)).parse();

            expect(result.issues).toEqual([]);
            expect(result.ast.body[0].type).toBe('SelectStatement');
            expect(result.ast.body[1].type).toBe('MergeStatement');
        });
    });

    describe('T-SQL Parser - Architectural Improvements', () => {

        test('should handle multi-row and multi-column INSERT (2D Values)', () => {
            const sql = "INSERT INTO Users (ID, Name) VALUES (1, 'Alice'), (2, 'Bob');";
            const ast = parse(sql);
            const insert = ast.body[0] as any;

            expect(insert.type).toBe('InsertStatement');
            expect(insert.columns).toEqual(['ID', 'Name']);

            // Validate 2D structure: Expression[][]
            expect(insert.values.length).toBe(2); // 2 rows
            expect(insert.values[0].length).toBe(2); // 2 columns in row 1
            expect(insert.values[1].length).toBe(2); // 2 columns in row 2

            expect(insert.values[0][0].value).toBe(1);
            expect(insert.values[1][1].value).toBe('Bob');
        });

        test('should handle complex Session SET options', () => {
            const sql = "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;";
            const ast = parse(sql);
            const setStmt = ast.body[0] as any;

            expect(setStmt.type).toBe('SetStatement');
            // Now captures the entire multi-token string
            expect(setStmt.variable).toBe('TRANSACTION ISOLATION LEVEL READ COMMITTED');
        });

        test('should handle ANSI comma-separated FROM sources', () => {
            const sql = "SELECT * FROM Users u, Orders o WHERE u.ID = o.UserID";
            const ast = parse(sql);
            const select = ast.body[0] as any;

            // Verify the TableReference[] array
            expect(Array.isArray(select.from)).toBe(true);
            expect(select.from.length).toBe(2);
            expect(select.from[0].alias).toBe('u');
            expect(getTableName(select.from[1].table)).toBe('Orders');
            expect(select.from[1].alias).toBe('o');
        });

        test('should fold negative numbers into single Literals', () => {
            const sql = "SELECT -50, NOT 1";
            const ast = parse(sql);
            const select = ast.body[0] as any;

            const firstCol = select.columns[0].expression;
            const secondCol = select.columns[1].expression;

            // Negative number check
            expect(firstCol.type).toBe('Literal');
            expect(firstCol.value).toBe(-50);

            // Unary NOT check (should remain UnaryExpression)
            expect(secondCol.type).toBe('UnaryExpression');
            expect(secondCol.operator).toBe('NOT');
        });

        test('should handle Dot precedence in complex expressions', () => {
            const sql = "SELECT u.ID + 10 FROM Users u";
            const ast = parse(sql);
            const select = ast.body[0] as any;
            const expr = select.columns[0].expression;

            // If Dot precedence was low, + would grab 'ID' and fail.
            // It must be BinaryExpression(+) -> Left: Identifier(u.ID)
            expect(expr.type).toBe('BinaryExpression');
            expect(expr.operator).toBe('+');
            expect(expr.left.type).toBe('Identifier');
            expect(expr.left.name).toBe('u.ID');
        });

        test('should handle empty parseList resilience in Functions', () => {
            const sql = "SELECT COUNT(), GETDATE()";
            // This would have crashed the old parser that expected [parserFn()]
            expect(() => parse(sql)).not.toThrow();
            const ast = parse(sql);
            const select = ast.body[0] as any;

            expect(select.columns[0].expression.args.length).toBe(0);
        });
    });

    describe('T-SQL Parser - Built-in Function Arguments', () => {
        test('should parse built-in keyword arguments in DATEDIFF correctly', () => {
            const sql = "SELECT DATEDIFF(day, StartDate, EndDate) FROM Dates";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const funcCall = stmt.columns[0].expression as any;

            expect(funcCall.type).toBe('FunctionCall');
            expect(funcCall.name).toBe('DATEDIFF');
            expect(funcCall.args).toHaveLength(3);
            
            expect(funcCall.args[0].type).toBe('BuiltInArgument');
            expect(funcCall.args[0].value).toBe('day');
            expect(funcCall.args[1].type).toBe('Identifier');
            expect(funcCall.args[2].type).toBe('Identifier');
        });
    });

    describe('OUTPUT clause', () => {
        test('should parse INSERT OUTPUT inserted.Id', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output).toBeDefined();
            expect(stmt.output!.columns).toHaveLength(1);
            expect(stmt.output!.columns[0].sourceTable).toBe('INSERTED');
            expect(stmt.output!.columns[0].column.sourceName).toBe('Id');
        });

        test('should parse INSERT OUTPUT multiple columns', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id, inserted.Name
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output!.columns).toHaveLength(2);

            expect(stmt.output!.columns[0].sourceTable).toBe('INSERTED');
            expect(stmt.output!.columns[0].column.sourceName).toBe('Id');

            expect(stmt.output!.columns[1].sourceTable).toBe('INSERTED');
            expect(stmt.output!.columns[1].column.sourceName).toBe('Name');
        });

        test('should parse UPDATE OUTPUT inserted and deleted', () => {
            const sql = `
            UPDATE Users
            SET Name = 'John'
            OUTPUT inserted.Name, deleted.Name
            WHERE Id = 1
        `;

            const stmt = parse(sql).body[0] as UpdateNode;

            expect(stmt.output).toBeDefined();
            expect(stmt.output!.columns).toHaveLength(2);

            expect(stmt.output!.columns[0].sourceTable).toBe('INSERTED');
            expect(stmt.output!.columns[0].column.sourceName).toBe('Name');

            expect(stmt.output!.columns[1].sourceTable).toBe('DELETED');
            expect(stmt.output!.columns[1].column.sourceName).toBe('Name');
        });

        test('should parse DELETE OUTPUT deleted.Id', () => {
            const sql = `
            DELETE FROM Users
            OUTPUT deleted.Id
            WHERE Id = 1
        `;

            const stmt = parse(sql).body[0] as DeleteNode;

            expect(stmt.output).toBeDefined();
            expect(stmt.output!.columns).toHaveLength(1);
            expect(stmt.output!.columns[0].sourceTable).toBe('DELETED');
            expect(stmt.output!.columns[0].column.sourceName).toBe('Id');
        });

        test('should parse DELETE TOP alias OUTPUT FROM join shape without issues', () => {
            const sql = `
                DELETE TOP (20000) targetRow
                OUTPUT deleted.SKU
                     , deleted.LocationCode
                     , deleted.CurrentValue
                     , NULL NewValue
                     , NULL NewDate
                     , deleted.PreviousValue
                     , NULL NewPreviousValue
                     , 'Cleanup' UpdatedBy INTO #AuditHistory (SKU, LocationCode, CurrentValue, NewValue, NewDate, PreviousValue, NewPreviousValue, UpdatedBy)
                FROM dbo.TargetTable targetRow
                    JOIN #SelectedLocations selectedLocation ON selectedLocation.LocationCode = targetRow.LocationCode
                    LEFT JOIN dbo.LocationReplica replica WITH (NOLOCK) ON replica.ReplicaLocationCode = targetRow.LocationCode
                    LEFT JOIN dbo.SourceTable sourceRow WITH(NOLOCK) ON sourceRow.SKU = targetRow.SKU
                                                                    AND sourceRow.LocationCode = ISNULL(replica.PrimaryLocationCode, targetRow.LocationCode)
                WHERE sourceRow.SKU IS NULL
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as DeleteNode;

            expect(result.issues).toHaveLength(0);
            expect(stmt.type).toBe('DeleteStatement');
            expect((stmt.target as IdentifierNode).name).toBe('targetRow');
            expect(stmt.output).toBeDefined();
            expect(stmt.from).toHaveLength(1);
            expect(stmt.from?.[0].joins).toHaveLength(3);
            expect(stmt.where).toBeDefined();
        });

        test('should parse OUTPUT wildcard', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.*
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output).toBeDefined();
            expect(stmt.output!.columns).toHaveLength(1);

            const col = stmt.output!.columns[0];

            expect(col.sourceTable).toBe('INSERTED');
            expect(col.column.wildcard).toBe(true);
            expect(col.column.sourceName).toBe('*');
        });

        test('should parse SELECT columns with string literal aliases', () => {
            const sql = `
                SELECT @UploadedFileName AS 'UploadedFileName',
                       @InternalFileName AS 'InternalFileName'
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as SelectNode;

            expect(result.issues).toHaveLength(0);
            expect(stmt.type).toBe('SelectStatement');
            expect(stmt.columns).toHaveLength(2);
            expect(stmt.columns[0].alias).toBe('UploadedFileName');
            expect(stmt.columns[1].alias).toBe('InternalFileName');
        });

        test('should parse SELECT columns with implicit string literal aliases', () => {
            const sql = `
                SELECT CASE category.RegionCode WHEN 1 THEN 'Primary' ELSE 'Secondary' END 'Source Label',
                       item.LastModifiedAt 'Modified Date'
                FROM dbo.Items item
                JOIN dbo.Category category ON category.Id = item.CategoryId
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as SelectNode;

            expect(result.issues).toHaveLength(0);
            expect(stmt.type).toBe('SelectStatement');
            expect(stmt.columns).toHaveLength(2);
            expect(stmt.columns[0].alias).toBe('Source Label');
            expect(stmt.columns[1].alias).toBe('Modified Date');
            expect(stmt.from).toHaveLength(1);
            expect(stmt.from?.[0].joins).toHaveLength(1);
        });

        test('should parse procedure TVP parameter with optional AS', () => {
            const sql = `
                CREATE PROCEDURE dbo.ProcessItems
                    @ItemIds AS [dbo].[IdType] READONLY,
                    @ChangedBy VARCHAR(255)
                AS
                BEGIN
                    DECLARE @AuditItems [dbo].[AuditType];
                END
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[0] as CreateNode;

            expect(result.issues).toHaveLength(0);
            expect(stmt.type).toBe('CreateStatement');
            expect(stmt.parameters).toHaveLength(2);
            expect(stmt.parameters?.[0].dataType).toBe('[dbo].[IdType]');
            expect(stmt.parameters?.[0].isReadOnly).toBe(true);
        });

        test('should parse OUTPUT INTO table', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO Audit
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output).toBeDefined();
            expect(stmt.output!.intoTable).toBeDefined();

            const table = stmt.output!.intoTable as IdentifierNode;
            expect(table.name).toBe('Audit');
        });

        test('should parse OUTPUT INTO table columns', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id, inserted.Name
            INTO Audit(Id, Name)
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output).toBeDefined();

            const table = stmt.output!.intoTable as IdentifierNode;
            expect(table.name).toBe('Audit');

            expect(stmt.output!.intoColumns).toEqual([
                'Id',
                'Name'
            ]);
        });

        test('should parse OUTPUT INTO columns with keyword-shaped identifiers', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO Audit(OffSet)
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output!.intoColumns).toEqual([
                'OFFSET'
            ]);
        });

        test('should parse OUTPUT INTO multipart table name', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO dbo.Audit
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            const table = stmt.output!.intoTable as IdentifierNode;

            expect(table.parts).toEqual([
                'dbo',
                'Audit'
            ]);
        });

        test('should parse bracketed OUTPUT identifiers', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.[User Id]
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(
                stmt.output!.columns[0].column.sourceName
            ).toBe('[User Id]');
        });

        test('should parse OUTPUT alias', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id AS NewId
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            const col = stmt.output!.columns[0].column;

            expect(col.sourceName).toBe('Id');
            expect(col.outputName).toBe('NewId');
        });

        test('should parse OUTPUT assignment alias style', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT NewId = inserted.Id
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            const col = stmt.output!.columns[0].column;

            expect(col.sourceName).toBe('Id');
            expect(col.outputName).toBe('NewId');
        });

        test('should parse OUTPUT function expression', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT LEN(inserted.Name) AS NameLength
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            const col = stmt.output!.columns[0].column;

            expect(col.outputName).toBe('NameLength');
            expect(col.expression.type).toBe('FunctionCall');
        });

        test('should parse OUTPUT literal expression', () => {
            const sql = `
            INSERT INTO Users(Name)
            OUTPUT 1 AS Flag
            VALUES ('John')
        `;

            const stmt = parse(sql).body[0] as InsertNode;

            const col = stmt.output!.columns[0].column;

            expect(col.outputName).toBe('Flag');
            expect(col.expression.type).toBe('Literal');
        });

        test('should parse OUTPUT INTO variable table', () => {
            const sql = `
                INSERT INTO Users(Name)
                OUTPUT inserted.Id
                INTO @Audit
                VALUES ('John')
            `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output!.intoTable).toBeDefined();

            const table = stmt.output!.intoTable as IdentifierNode;
            expect(table.name).toBe('@Audit');
        });

        test('should recover malformed OUTPUT clause', () => {
            const sql = `
        INSERT INTO Users(Name)
        OUTPUT inserted.
        VALUES ('John')
    `;

            const stmt = parse(sql).body[0] as InsertNode;

            expect(stmt.output).toBeDefined();
            expect(stmt.output!.columns.length).toBeGreaterThanOrEqual(0);
        });

        test('should parse WITH XMLNAMESPACES followed by SELECT', () => {
            const sql = `
                DECLARE @Message XML;
                ;WITH XMLNAMESPACES (
                    'http://example.com/service' AS svc,
                    'http://example.com/data' AS data
                )
                SELECT @Message.value('(/svc:Root/data:Value)[1]', 'varchar(20)');
            `;

            const result = new Parser(new Lexer(sql)).parse();
            const stmt = result.ast.body[1] as WithNode;

            expect(result.issues).toEqual([]);
            expect(stmt.type).toBe('WithStatement');
            expect(stmt.xmlNamespaces).toHaveLength(2);
            expect(stmt.xmlNamespaces?.[0].prefix).toBe('svc');
            expect((stmt.body as SelectNode).type).toBe('SelectStatement');
        });
    });



});
