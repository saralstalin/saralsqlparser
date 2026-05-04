import { Parser, Lexer } from '../src';
import { LineageBuilder } from '../src/lineageBuilder';

function lineage(sql: string) {
    const parser = new Parser(new Lexer(sql));
    const ast = parser.parse().ast;

    return new LineageBuilder().build(ast);
}

function edgeStrings(sql: string): string[] {
    return lineage(sql)
        .edges
        .map(e => `${e.from.name} -> ${e.to.name}`)
        .sort();
}

describe('LineageBuilder', () => {
    test('simple direct column', () => {
        expect(
            edgeStrings(`SELECT Id FROM Orders`)
        ).toEqual([
            'Id -> Id'
        ]);
    });

    test('qualified column', () => {
        expect(
            edgeStrings(`SELECT o.Id FROM Orders o`)
        ).toEqual([
            'Orders.Id -> Id'
        ]);
    });

    test('alias output', () => {
        expect(
            edgeStrings(`
                SELECT o.Id AS OrderId
                FROM Orders o
            `)
        ).toEqual([
            'Orders.Id -> OrderId'
        ]);
    });

    test('computed expression', () => {
        expect(
            edgeStrings(`
                SELECT o.Amount * 1.1 AS Gross
                FROM Orders o
            `)
        ).toEqual([
            'Orders.Amount -> Gross'
        ]);
    });

    test('function call', () => {
        expect(
            edgeStrings(`
                SELECT SUM(o.Amount) AS Total
                FROM Orders o
            `)
        ).toEqual([
            'Orders.Amount -> Total'
        ]);
    });

    test('multiple dependencies', () => {
        expect(
            edgeStrings(`
                SELECT o.Price * o.Qty AS Total
                FROM Orders o
            `)
        ).toEqual([
            'Orders.Price -> Total',
            'Orders.Qty -> Total'
        ]);
    });

    test('join lineage', () => {
        expect(
            edgeStrings(`
                SELECT c.Name
                FROM Orders o
                JOIN Customer c ON o.CustomerId = c.Id
            `)
        ).toEqual([
            'Customer.Name -> Name'
        ]);
    });

    test('wildcard', () => {
        expect(
            edgeStrings(`
                SELECT o.*
                FROM Orders o
            `)
        ).toEqual([
            'Orders.* -> *'
        ]);
    });

    test('cte flattening', () => {
        expect(
            edgeStrings(`
                WITH X AS (
                    SELECT o.Amount
                    FROM Orders o
                )
                SELECT X.Amount
                FROM X
            `)
        ).toEqual([
            'Orders.Amount -> Amount'
        ]);
    });

    test('subquery flattening', () => {
        expect(
            edgeStrings(`
                SELECT s.Amount
                FROM (
                    SELECT o.Amount
                    FROM Orders o
                ) s
            `)
        ).toEqual([
            'Orders.Amount -> Amount'
        ]);
    });

    test('case expression', () => {
        expect(
            edgeStrings(`
            SELECT
                CASE
                    WHEN o.Amount > 100 THEN o.Amount
                    ELSE o.Discount
                END AS FinalAmount
            FROM Orders o
        `)
        ).toEqual([
            'Orders.Amount -> FinalAmount',
            'Orders.Discount -> FinalAmount'
        ]);
    });

    test('where clause should not affect output lineage', () => {
        expect(
            edgeStrings(`
                SELECT o.Amount
                FROM Orders o
                WHERE o.Status = 'Paid'
            `)
        ).toEqual([
            'Orders.Amount -> Amount'
        ]);
    });

    test('insert select mapping', () => {
        expect(
            edgeStrings(`
                INSERT INTO Audit(Id, Amount)
                SELECT o.Id, o.Amount
                FROM Orders o
            `)
        ).toEqual([
            'Orders.Amount -> Audit.Amount',
            'Orders.Id -> Audit.Id'
        ]);
    });

    test('update assignment lineage', () => {
        expect(
            edgeStrings(`
                UPDATE t
                SET Total = c.Amount
                FROM Target t
                JOIN Customer c ON t.CustomerId = c.Id
            `)
        ).toEqual([
            'Customer.Amount -> t.Total'
        ]);
    });

    test('nested cte chain', () => {
        expect(
            edgeStrings(`
                WITH A AS (
                    SELECT Id FROM Orders
                ),
                B AS (
                    SELECT A.Id FROM A
                )
                SELECT B.Id FROM B
            `)
        ).toEqual([
            'Id -> Id'
        ]);
    });

    test('select star from single table', () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Users
        `)
        ).toEqual([
            'Users.* -> *'
        ]);
    });

    test('select star from aliased table', () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Users u
        `)
        ).toEqual([
            'Users.* -> *'
        ]);
    });

    test('qualified wildcard', () => {
        expect(
            edgeStrings(`
            SELECT u.*
            FROM Users u
        `)
        ).toEqual([
            'Users.* -> *'
        ]);
    });

    test('star across join', () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Orders o
            JOIN Customer c
                ON o.CustomerId = c.Id
        `)
        ).toEqual([
            'Customer.* -> *',
            'Orders.* -> *'
        ]);
    });

    test('qualified wildcard in join', () => {
        expect(
            edgeStrings(`
            SELECT o.*
            FROM Orders o
            JOIN Customer c
                ON o.CustomerId = c.Id
        `)
        ).toEqual([
            'Orders.* -> *'
        ]);
    });

    test('cte wildcard flattening', () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT *
                FROM Orders
            )
            SELECT *
            FROM X
        `)
        ).toEqual([
            'Orders.* -> *'
        ]);
    });

    test('subquery wildcard flattening', () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM (
                SELECT *
                FROM Orders
            ) s
        `)
        ).toEqual([
            'Orders.* -> *'
        ]);
    });

    test('cte alias column flattening', () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT Amount AS Total
                FROM Orders
            )
            SELECT X.Total
            FROM X
        `)
        ).toEqual([
            'Amount -> Total'
        ]);
    });

    test('nested alias flattening', () => {
        expect(
            edgeStrings(`
            WITH A AS (
                SELECT Id AS OrderId
                FROM Orders
            ),
            B AS (
                SELECT A.OrderId AS FinalId
                FROM A
            )
            SELECT B.FinalId
            FROM B
        `)
        ).toEqual([
            'Id -> FinalId'
        ]);
    });

    test('insert select wildcard lineage', () => {
        expect(
            edgeStrings(`
            INSERT INTO Audit(Id)
            SELECT *
            FROM Orders
        `)
        ).toEqual([
            'Orders.* -> Audit.Id'
        ]);
    });

    test('update computed assignment lineage', () => {
        expect(
            edgeStrings(`
            UPDATE t
            SET Total = c.Amount + c.Tax
            FROM Target t
            JOIN Charges c
                ON c.Id = t.Id
        `)
        ).toEqual([
            'Charges.Amount -> t.Total',
            'Charges.Tax -> t.Total'
        ]);
    });

    test('case dedupes repeated dependency', () => {
        expect(
            edgeStrings(`
            SELECT
                CASE
                    WHEN Amount > 100 THEN Amount
                    ELSE Amount
                END AS FinalAmount
            FROM Orders
        `)
        ).toEqual([
            'Amount -> FinalAmount'
        ]);
    });

});