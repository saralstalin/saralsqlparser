# @saralsql/tsql-parser

High-fidelity parser and semantic analysis engine for Microsoft SQL Server T-SQL.

## Purpose

SaralSQL is a T-SQL parser for editor and analysis tooling. It is built for real SQL Server workflows such as stored procedures, mixed DDL and DML batches, temp tables, table variables, and incomplete SQL being edited live. On top of parsing, it provides the semantic layers needed for diagnostics, lineage, symbols, and related developer tooling features.

It is optimized for:

- SQL Server grammar fidelity
- fault-tolerant parsing
- semantic enrichment on top of a single parse

## Non-goals

SaralSQL is a single-document analysis engine.

It does not currently provide:

- workspace-wide schema catalogs
- cross-file symbol resolution
- metadata-backed wildcard expansion
- full database-aware type validation

Those belong in the host LSP or analysis service.

## Installation

```bash
npm install @saralsql/tsql-parser
```

## Primary API

Use `analyze(sql)` if you want the full parser + semantic pipeline in one call.

```ts
import { analyze } from '@saralsql/tsql-parser';

const result = analyze(`
SELECT Id, Name
FROM Users
WHERE Id = @Id;
`);
```

Use the lower-level APIs only when you need custom control over lexing, parsing, scope building, lineage, or diagnostics.

```ts
import {
  Lexer,
  Parser,
  analyze,
  diagnose,
  getCompletionContext,
  getCompletionsAt,
  getDocumentSymbols,
  ScopeBuilder,
  LineageBuilder,
  ColumnAnalyzer,
  extractDeclarations,
  extractDependencies,
  extractReferences
} from '@saralsql/tsql-parser';
```

## Analyze Result

`analyze(sql)` returns:

| Field | Description |
| --- | --- |
| `ast` | Parsed AST |
| `issues` | Recoverable parser issues |
| `scope` | Scope graph |
| `semanticDiagnostics` | Semantic diagnostics |
| `diagnostics` | Combined diagnostics |
| `lineage` | Column lineage |
| `columns` | Column resolution analysis |

### AST Shape (abridged, representative)

SQL:

```sql
SELECT o.Id, o.Amount
FROM dbo.Orders o
WHERE o.Status = 'Paid'
```

AST excerpt:

```ts
{
  type: 'SelectStatement',
  distinct: false,
  top: null,
  columns: [
    {
      type: 'Column',
      expression: { type: 'Identifier', name: 'o.Id', parts: ['o', 'Id'] },
      sourceName: 'Id',
      outputName: 'Id',
      wildcard: false
    },
    {
      type: 'Column',
      expression: { type: 'Identifier', name: 'o.Amount', parts: ['o', 'Amount'] },
      sourceName: 'Amount',
      outputName: 'Amount',
      wildcard: false
    }
  ],
  into: null,
  from: [
    {
      type: 'TableReference',
      table: { type: 'Identifier', name: 'dbo.Orders', parts: ['dbo', 'Orders'] },
      alias: 'o',
      joins: []
    }
  ],
  where: {
    type: 'BinaryExpression',
    left: { type: 'Identifier', name: 'o.Status', parts: ['o', 'Status'] },
    operator: '=',
    right: { type: 'Literal', value: 'Paid', variant: 'string' }
  },
  groupBy: null,
  having: null,
  orderBy: null
}
```

## Behavioral Examples

### Diagnostics

SQL:

```sql
UPDATE u
SET u.Name = 'Bad Update'
FROM Users u WITH(NOLOCK)
WHERE u.Id = u.Id
```

Diagnostics:

```json
[
  {
    "code": "DML004",
    "severity": "error",
    "message": "UPDATE target table must not use WITH (NOLOCK)"
  },
  {
    "code": "LOG001",
    "severity": "warning",
    "message": "Condition compares 'u.Id' to itself"
  }
]
```

### Column Lineage

SQL:

```sql
INSERT INTO dbo.InvoiceSummary (CustomerId, InvoiceMonth, TotalAmount)
SELECT i.CustomerId,
       i.InvoiceMonth,
       i.Subtotal + i.TaxAmount
FROM dbo.Invoices i;
```

Lineage:

```json
[
  {
    "source": "dbo.Invoices.CustomerId",
    "target": "dbo.InvoiceSummary.CustomerId"
  },
  {
    "source": "dbo.Invoices.InvoiceMonth",
    "target": "dbo.InvoiceSummary.InvoiceMonth"
  },
  {
    "source": "dbo.Invoices.Subtotal",
    "target": "dbo.InvoiceSummary.TotalAmount"
  },
  {
    "source": "dbo.Invoices.TaxAmount",
    "target": "dbo.InvoiceSummary.TotalAmount"
  }
]
```

## Supported Surface

### Query grammar

Supported:

- `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`
- joins and `APPLY`
- subqueries and scalar subqueries
- CTEs
- `UNION`, `INTERSECT`, `EXCEPT`
- `GROUP BY`, `HAVING`, `ORDER BY`
- `OFFSET / FETCH`
- window functions and frame clauses
- `PIVOT`, `UNPIVOT`
- `OPENJSON ... WITH (...)`
- `FOR JSON`, `FOR XML`
- `OPTION (...)`
- `STRING_AGG ... WITHIN GROUP (...)`
- aggregate `DISTINCT` forms such as `COUNT(DISTINCT ...)` and `SUM(DISTINCT ...)`

