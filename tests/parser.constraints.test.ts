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

describe('IDENTITY constraints', () => {
    test('IDENTITY before PRIMARY KEY', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT IDENTITY(1,1) PRIMARY KEY
            )
        `);

        const constraints =
            stmt.columns[0].constraints;

        expect(constraints)
            .toHaveLength(2);

        expect(
            constraints[0].kind
        ).toBe('IDENTITY');

        expect(
            constraints[0].seed
        ).toBe(1);

        expect(
            constraints[0].increment
        ).toBe(1);

        expect(
            constraints[1].kind
        ).toBe('PRIMARY KEY');
    });

    test('PRIMARY KEY before IDENTITY', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT PRIMARY KEY IDENTITY(1,1)
            )
        `);

        const constraints =
            stmt.columns[0].constraints;

        expect(constraints)
            .toHaveLength(2);

        expect(
            constraints[0].kind
        ).toBe('PRIMARY KEY');

        expect(
            constraints[1].kind
        ).toBe('IDENTITY');

        expect(
            constraints[1].seed
        ).toBe(1);

        expect(
            constraints[1].increment
        ).toBe(1);
    });

    test('IDENTITY without explicit seed/increment', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT IDENTITY PRIMARY KEY
            )
        `);

        const identity =
            stmt.columns[0]
                .constraints
                .find(
                    (x: any) =>
                        x.kind ===
                        'IDENTITY'
                );

        expect(identity)
            .toBeDefined();

        expect(identity.seed)
            .toBeUndefined();

        expect(identity.increment)
            .toBeUndefined();
    });
});

describe('unnamed table constraints', () => {
    test('unnamed PRIMARY KEY composite', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE PatentAssignment(
                PatentId INT NOT NULL,
                EmployeeId INT NOT NULL,
                PRIMARY KEY (
                    PatentId,
                    EmployeeId
                )
            )
        `);

        expect(stmt.constraints)
            .toHaveLength(1);

        const pk =
            stmt.constraints[0];

        expect(pk.kind)
            .toBe('PRIMARY KEY');

        expect(pk.columns)
            .toEqual([
                'PatentId',
                'EmployeeId'
            ]);
    });

    test('unnamed FOREIGN KEY', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE SalaryCreditLog(
                EmployeeId INT,
                FOREIGN KEY (EmployeeId)
                REFERENCES Employee(EmployeeId)
            )
        `);

        expect(stmt.constraints)
            .toHaveLength(1);

        const fk =
            stmt.constraints[0];

        expect(fk.kind)
            .toBe('FOREIGN KEY');

        expect(fk.columns)
            .toEqual([
                'EmployeeId'
            ]);

        expect(
            fk.referencesTable
        ).toBe('Employee');

        expect(
            fk.referencesColumns
        ).toEqual([
            'EmployeeId'
        ]);
    });

    test('multiple unnamed table constraints', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                A INT,
                B INT,
                PRIMARY KEY (A,B),
                FOREIGN KEY (B)
                REFERENCES Y(Id)
            )
        `);

        expect(stmt.constraints)
            .toHaveLength(2);

        expect(
            stmt.constraints[0].kind
        ).toBe('PRIMARY KEY');

        expect(
            stmt.constraints[1].kind
        ).toBe('FOREIGN KEY');
    });
});

describe('real-world DDL', () => {
    test('SalaryCreditLog', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE SalaryCreditLog (
                LogId INT PRIMARY KEY IDENTITY(1,1),
                EmployeeId INT,
                CreditDate DATE,
                Amount DECIMAL(10,2),
                FOREIGN KEY (EmployeeId)
                    REFERENCES Employee(EmployeeId)
            )
        `);

        expect(stmt.columns)
            .toHaveLength(4);

        expect(
            stmt.columns[0]
                .constraints
                .map((x: any) => x.kind)
        ).toEqual([
            'PRIMARY KEY',
            'IDENTITY'
        ]);

        expect(stmt.constraints)
            .toHaveLength(1);

        expect(
            stmt.constraints[0].kind
        ).toBe('FOREIGN KEY');
    });

    test('PatentAssignment composite PK', () => {
        const stmt = parseOne<any>(`
            CREATE TABLE PatentAssignment(
                PatentId INT NOT NULL,
                EmployeeId INT NOT NULL,
                Status VARCHAR(20)
                    DEFAULT 'Active',
                PRIMARY KEY (
                    PatentId,
                    EmployeeId
                ),
                FOREIGN KEY (PatentId)
                    REFERENCES Patent(PatentId),
                FOREIGN KEY (EmployeeId)
                    REFERENCES Employee(EmployeeId)
            )
        `);

        expect(stmt.constraints)
            .toHaveLength(3);

        expect(
            stmt.constraints[0].kind
        ).toBe('PRIMARY KEY');

        expect(
            stmt.constraints[1].kind
        ).toBe('FOREIGN KEY');

        expect(
            stmt.constraints[2].kind
        ).toBe('FOREIGN KEY');
    });
});