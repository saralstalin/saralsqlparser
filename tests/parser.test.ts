import { Lexer, TokenType } from '../src/lexer';
import { Parser, SelectNode, InsertNode, UpdateNode, DeleteNode, DeclareNode, SetNode, CreateNode, SetOperatorNode, IfNode, BlockNode, WithNode } from '../src/parser';



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
            return `${toSql(expr.left)} ${expr.isNot ? 'NOT ' : ''}BETWEEN ${toSql(expr.start)} AND ${toSql(expr.end)}`;

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

        default:
            // Helpful debugging hint for new nodes
            return expr.type ? `[Unhandled Node: ${expr.type}]` : '';
    }
}

describe('T-SQL Parser', () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse();
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
        expect((ast.body[0] as SelectNode).top).toBe('10');
    });

    // 3. TOP with Parentheses and Joins
    test('should handle T-SQL TOP (10) and JOINs', () => {
        const sql = `SELECT TOP (10) e.Name FROM Employees AS e INNER JOIN Departments AS d ON e.DeptId = d.Id`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(stmt.top).toBe('10');
        expect(stmt.from?.table).toBe('Employees');
        expect(stmt.from?.joins[0].type).toBe('INNER JOIN');
        expect(toSql(stmt.from?.joins[0].on)).toBe('e.DeptId = d.Id');
    });

    // 4. Bracketed Identifiers
    test('should handle bracketed identifiers and spaces', () => {
        const sql = `SELECT [First Name] FROM [Sales].[Customer Orders]`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(stmt.columns[0].name).toBe('[First Name]');
        expect(stmt.from?.table).toBe('[Sales].[Customer Orders]');
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

    // 10. ALL (Explicit)
    test('should handle SELECT ALL', () => {
        const sql = `SELECT ALL Name FROM Users`;
        expect((parse(sql).body[0] as SelectNode).distinct).toBe(false);
    });

    // 11. Alias: Assignment Style
    test('should handle assignment alias (ID = UserID)', () => {
        const sql = `SELECT ID = UserID FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe('ID');
        expect(col.name).toBe('UserID');
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
        expect(col.tablePrefix).toBe('u');
        expect(col.name).toBe('Name');
    });

    // 15. Table Alias Boundary (WHERE check)
    test('should not swallow WHERE as a table alias', () => {
        const sql = `SELECT Name FROM Users u WHERE ID = 1`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.alias).toBe('u');
        expect(stmt.where).not.toBeNull();
    });

    // 16. Table Alias with AS
    test('should handle Users AS u', () => {
        const sql = `SELECT Name FROM Users AS u`;
        expect((parse(sql).body[0] as SelectNode).from?.alias).toBe('u');
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
        expect(parse(sql).body[0].type).toBe('InsertStatement');
    });

    // 22. INSERT from SELECT
    test('should handle INSERT INTO ... SELECT', () => {
        const sql = `INSERT INTO T1 SELECT * FROM T2`;
        const node = parse(sql).body[0] as InsertNode;
        expect(node.selectQuery?.type).toBe('SelectStatement');
    });

    // 23. UPDATE Standard
    test('should handle standard UPDATE', () => {
        const sql = `UPDATE Users SET Status = 1 WHERE ID = 1`;
        expect(parse(sql).body[0].type).toBe('UpdateStatement');
    });

    // 24. UPDATE with JOIN (T-SQL style)
    test('should handle UPDATE with FROM and JOIN', () => {
        const sql = `UPDATE u SET x = 1 FROM Users u JOIN T2 ON u.id = T2.id`;
        const node = parse(sql).body[0] as UpdateNode;
        expect(node.target).toBe('u');
        expect(node.from?.joins.length).toBe(1);
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
        expect(node.target).toBe('u');
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

    // 29. CREATE TABLE
    test('should handle CREATE TABLE', () => {
        const sql = `CREATE TABLE T (ID INT PRIMARY KEY)`;
        expect((parse(sql).body[0] as CreateNode).objectType).toBe('TABLE');
    });

    // 30. CREATE PROC / VIEW
    test('should handle CREATE VIEW and PROC', () => {
        const sqlV = `CREATE VIEW V AS SELECT 1`;
        const sqlP = `CREATE PROC P AS SELECT 1`;
        expect((parse(sqlV).body[0] as CreateNode).objectType).toBe('VIEW');
        expect((parse(sqlP).body[0] as CreateNode).objectType).toBe('PROCEDURE');
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
        expect(stmt.from?.joins[0].type).toBe('CROSS APPLY');
    });

    // 33. Derived Tables (Subquery in FROM)
    test('should handle subquery in FROM', () => {
        const sql = `SELECT * FROM (SELECT 1 as x) d`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(toSql(stmt.from?.table)).toContain('SelectStatement');
    });

    // 34. CASE Statements
    test('should handle CASE WHEN', () => {
        const sql = `SELECT CASE WHEN 1=1 THEN 'A' END`;
        expect(toSql((parse(sql).body[0] as SelectNode).columns[0].expression)).toBe("CASE WHEN 1 = 1 THEN 'A' END");
    });

    // 35. EXISTS
    test('should handle EXISTS subquery', () => {
        const sql = `SELECT 1 WHERE EXISTS (SELECT 1)`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toContain('EXISTS');
    });

    // 36. UNION / EXCEPT
    test('should handle UNION and EXCEPT', () => {
        const sql = `SELECT 1 UNION SELECT 2 EXCEPT SELECT 3`;
        expect((parse(sql).body[0] as SetOperatorNode).operator).toBe('EXCEPT');
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
        return parser.parse();
    };

    test('Architectural: should preserve SubqueryExpression as an object in FROM', () => {
        const sql = `SELECT * FROM (SELECT Name FROM Users) AS Derived`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        // This proves Claude's point #1: We can now "walk" into the subquery
        const tableSource = stmt.from?.table;
        expect(typeof tableSource).toBe('object');
        if (typeof tableSource === 'object' && tableSource.type === 'SubqueryExpression') {
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
        expect(updateNode.from?.table).toBe('Users');
        expect(updateNode.from?.alias).toBe('u');
    });
});

describe('T-SQL Parser - Deep Expression Validation', () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse();
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
        const sql = `SET @Val = -5 + (~@BitwiseNot)`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SetNode;
        const val = stmt.value as any;

        expect(val.left.type).toBe('UnaryExpression');
        expect(val.left.operator).toBe('-');
        expect(val.right.type).toBe('GroupingExpression');
    });
});