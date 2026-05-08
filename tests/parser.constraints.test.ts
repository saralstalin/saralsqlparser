import {
    parseOne,
    expectSql
} from './parser.helpers';

import { Parser } from '../src/parser/parser';
import { Lexer } from '../src/parser/lexer';

describe('T-SQL Parser - Constraints', () => {
    describe('column constraints', () => {
        test('PRIMARY KEY', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CountryId INT PRIMARY KEY
                )
            `);

            const c = stmt.columns[0];
            const k = c.constraints[0];

            expect(c.name).toBe('CountryId');
            expect(k.kind).toBe('PRIMARY KEY');
            expect(k.columns).toEqual([
                'CountryId'
            ]);
        });

        test('NOT NULL', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    Name VARCHAR(100) NOT NULL
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.kind).toBe('NOT NULL');
        });

        test('DEFAULT literal', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    IsActive BIT DEFAULT 1
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.kind).toBe('DEFAULT');
            expectSql(k.expression, '1');
        });

        test('DEFAULT function', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CreatedAt DATETIME DEFAULT GETDATE()
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.kind).toBe('DEFAULT');
            expectSql(
                k.expression,
                'GETDATE()'
            );
        });

        test('inline FOREIGN KEY REFERENCES', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Department(
                    HeadEmployeeId INT
                        FOREIGN KEY
                        REFERENCES Employee(EmployeeId)
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.kind).toBe('FOREIGN KEY');
            expect(k.columns).toEqual([
                'HeadEmployeeId'
            ]);
            expect(k.referencesTable)
                .toBe('Employee');
            expect(k.referencesColumns)
                .toEqual(['EmployeeId']);
        });

        test('CHECK', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    ISOCode CHAR(2)
                        CHECK (LEN(ISOCode)=2)
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.kind).toBe('CHECK');
            expectSql(
                k.expression,
                'LEN(ISOCode) = 2'
            );
        });
    });

    describe('named constraints', () => {
        test('named DEFAULT', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    IsActive BIT
                        CONSTRAINT DF_Country_IsActive
                        DEFAULT 1
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.name)
                .toBe(
                    'DF_Country_IsActive'
                );

            expect(k.kind).toBe('DEFAULT');
        });

        test('named CHECK', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    Code CHAR(2)
                        CONSTRAINT CHK_Code
                        CHECK (LEN(Code)=2)
                )
            `);

            const k =
                stmt.columns[0].constraints[0];

            expect(k.name)
                .toBe('CHK_Code');

            expect(k.kind).toBe('CHECK');
        });
    });

    describe('table constraints', () => {
        test('PRIMARY KEY', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CountryId INT,
                    CONSTRAINT PK_Country
                    PRIMARY KEY (CountryId)
                )
            `);

            const k =
                stmt.constraints[0];

            expect(k.name)
                .toBe('PK_Country');

            expect(k.kind)
                .toBe('PRIMARY KEY');

            expect(k.columns)
                .toEqual(['CountryId']);
        });

        test('UNIQUE', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    Code CHAR(2),
                    CONSTRAINT UQ_Country_Code
                    UNIQUE (Code)
                )
            `);

            const k =
                stmt.constraints[0];

            expect(k.kind)
                .toBe('UNIQUE');

            expect(k.columns)
                .toEqual(['Code']);
        });

        test('FOREIGN KEY REFERENCES', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Department(
                    HeadEmployeeId INT,
                    CONSTRAINT FK_Department_HeadEmployee
                    FOREIGN KEY (HeadEmployeeId)
                    REFERENCES Employee(EmployeeId)
                )
            `);

            const k =
                stmt.constraints[0];

            expect(k.kind)
                .toBe('FOREIGN KEY');

            expect(k.columns)
                .toEqual([
                    'HeadEmployeeId'
                ]);

            expect(k.referencesTable)
                .toBe('Employee');

            expect(k.referencesColumns)
                .toEqual([
                    'EmployeeId'
                ]);
        });

        test('CHECK', () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    ISOCode CHAR(2),
                    CONSTRAINT CHK_Code
                    CHECK (LEN(ISOCode)=2)
                )
            `);

            const k =
                stmt.constraints[0];

            expect(k.kind)
                .toBe('CHECK');

            expectSql(
                k.expression,
                'LEN(ISOCode) = 2'
            );
        });
    });

    describe('table variables', () => {
        test('DECLARE TABLE with constraints', () => {
            const stmt = parseOne<any>(`
                DECLARE @T TABLE(
                    Id INT PRIMARY KEY,
                    Name VARCHAR(50) NOT NULL,
                    CONSTRAINT UQ_T_Name UNIQUE(Name)
                )
            `);

            const v =
                stmt.variables[0];

            expect(v.dataType)
                .toBe('TABLE');

            expect(v.columns)
                .toHaveLength(2);

            expect(v.constraints)
                .toHaveLength(1);

            expect(
                v.constraints[0].kind
            ).toBe('UNIQUE');
        });
    });

    describe('recoverability', () => {
        test('broken REFERENCES still recovers', () => {
            const stmt = parseOne<any>(`
        CREATE TABLE X(
            Id INT,
            CONSTRAINT FK_X
            FOREIGN KEY (Id)
            REFERENCES
        )
    `);

            expect(
                stmt.constraints[0].incomplete
            ).toBe(true);

            expect(
                stmt.constraints[0].kind
            ).toBe('FOREIGN KEY');
        });

        test('broken CHECK still recovers', () => {
            const stmt = parseOne<any>(`
        CREATE TABLE X(
            Id INT CHECK (
        )
    `);

            expect(
                stmt.columns[0]
                    .constraints[0]
                    .incomplete
            ).toBe(true);

            expect(
                stmt.columns[0]
                    .constraints[0]
                    .kind
            ).toBe('CHECK');
        });

        test('continues after broken table definition', () => {
            const sql = `
                DECLARE @T TABLE(
                    Id INT CHECK (
                ;
                SELECT 1;
            `;

            const parser =
                new Parser(
                    new Lexer(sql)
                );

            const ast = parser.parse().ast;

            expect(ast.body.length)
                .toBeGreaterThanOrEqual(2);

            expect(
                ast.body[1].type
            ).toBe('SelectStatement');
        });
    });
});