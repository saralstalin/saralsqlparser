import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { ColumnAnalyzer } from '../src/semantic/columnAnalyzer';

const parse = (sql: string) => {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer);
    return parser.parse().ast;
};

describe('ColumnAnalyzer', () => {

    test('resolves simple column', () => {
        const sql = `SELECT Id FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('resolves qualified column', () => {
        const sql = `SELECT u.Id FROM Users u`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        const hasQualified = result.resolutions.some(r =>
            r.location.parts.includes('u')
        );

        expect(hasQualified).toBe(true);
    });

    test('handles multiple columns', () => {
        const sql = `SELECT Id, Name FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(2);
    });

    test('handles binary expressions', () => {
        const sql = `SELECT Id + 1 FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('handles function calls', () => {
        const sql = `SELECT SUM(Id) FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('handles CASE expression', () => {
        const sql = `
            SELECT CASE 
                WHEN Id > 10 THEN Name 
                ELSE 'X' 
            END 
            FROM Users
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(2);
    });

    test('handles IN expression', () => {
        const sql = `SELECT Id FROM Users WHERE Id IN (1, 2, 3)`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('handles BETWEEN expression', () => {
        const sql = `SELECT Id FROM Users WHERE Id BETWEEN 1 AND 10`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('handles GROUP BY', () => {
        const sql = `SELECT Id FROM Users GROUP BY Id`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('handles ORDER BY', () => {
        const sql = `SELECT Id FROM Users ORDER BY Id DESC`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test('handles wildcard safely', () => {
        const sql = `SELECT * FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        // wildcard produces no identifier nodes
        expect(Array.isArray(result.resolutions)).toBe(true);
    });

    test('handles subquery safely', () => {
        const sql = `
            SELECT Id 
            FROM (
                SELECT Id FROM Users
            ) t
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(Array.isArray(result.resolutions)).toBe(true);
    });

    test('does not crash on broken SQL', () => {
        const sql = `SELECT FROM`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(Array.isArray(result.resolutions)).toBe(true);
    });

    test('marks correlated resolution in APPLY subquery expression', () => {
        const sql = `
            SELECT a.SomeName
            FROM Employee e
            CROSS APPLY (
                SELECT e.FirstName AS SomeName
            ) a
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.some(r =>
            r.location.name === 'a.SomeName' &&
            r.isCorrelated
        )).toBe(true);
    });

    test('emits ambiguity candidates for bare columns', () => {
        const sql = `
            SELECT Id
            FROM Employee e
            JOIN Department d ON d.Id = e.DepartmentId
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);
        const idResolution = result.resolutions.find(r => r.location.name === 'Id');

        expect(idResolution?.ambiguityCandidates?.length).toBeGreaterThan(1);
    });

    test('keeps qualified alias resolution scoped per statement', () => {
        const sql = `
            SELECT t.DepartmentId
            INTO #t
            FROM TempDepartment t;

            SELECT e.DepartmentId
            FROM DepartmentSalaryInfo e;
        `;
        const ast = parse(sql);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        const eResolution = result.resolutions.find(r => r.location.name === 'e.DepartmentId');
        expect(eResolution).toBeDefined();
        expect(eResolution?.inputs[0]?.source).toBe('DepartmentSalaryInfo');
    });

    test('emits resolved OUTPUT inserted/deleted qualified lineage inputs', () => {
        const sql = `
            UPDATE Users
            SET Name = 'John'
            OUTPUT inserted.Name, deleted.Name
            WHERE Id = 1;
        `;
        const ast = parse(sql);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        const hasInserted = result.resolutions.some(r =>
            r.inputs.some(i => i.name === 'INSERTED.Name' && i.resolution === 'resolved')
        );
        const hasDeleted = result.resolutions.some(r =>
            r.inputs.some(i => i.name === 'DELETED.Name' && i.resolution === 'resolved')
        );

        expect(hasInserted).toBe(true);
        expect(hasDeleted).toBe(true);
    });

});
