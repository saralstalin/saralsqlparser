import { getCompletionContext, getCompletionsAt } from '../src';

describe('completion helpers', () => {
    test('returns visible symbols for the current offset', () => {
        const sql = 'DECLARE @CustomerId INT; SELECT @C';
        const offset = sql.length;

        const context = getCompletionContext(sql, offset);

        expect(context.prefix).toBe('@C');
        expect(context.visibleSymbols.map(symbol => symbol.name)).toContain(
            '@CustomerId'
        );
    });

    test('returns symbol completions matching the current prefix', () => {
        const sql = 'DECLARE @CustomerId INT; SELECT @C';
        const completions = getCompletionsAt(sql, sql.length);

        expect(completions).toContainEqual(
            expect.objectContaining({
                label: '@CustomerId',
                kind: 'variable'
            })
        );
    });

    test('returns keyword completions matching the current prefix', () => {
        const sql = 'SEL';
        const completions = getCompletionsAt(sql, sql.length);

        expect(completions).toContainEqual(
            expect.objectContaining({
                label: 'SELECT',
                kind: 'keyword',
                start: 0,
                end: 3
            })
        );
    });
});
