import { Lexer } from '../src/lexer';
import { Parser, SelectNode, InsertNode, UpdateNode, DeleteNode, DeclareNode, SetNode, CreateNode, SetOperatorNode, IfNode, BlockNode, WithNode } from '../src/parser';

describe('T-SQL Parser', () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse();
    };

    test('should build AST for a basic SELECT', () => {
        const sql = 'SELECT Name, Age FROM Users WHERE Id = 1;';
        const ast = parse(sql);
        expect(ast).toMatchSnapshot();
    });

    test('should handle T-SQL TOP clause', () => {
        const sql = 'SELECT TOP 10 * FROM Logs;';
        const ast = parse(sql);
        expect(ast.body[0].type).toBe('SelectStatement');
        // Ensure your custom parser captures the 'limit' or 'top' node
        expect(ast).toMatchSnapshot();
    });

    test('should handle T-SQL TOP and JOINs', () => {
        const sql = `
        SELECT TOP (10) e.Name FROM Employees AS e 
        INNER JOIN Departments AS d ON e.DeptId = d.Id
    `;
        const ast = parse(sql); // Assuming your test helper
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.top).toBe('10');

        // Structural Check: This pattern is what FI uses to identify table lineage
        if (stmt.from) {
            expect(stmt.from.table).toBe('Employees');
            expect(stmt.from.joins.length).toBe(1);
            expect(stmt.from.joins[0].type).toBe('INNER JOIN');
        } else {
            throw new Error("Parser failed to identify the FROM clause");
        }
    });

    test('should handle WHERE clause with T-SQL operators', () => {
        const sql = `SELECT Name FROM Users WHERE Status = 'Active' AND [Date] >= '2025-01-01'`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.type).toBe('SelectStatement');

        // Normalize spaces for the comparison to ensure the logic is captured
        const normalizedWhere = stmt.where?.replace(/\s+/g, ' ');

        // Check for correct content (Lexer strips brackets from [Date])
        expect(normalizedWhere).toMatch(/Status\s*=\s*'Active'/);
        expect(normalizedWhere).toMatch(/AND\s*\[Date\]\s*>=\s*'2025-01-01'/);
    });

    test('should handle ORDER BY with multiple columns and directions', () => {
        const sql = `SELECT Name FROM Users ORDER BY Name, Id DESC`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.type).toBe('SelectStatement');
        expect(stmt.orderBy).toBeDefined();

        if (stmt.orderBy) {
            expect(stmt.orderBy).toHaveLength(2);
            // First column defaults to ASC
            expect(stmt.orderBy[0]).toEqual({ column: 'Name', direction: 'ASC' });
            // Second column is explicit DESC
            expect(stmt.orderBy[1]).toEqual({ column: 'Id', direction: 'DESC' });
        }
    });

    test('should handle GROUP BY with multiple columns', () => {
        const sql = `SELECT Region
                            , Category
                            , SUM(Sales) 
                     FROM Sales.Data 
                     GROUP BY Region
                              , Category`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.type).toBe('SelectStatement');
        expect(stmt.groupBy).toBeDefined();

        if (stmt.groupBy) {
            expect(stmt.groupBy).toHaveLength(2);
            expect(stmt.groupBy[0]).toBe('Region');
            expect(stmt.groupBy[1]).toBe('Category');
        }
    });

    test('should handle GROUP BY with HAVING clause', () => {
        const sql = `
        SELECT Category, SUM(Sales) 
        FROM Sales.Data 
        GROUP BY Category 
        HAVING SUM(Sales) > 1000
    `;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        //console.log(JSON.stringify(stmt, null, 2));

        expect(stmt.type).toBe('SelectStatement');
        expect(stmt.groupBy).toContain('Category');

        // Verify HAVING expression is captured with proper spacing
        expect(stmt.having).toBe('SUM(Sales) > 1000');
    });

    test('should handle SELECT DISTINCT with complex clauses', () => {
        const sql = `SELECT DISTINCT TOP 10 Name FROM Users WHERE Status = 'Active' ORDER BY Name`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.type).toBe('SelectStatement');
        expect(stmt.distinct).toBe(true);
        expect(stmt.top).toBe('10');
        expect(stmt.from?.table).toBe('Users');
    });

    test('should handle SELECT ALL (explicit default)', () => {
        const sql = `SELECT ALL Name FROM Users`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.distinct).toBe(false);
        expect(stmt.columns[0].name).toBe('Name');
    });

    test('should handle all T-SQL alias styles', () => {
        const sql = `SELECT ID = UserID, Name AS UserName, Email FROM Users`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // Assignment style: ID = UserID
        expect(stmt.columns[0]).toEqual({
            type: 'Column',
            name: 'UserID',
            alias: 'ID',
            expression: 'UserID',
            tablePrefix: undefined
        });

        // AS style: Name AS UserName
        expect(stmt.columns[1]).toEqual({
            type: 'Column',
            name: 'Name',
            alias: 'UserName',
            expression: 'Name',
            tablePrefix: undefined
        });

        // No alias: Email
        expect(stmt.columns[2]).toEqual({
            type: 'Column',
            name: 'Email',
            alias: undefined,
            expression: 'Email',
            tablePrefix: undefined
        });
    });

    test('should handle table aliases and correctly identify clause boundaries', () => {
        const sql = `SELECT u.Name FROM Users u WHERE u.ID = 1`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.from?.table).toBe('Users');
        expect(stmt.from?.alias).toBe('u'); // Correctly identified 'u' as alias
        expect(stmt.where).toBe('u.ID = 1'); // Did not swallow 'WHERE' as an alias
    });

    test('should handle explicit AS for tables', () => {
        const sql = `SELECT o.OrderName, u.Name FROM Users AS u JOIN Orders AS o ON u.ID = o.BookedUserId`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        //console.log(JSON.stringify(stmt, null, 2))
        expect(stmt.from?.table).toBe('Users');
        expect(stmt.from?.alias).toBe('u');
    });

    test('should handle bracketed identifiers and spaces', () => {
        const sql = `SELECT [First Name] FN , [Order ID] FROM [Sales].[Customer Orders]`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        //console.log(JSON.stringify(stmt, null, 2))
        expect(stmt.columns[0].name).toBe('[First Name]');
        expect(stmt.from?.table).toBe('[Sales].[Customer Orders]');
    });

    test('should handle IN clause with list of values', () => {
        const sql = `SELECT Name FROM Users WHERE ID IN (1, 2, 3, 4, 5)`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.where).toBe('ID IN (1, 2, 3, 4, 5)');
    });

    test('should handle BETWEEN clause for ranges', () => {
        const sql = `SELECT Name FROM Users WHERE CreatedDate BETWEEN '2023-01-01' AND '2023-12-31'`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.where).toBe("CreatedDate BETWEEN '2023-01-01' AND '2023-12-31'");
    });

    test('should handle complex expressions combining IN and BETWEEN', () => {
        const sql = `SELECT * FROM Products WHERE CategoryID IN (10, 20) AND Price BETWEEN 100 AND 500`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.where).toBe('CategoryID IN (10, 20) AND Price BETWEEN 100 AND 500');
    });

    test('should handle subquery inside IN clause', () => {
        const sql = `SELECT Name FROM Users WHERE ID IN (SELECT UserID FROM Orders WHERE Status = 1)`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(stmt.where).toContain('SelectStatement');
    });

    test('should handle INSERT with VALUES and SELECT', () => {
        // Test 1: Standard Values
        const sql1 = `INSERT INTO Users (ID, Name) VALUES (1, 'Saral')`;
        const ast1 = parse(sql1);
        expect(ast1.body[0].type).toBe('InsertStatement');
        expect((ast1.body[0] as InsertNode).table).toBe('Users');

        // Test 2: Insert from Select
        const sql2 = `INSERT INTO ArchiveUsers SELECT * FROM Users WHERE Deleted = 1`;
        const ast2 = parse(sql2);
        const insertNode = ast2.body[0] as InsertNode;


        expect(insertNode.selectQuery?.type).toBe('SelectStatement');
    });

    test('should handle standard and join-based UPDATE', () => {
        // Standard
        const sql1 = `UPDATE Users SET Status = 'Active' WHERE ID = 1`;
        const ast1 = parse(sql1);
        expect(ast1.body[0].type).toBe('UpdateStatement');
        expect((ast1.body[0] as UpdateNode).target).toBe('Users');

        // T-SQL Join Syntax
        const sql2 = `
        UPDATE u 
        SET u.Email = o.Email 
        FROM Users u 
        JOIN Orders o ON u.ID = o.UserID
    `;
        const ast2 = parse(sql2);

        const updateNode = ast2.body[0] as UpdateNode;
        expect(updateNode.target).toBe('u');
        expect(updateNode.from?.table).toBe('Users');
        expect(updateNode.from?.joins[0].table).toBe('Orders');
    });

    test('should handle standard and join-based DELETE', () => {
        // Standard T-SQL Delete
        const sql1 = `DELETE FROM Users WHERE Status = 'Inactive'`;
        const ast1 = parse(sql1);
        expect(ast1.body[0].type).toBe('DeleteStatement');
        expect((ast1.body[0] as DeleteNode).target).toBe('Users');

        // T-SQL Join-style Delete
        const sql2 = `
        DELETE u 
        FROM Users u 
        JOIN ArchiveLog a ON u.ID = a.UserID 
        WHERE a.BatchID = 100
    `;
        const ast2 = parse(sql2);

        //console.log(JSON.stringify(ast2, null, 2))

        const deleteNode = ast2.body[0] as DeleteNode;
        expect(deleteNode.target).toBe('u');
        expect(deleteNode.from?.table).toBe('Users');
        expect(deleteNode.from?.joins[0].table).toBe('ArchiveLog');
    });

    test('should handle DECLARE with multiple variables and assignments', () => {
        const sql = `DECLARE @ID INT = 1, @Name VARCHAR(MAX) = 'Saral'`;
        const ast = parse(sql);

        const node = ast.body[0] as DeclareNode;
        expect(node.type).toBe('DeclareStatement');
        expect(node.variables).toHaveLength(2);
        expect(node.variables[0].name).toBe('@ID');
        expect(node.variables[1].dataType).toBe('VARCHAR(MAX)');
    });

    test('should handle SET variable assignment', () => {
        const sql = `SET @Counter = @Counter + 1`;
        const ast = parse(sql);

        const node = ast.body[0] as SetNode;
        //console.log(JSON.stringify(node, null, 2))
        expect(node.type).toBe('SetStatement');
        expect(node.variable).toBe('@Counter');
        expect(node.value).toBe('@Counter + 1');
    });

    test('should handle CREATE TABLE with types and constraints', () => {
        const sql = `CREATE TABLE [dbo].[Users] (ID INT PRIMARY KEY, Name VARCHAR(50) NOT NULL)`;
        const ast = parse(sql);

        const node = ast.body[0] as CreateNode;
        //console.log(JSON.stringify(node, null, 2))
        expect(node.type).toBe('CreateStatement');

        expect(node.objectType).toBe('TABLE');
        expect(node.name).toBe('[dbo].[Users]');
        expect(node.columns?.[0].constraints).toContain('PRIMARY KEY');
    });

    test('should handle CREATE VIEW and basic PROCEDURE', () => {
        // View
        const sql1 = `CREATE VIEW vUserSummary AS SELECT Name, Email FROM Users`;
        const ast1 = parse(sql1);
        const viewNode = ast1.body[0] as CreateNode;
        expect(viewNode.objectType).toBe('VIEW');
        expect((viewNode.body as SelectNode).from?.table).toBe('Users');

        // Procedure
        const sql2 = `CREATE PROCEDURE GetUser @ID INT AS SELECT * FROM Users WHERE ID = @ID`;
        const ast2 = parse(sql2);
        const procNode = ast2.body[0] as CreateNode;
        expect(procNode.parameters?.[0].name).toBe('@ID');
    });

    test('Step 1: should naturally stop at commas without explicit stop-tokens', () => {
        const sql = `SET @A = 1 + 2, @B = 3`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SetNode;
        // Changed from '(1 + 2)' to '1 + 2' to match flat reconstruction
        expect(stmt.value).toBe('1 + 2');
    });

    test('Step 1: should handle nested parentheses correctly', () => {
        const sql = `SET @Val = (1 + 2) * 3`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SetNode;
        // Changed to reflect exact input reconstruction
        expect(stmt.value).toBe('(1 + 2) * 3');
    });

    test('Step 3: should handle complex Join types and APPLY', () => {
        const sql = `
        SELECT u.Name, p.Amount 
        FROM Users u
        LEFT OUTER JOIN Payments AS p ON u.ID = p.UserID
        CROSS APPLY dbo.fn_GetDetails(u.ID)
    `;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.from?.joins[0].type).toBe('LEFT OUTER JOIN');
        expect(stmt.from?.joins[0].alias).toBe('p');
        expect(stmt.from?.joins[1].type).toBe('CROSS APPLY');
        expect(stmt.from?.joins[1].table).toContain('fn_GetDetails');
    });

    test('Step 4: should handle derived tables (subqueries) in the FROM clause', () => {
        const sql = `
        SELECT Derived.Name 
        FROM (SELECT Name FROM Users WHERE Status = 1) AS Derived
        INNER JOIN (SELECT UserID FROM Orders) o ON Derived.ID = o.UserID
    `;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // Verify the main table source is a subquery
        expect(stmt.from?.table).toContain('SelectStatement');
        expect(stmt.from?.alias).toBe('Derived');

        // Verify the Join target is also a subquery
        expect(stmt.from?.joins[0].table).toContain('SelectStatement');
        expect(stmt.from?.joins[0].alias).toBe('o');
    });

    test('Step 5: should handle CASE expressions in SELECT and WHERE', () => {
        const sql = `
        SELECT 
            CASE WHEN Status = 1 THEN 'Active' ELSE 'Inactive' END AS StatusDesc,
            CASE CategoryID WHEN 1 THEN 'Electronics' END
        FROM Products
        WHERE CASE WHEN Price > 100 THEN 1 ELSE 0 END = 1
    `;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // Verify first CASE
        expect(stmt.columns[0].expression).toContain('CASE WHEN Status = 1 THEN \'Active\' ELSE \'Inactive\' END');
        expect(stmt.columns[0].alias).toBe('StatusDesc');

        // Verify second CASE (Simple format)
        expect(stmt.columns[1].expression).toBe('CASE CategoryID WHEN 1 THEN \'Electronics\' END');

        // Verify CASE in WHERE
        expect(stmt.where).toContain('CASE WHEN Price > 100 THEN 1 ELSE 0 END = 1');
    });

    test('Step 6: should handle EXISTS and scalar subqueries', () => {
        const sql = `
        SELECT Name, (SELECT TOP 1 OrderDate FROM Orders WHERE UserID = u.ID) as LastOrder
        FROM Users u
        WHERE EXISTS (SELECT 1 FROM Orders o WHERE o.UserID = u.ID)
    `;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // Verify scalar subquery in columns
        expect(stmt.columns[1].expression).toContain('SelectStatement');
        expect(stmt.columns[1].alias).toBe('LastOrder');

        // Verify EXISTS subquery in WHERE
        expect(stmt.where).toContain('EXISTS');
        expect(stmt.where).toContain('SelectStatement');
    });

    test('Step 7: should handle chained UNION ALL and EXCEPT', () => {
        const sql = `
        SELECT Name FROM Users
        UNION ALL
        SELECT Name FROM Admins
        EXCEPT
        SELECT Name FROM Blacklist
    `;
        const ast = parse(sql);
        const setNode = ast.body[0] as SetOperatorNode;

        // The top node should be the last operation (EXCEPT) due to left-recursion
        expect(setNode.operator).toBe('EXCEPT');
        expect((setNode.left as SetOperatorNode).operator).toBe('UNION ALL');
    });

    test('Step 8: should handle DECLARE and SET statements', () => {
        const sql = `
        DECLARE @ID INT = 10, @Name VARCHAR(50);
        SET @ID = @ID + 1;
        SELECT @Name = Name FROM Users WHERE ID = @ID;
    `;
        const ast = parse(sql);

        // Verify DECLARE - checking .variables instead of .declarations
        const decl = ast.body[0] as DeclareNode;
        expect(decl.variables.length).toBe(2);
        expect(decl.variables[0].name).toBe('@ID');
        expect(decl.variables[0].initialValue).toBe('10');
        expect(decl.variables[1].dataType).toBe('VARCHAR(50)');

        // Verify SET
        const setStmt = ast.body[1] as SetNode;
        expect(setStmt.variable).toBe('@ID');
        expect(setStmt.value).toBe('@ID + 1');
    });

    test('Step 9: should handle IF...ELSE logic with BEGIN...END blocks', () => {
        const sql = `
        IF @Status = 1
        BEGIN
            UPDATE Products SET Price = Price * 1.1 WHERE ID = @ID;
            SELECT 'Price Increased' AS Note;
        END
        ELSE
            PRINT 'No Change';
    `;
        const ast = parse(sql);
        const ifStmt = ast.body[0] as IfNode;

        expect(ifStmt.type).toBe('IfStatement');
        expect(ifStmt.condition).toBe('@Status = 1');

        // Verify BEGIN...END block
        const thenBlock = ifStmt.thenBranch as BlockNode;
        expect(thenBlock.type).toBe('BlockStatement');
        expect(thenBlock.body.length).toBe(2);

        // Verify ELSE branch
        expect(ifStmt.elseBranch).toBeDefined();
    });

    test('Step 10: should handle multiple Common Table Expressions (CTE)', () => {
        const sql = `
        WITH Sales_CTE (SalesPersonID, TotalSales) AS (
            SELECT SalesPersonID, SUM(TotalDue)
            FROM SalesOrderHeader
            GROUP BY SalesPersonID
        ),
        Target_CTE AS (
            SELECT 100000 AS SalesTarget
        )
        SELECT * FROM Sales_CTE
        JOIN Target_CTE ON Sales_CTE.TotalSales > Target_CTE.SalesTarget;
    `;
        const ast = parse(sql);
        const withStmt = ast.body[0] as WithNode;

        expect(withStmt.type).toBe('WithStatement');
        expect(withStmt.ctes.length).toBe(2);
        expect(withStmt.ctes[0].name).toBe('Sales_CTE');
        expect(withStmt.ctes[0].columns).toContain('TotalSales');

        // Verify the main query body
        const mainSelect = withStmt.body as SelectNode;
        expect(mainSelect.from?.table).toBe('Sales_CTE');
    });

    test('Claude Review: should handle IS NULL, NOT IN, and CASE inside Blocks', () => {
        const sql = `
        BEGIN
            SELECT Name FROM Users 
            WHERE DeletedAt IS NOT NULL 
            AND ID NOT IN (1, 2, 3)
            AND Category = CASE WHEN 1=1 THEN 'A' END;
        END
    `;
        const ast = parse(sql);
        const block = ast.body[0] as BlockNode;
        const select = block.body[0] as SelectNode;

        expect(select.where).toContain('DeletedAt IS NOT NULL');
        expect(select.where).toContain('ID NOT IN (1, 2, 3)');
        expect(block.body.length).toBe(1); // Proves CASE END didn't break the block
    });
});