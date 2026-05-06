import {
    analyze,
    extractDeclarations,
    extractDependencies,
    extractReferences
} from '../src';

describe('AST fact extractors', () => {
    test('extractDeclarations returns schema object declarations with columns and parameters', () => {
        const sql = `
            CREATE TABLE dbo.Users(
                Id INT,
                Name NVARCHAR(100)
            );

            CREATE PROCEDURE dbo.GetUser
                @Id INT
            AS
            BEGIN
                SELECT Id FROM dbo.Users WHERE Id = @Id;
            END
        `;

        const declarations = extractDeclarations(analyze(sql).ast);
        const table = declarations.find(d => d.name === 'dbo.Users');
        const proc = declarations.find(d => d.name === 'dbo.GetUser');

        expect(table).toMatchObject({
            kind: 'table',
            normalizedName: 'dbo.users'
        });
        expect(table?.columns?.map(c => c.name)).toEqual(['Id', 'Name']);

        expect(proc).toMatchObject({
            kind: 'procedure',
            normalizedName: 'dbo.getuser'
        });
        expect(proc?.parameters?.map(p => p.name)).toEqual(['@Id']);
        expect(proc?.nameLocation.start).toBe(sql.indexOf('dbo.GetUser'));
    });

    test('extractReferences returns object references from DML and query sources', () => {
        const sql = `
            INSERT INTO dbo.Audit(Id)
            SELECT u.Id
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `;

        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({
                kind: 'table',
                context: 'insert-target',
                name: 'dbo.Audit',
                normalizedName: 'dbo.audit'
            })
        );
        expect(references).toContainEqual(
            expect.objectContaining({
                kind: 'table',
                context: 'from',
                name: 'dbo.Users',
                normalizedName: 'dbo.users'
            })
        );
        expect(references).toContainEqual(
            expect.objectContaining({
                kind: 'table',
                context: 'join',
                name: 'dbo.Roles',
                normalizedName: 'dbo.roles'
            })
        );
    });

    test('extractDependencies links created objects to referenced objects', () => {
        const sql = `
            CREATE VIEW dbo.ActiveUsers AS
            SELECT u.Id
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `;

        const dependencies = extractDependencies(analyze(sql).ast);

        expect(dependencies).toContainEqual(
            expect.objectContaining({
                from: 'dbo.ActiveUsers',
                to: 'dbo.Users',
                normalizedFrom: 'dbo.activeusers',
                normalizedTo: 'dbo.users',
                context: 'from'
            })
        );
        expect(dependencies).toContainEqual(
            expect.objectContaining({
                from: 'dbo.ActiveUsers',
                to: 'dbo.Roles',
                normalizedFrom: 'dbo.activeusers',
                normalizedTo: 'dbo.roles',
                context: 'join'
            })
        );
    });

    test('extractDependencies ignores local CTE names as external dependencies', () => {
        const sql = `
            WITH UserIds AS (SELECT Id FROM dbo.Users)
            SELECT Id FROM UserIds;
        `;

        const dependencies = extractDependencies(analyze(sql).ast);

        expect(dependencies.map(d => d.normalizedTo)).toContain('dbo.users');
        expect(dependencies.map(d => d.normalizedTo)).not.toContain('userids');
    });
});