### Procedural T-SQL

Supported:

- `DECLARE`, `SET`, `PRINT`, `RETURN`
- `RAISERROR`, `THROW`
- `EXEC / EXECUTE`
- `IF / ELSE`
- `BEGIN / END`
- `BEGIN TRY / END TRY / BEGIN CATCH / END CATCH`
- `WHILE`, `BREAK`, `CONTINUE`
- `GOTO` and labels
- `WAITFOR TIME / DELAY`
- cursor statements
- transaction statements
- stored procedure parameters
- readonly TVPs
- temp tables and table variables

### Expressions

Supported:

- arithmetic and boolean logic
- `CASE`
- `EXISTS`
- `IN`, `BETWEEN`, `LIKE`
- `CAST`, `TRY_CAST`, `CONVERT`
- function calls
- `IIF`
- null handling
- old-style string literal aliases in projections

### DDL and maintenance scripts

Supported:

- `CREATE TABLE`
- `ALTER TABLE` (partial)
- `CREATE PROCEDURE`
- `CREATE FUNCTION` (partial)
- `CREATE VIEW`
- `CREATE TYPE ... AS TABLE`
- `CREATE TRIGGER`
- `CREATE INDEX`
- `ALTER INDEX`
- `UPDATE STATISTICS`
- `DROP TABLE / VIEW / PROCEDURE / FUNCTION / INDEX`

Also supported:

- computed columns
- computed columns with optional `PERSISTED`
- primary key, foreign key, unique, check, default, null/not-null, identity constraints
- clustered and nonclustered index forms
- include columns
- filtered indexes
- index `WITH (...)` options
- tolerant create preambles such as:
  - `WITH EXECUTE AS ...`
  - `WITH SCHEMABINDING`
  - `WITH ENCRYPTION`
  - function `RETURNS ...`

## Semantic Layers

Supported:

- variable scope
- parameter scope
- alias scope
- temp table scope
- table variable scope
- CTE scope
- `PIVOT` / `UNPIVOT` output-column scope
- declaration extraction
- dependency extraction
- document symbols
- completions
- diagnostics
- lineage extraction

## Current Diagnostics

Focuses on high-signal, actionable issues suitable for editors and code review:

- Variables & Parameters: undeclared variables, unused variables, unused parameters
- DML Safety: `SELECT *`, self-comparisons such as `u.Id = u.Id`, `UPDATE` / `DELETE` without filters, `UPDATE` target with `WITH (NOLOCK)`
- DDL: unbracketed keyword-like identifiers, missing commas before table constraints
- Hints & Options: guidance on table hints and `OPTION(...)` usage

Diagnostics are intentionally selective. The goal is to stay useful in enterprise SQL without overwhelming the user with low-value warnings.

## Fault Tolerance

SaralSQL is designed to return useful output for incomplete SQL.

Example:

```sql
SELECT *
FROM Users
WHERE
```

Expected behavior:

- partial AST
- recoverable parser issue
- usable completion context
- usable scope and lineage when possible

This is a core design requirement for editor scenarios.

## Current Maturity

SaralSQL is hardened around real production-style SQL Server code, including:

- stored procedure-heavy codebases
- validation and ETL procedures
- temp-table-heavy workflows
- TVP-driven `INSERT ... SELECT` patterns
- recursive CTEs
- cursor lifecycle statements
- `MERGE` variants
- `DELETE TOP (...) ... OUTPUT`
- `OPENJSON ... WITH (...)`
- `STRING_AGG ... WITHIN GROUP (...)`
- aggregate `DISTINCT` forms
- `BEGIN ;WITH ...` handoff inside blocks
- `SET DATEFIRST` followed by additional statements
- tolerant procedure/view/function/trigger headers

Milestone:

- first enterprise stored procedure codebase pass completed

## Known Limitations

SaralSQL is already useful, but it is not complete SQL Server grammar coverage.

Current known gaps or partial areas include:

- advanced transaction grammar edge cases
- dynamic `EXEC` edge cases
- partition grammar
- advanced index/storage options
- indexed views
- `OPENQUERY` / `OPENROWSET` family
- deeper XML grammar
- JSON edge cases beyond current `OPENJSON` support
- metadata-aware validation across files

## Architecture

```text
Lexer -> Parser -> ScopeBuilder -> LineageBuilder -> ColumnAnalyzer -> DiagnosticEngine
```

Design principle:

```text
Parse once
Enrich in layers
Reuse semantic graph
Avoid duplicate logic
```

## Roadmap

Near term:

- broader corpus validation
- richer diagnostics
- auto-fix scaffolding

Medium term:

- schema-aware resolution
- metadata catalogs
- wildcard expansion
- FK-aware navigation
- standards enforcement packs

Long term:

- semantic autocomplete
- rename symbol
- find references
- impact analysis
- safe refactors
- AI-assisted SQL correction

## Contributing

The most useful bug reports include:

- SQL sample
- expected behavior
- current parser or diagnostic output

## License

MIT

Built by Saral Simon Stalin
