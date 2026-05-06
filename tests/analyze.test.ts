import { analyze, DiagnosticCode } from '../src';

describe('analyze facade', () => {
    test('returns parser, semantic, lineage, and column analysis results', () => {
        const result = analyze(`
            DECLARE @Id INT = 1;
            SELECT Id FROM Users WHERE Id = @Ghost;
        `);

        expect(result.ast.type).toBe('Program');
        expect(result.ast.start).toBeGreaterThanOrEqual(0);
        expect(result.ast.end).toBeGreaterThan(result.ast.start);
        expect(result.ast.body.length).toBeGreaterThan(0);

        expect(Array.isArray(result.issues)).toBe(true);
        expect(result.scope.root).toBeDefined();
        expect(result.lineage.columns).toBeDefined();
        expect(result.lineage.edges).toBeDefined();
        expect(result.columns.resolutions).toBeDefined();

        expect(result.diagnostics.map(d => d.code)).toContain(
            DiagnosticCode.UndeclaredVariable
        );
        expect(result.semanticDiagnostics.map(d => d.code)).toContain(
            DiagnosticCode.UndeclaredVariable
        );
    });

    test('combines parse issues and semantic diagnostics into one sorted stream', () => {
        const result = analyze(`
            SELECT CASE WHEN;
            SELECT @Ghost;
        `);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.semanticDiagnostics.length).toBeGreaterThan(0);

        expect(result.diagnostics.map(d => d.source)).toContain('parser');
        expect(result.diagnostics.map(d => d.source)).toContain('semantic');

        const offsets = result.diagnostics.map(d => d.start);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    });
});
