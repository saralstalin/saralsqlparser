import { parseResult } from './parser.helpers';

// Source: Microsoft SQL Server Samples (MIT)
// https://github.com/microsoft/sql-server-samples/tree/master/samples/features/temporal/product-catalog
// https://github.com/microsoft/sql-server-samples/tree/master/samples/features/json
//
// This is a characterization corpus for currently unsupported complex syntax.
// It should keep parsing stable and make the gaps explicit.
const microsoftComplexCorpus = `
create function dbo.diff_Product (@id int, @date datetime2(0))
returns table
as
return (
    select v1.[key] as [Column], v1.value as v1, v2.value as v2
    from OPENJSON(
            (select * from Product where ProductID = @id FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)) v1
        join OPENJSON(
            (select * from Product for system_time as of @date where ProductID = @id FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)) v2
        on v1.[key] = v2.[key]
    where v1.value <> v2.value
)
GO

create procedure dbo.GetProductsAsOf (@date datetime2) as
begin
    select * from Product FOR SYSTEM_TIME AS OF @date
        outer apply dbo.diff_Product(Product.ProductID, @date) as ProductDifferences
    order by Product.ProductID asc
    FOR JSON AUTO, ROOT('data')
end
GO

DECLARE @products NVARCHAR(MAX) = N'[{"ProductID":15,"Name":"Adjustable Race","Color":"Magenta","Size":"62","Price":100.0000,"Quantity":75,"ValidFrom":"2016-02-11T21:27:32","ValidTo":"9999-12-31T23:59:59"}]';
INSERT INTO Product(ProductID, Name, Color, Size, Price, Quantity, ValidFrom, ValidTo)
SELECT ProductID, Name, Color, Size, Price, Quantity, ValidFrom, ValidTo
FROM OPENJSON (@products) WITH(
    ProductID int,
    Name nvarchar(50),
    Color nvarchar(15),
    Size nvarchar(5),
    Price money,
    Quantity int,
    ValidFrom datetime2(0),
    ValidTo datetime2(0)
)
`;

describe('Microsoft complex T-SQL corpus characterization', () => {
    test('parses without throwing and keeps known gaps visible', () => {
        expect(() => parseResult(microsoftComplexCorpus)).not.toThrow();

        const result = parseResult(microsoftComplexCorpus);
        const messages = (result.issues ?? []).map(issue => issue.message);
        const types = result.ast.body.map(stmt => stmt.type);

        expect(types).toContain('CreateStatement');
        expect(types).toContain('InsertStatement');

        expect(messages).toContain('Unexpected token: returns');
        expect(messages).toContain('Expected JSON or XML after FOR');
        expect(messages).toContain('Unexpected token: SYSTEM_TIME');
        expect(messages).toContain('Expected CloseParen but found WHERE at line 10');
    });
});
