import { analyze, getDocumentSymbols } from '../src';

describe('document symbols', () => {
    test('returns create statement symbols with location-bearing children', () => {
        const sql = `
            CREATE PROCEDURE dbo.GetUser
                @Id INT
            AS BEGIN
                SELECT @Id;
            END
        `;

        const result = analyze(sql);
        const symbols = getDocumentSymbols(result.ast);
        const proc = symbols.find(symbol => symbol.name === 'dbo.GetUser');

        expect(proc).toBeDefined();
        expect(proc).toMatchObject({
            name: 'dbo.GetUser',
            kind: 'method',
            detail: 'PROCEDURE'
        });
        expect(proc!.selectionStart).toBe(sql.indexOf('dbo.GetUser'));
        expect(proc!.selectionEnd).toBe(
            sql.indexOf('dbo.GetUser') + 'dbo.GetUser'.length
        );
        expect(proc!.children?.some(child => child.name === '@Id')).toBe(true);
    });

    test('returns CTE and SELECT outline symbols', () => {
        const sql = `
            WITH RecentUsers AS (SELECT Id FROM Users)
            SELECT Id FROM RecentUsers;
        `;

        const symbols = getDocumentSymbols(analyze(sql).ast);

        expect(symbols.map(symbol => symbol.name)).toContain('RecentUsers');
        expect(symbols.map(symbol => symbol.name)).toContain('SELECT');
    });
});
