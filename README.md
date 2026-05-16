# @saralsql/tsql-parser

High-fidelity parser and semantic analysis engine for **Microsoft SQL Server T-SQL**.

SaralSQL is built specifically for **real-world T-SQL**, with an editor-first architecture that favors:

* correctness for SQL Server grammar
* fault-tolerant parsing
* semantic enrichment
* static analysis
* lineage
* LSP/editor integrations

This package is designed as a **single-document parsing and analysis engine**. Workspace-wide schema catalogs, metadata stores, and cross-project symbol indexing belong in the host LSP/server layer.

---

# Why This Exists

Most SQL parsers are:

* generic across many dialects
* weak on procedural SQL
* brittle on incomplete SQL
* not designed for editor workflows

SaralSQL is purpose-built for **T-SQL authoring scenarios**, including:

* stored procedures
* ad hoc query files
* mixed DDL + DML batches
* temp tables
* table variables
* variables + parameters
* CTE-heavy SQL
* procedural blocks
* error handling blocks
* index-heavy schema definitions
* broken / partially typed SQL inside editors

It is intended as the foundation for:

* language servers
* editor integrations
* diagnostics
* autocomplete
* symbol navigation
* refactoring
* dependency analysis
* lineage
* performance diagnostics
* standards enforcement
* auto-fixes / rewrites

---

# Installation

```bash
npm install @saralsql/tsql-parser
```

---

# Quick Start

```ts
import {
  analyze
} from '@saralsql/tsql-parser';

const sql = `
SELECT Id, Name
FROM Users
WHERE Id = @Id;
`;

const result = analyze(sql);

console.log(result.ast);
console.log(result.diagnostics);
console.log(result.scope.root);
console.log(result.lineage.edges);
console.log(result.columns.resolutions);
```

---

# Exported APIs

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

If you want the full parser + semantic pipeline in one call, use:

```ts
analyze(sql)
```

Use the lower-level APIs only when you need custom control over individual stages such as lexing, parsing, scope building, lineage, or diagnostics.

---

# Analyze Result

`analyze(sql)` returns:

| Field                 | Description                |
| --------------------- | -------------------------- |
| `ast`                 | Parsed AST                 |
| `issues`              | Raw parser issues          |
| `scope`               | Scope graph                |
| `semanticDiagnostics` | Semantic diagnostics       |
| `diagnostics`         | Combined diagnostics       |
| `lineage`             | Column lineage             |
| `columns`             | Column resolution analysis |

---

# Diagnostics Example

```sql
UPDATE u
SET u.Name = 'Bad Update'
FROM Users u WITH(NOLOCK)
WHERE u.Id = u.Id
```

Diagnostics produced for this exact SQL:

```text
DML004 error   UPDATE target table must not use WITH (NOLOCK)
LOG001 warning Condition compares 'u.Id' to itself
```

---

# Lineage Example

```sql
INSERT INTO dbo.InvoiceSummary (CustomerId, InvoiceMonth, TotalAmount)
SELECT i.CustomerId,
       i.InvoiceMonth,
       i.Subtotal + i.TaxAmount
FROM dbo.Invoices i;
```

Lineage edges produced for this exact SQL:

```text
dbo.Invoices.CustomerId -> dbo.InvoiceSummary.CustomerId
dbo.Invoices.InvoiceMonth -> dbo.InvoiceSummary.InvoiceMonth
dbo.Invoices.Subtotal -> dbo.InvoiceSummary.TotalAmount
dbo.Invoices.TaxAmount -> dbo.InvoiceSummary.TotalAmount
```

---

# Supported Today

## Query grammar

Supported:

* SELECT
* INSERT
* UPDATE
* DELETE
* MERGE
* JOINs
* APPLY
* subqueries
* scalar subqueries
* CTEs
* UNION / INTERSECT / EXCEPT
* GROUP BY
* HAVING
* ORDER BY
* OFFSET / FETCH
* window functions
* window frame clauses
* PIVOT
* UNPIVOT
* OPENJSON with `WITH (...)`
* `FOR JSON` / `FOR XML`
* `OPTION (...)`
* `STRING_AGG ... WITHIN GROUP (...)`
* `COUNT(DISTINCT ...)` and `SUM(DISTINCT ...)`

---

## Procedural T-SQL

Supported:

* DECLARE
* SET
* PRINT
* RETURN
* RAISERROR
* THROW
* EXEC / EXECUTE
* IF / ELSE
* BEGIN / END
* BEGIN TRY / END TRY / BEGIN CATCH / END CATCH
* WHILE
* BREAK
* CONTINUE
* GOTO / labels
* WAITFOR TIME / DELAY
* cursor statements
* variable assignment
* stored procedure parameters
* READONLY table-valued parameters
* temp tables
* table variables
* transaction statements
* output parameters in `EXEC`

---

## Expression support

Supported:

* scalar expressions
* CASE
* EXISTS
* function calls
* CAST
* TRY_CAST
* CONVERT
* arithmetic
* boolean logic
* IN / BETWEEN / LIKE
* NULL handling
* `IIF`
* old-style string literal aliases in projections

---

## DDL

Supported:

* CREATE TABLE
* ALTER TABLE (partial)
* CREATE PROCEDURE
* CREATE FUNCTION (partial)
* CREATE TRIGGER
* CREATE INDEX
* ALTER INDEX
* UPDATE STATISTICS
* constraints:

  * PRIMARY KEY
  * FOREIGN KEY
  * UNIQUE
  * CHECK
  * DEFAULT
  * NULL / NOT NULL
  * IDENTITY

Supports:

* inline constraints
* named constraints
* unnamed constraints
* composite keys
* computed columns
* computed columns with optional `PERSISTED`
* REFERENCES parsing
* clustered / nonclustered indexes
* clustered primary key constraints
* INCLUDE columns
* filtered indexes (`WHERE`)
* index options (`WITH (...)`)
* storage targets (`ON [PRIMARY]`)
* tolerated create preambles such as `WITH EXECUTE AS ...`, `WITH SCHEMABINDING`, `WITH ENCRYPTION`, and function `RETURNS ...`

---

## Semantic layers

Supported:

* variable scope
* parameter scope
* alias scope
* temp table scope
* table variable scope
* CTE scope
* PIVOT / UNPIVOT output-column scope
* lineage extraction
* declaration extraction
* dependency extraction
* document symbols
* completions
* diagnostics
* parser + diagnostics issue stream for recoverable SQL

---

# Fault-Tolerant Parsing

SaralSQL is intentionally **recoverable**.

Broken SQL still returns usable AST.

Example:

```sql
SELECT *
FROM Users
WHERE
```

Returns:

* partial AST
* recoverable parser issue
* usable scope
* usable lineage
* usable completion context

This is critical for editor scenarios.

---

# Current Maturity

SaralSQL is capable of parsing a large subset of production T-SQL, including:

* procedural stored procedures
* first enterprise stored procedure codebase pass completed
* enterprise-style validation / ETL procedures
* real-world DDL
* constraints and indexes
* maintenance scripts with `ALTER INDEX` and `UPDATE STATISTICS`
* cursor-based procedures
* procedural flow with `GOTO`, labels, and `WAITFOR`
* recursive CTEs
* temp-table-heavy workflows
* TVP-driven `INSERT ... SELECT ... FROM` patterns
* report-style queries with legacy alias forms
* partial / broken SQL inside editors
* semantic scope + lineage extraction

The parser is designed around **practical SQL coverage**, not benchmark grammar completeness.

---

# Current Limitations

SaralSQL is already useful, but **not yet complete T-SQL grammar coverage**.

Current gaps include:

## Procedural

Not fully implemented / partial:

* transaction grammar edge cases
* dynamic EXEC edge-case parsing

---

## DDL

Partial / planned:

* partition grammar
* advanced index options
* filegroup / storage edge cases
* indexed views

---

## Query grammar

Partial:

* OPENQUERY / OPENROWSET family
* remaining PIVOT / UNPIVOT edge cases
* JSON edge cases beyond current `OPENJSON` support
* XML grammar
* some ordered / specialized aggregate edge cases

---

## Metadata-aware analysis

Currently file-local only.

Not yet built:

* schema catalogs
* cross-file symbol resolution
* type-aware validation
* FK-aware navigation
* wildcard expansion via catalog metadata

These belong partly in host LSP integration.

---

# Transparency on Accuracy

This parser is **actively evolving**.

Goals:

1. parse valid T-SQL correctly
2. recover gracefully on invalid SQL
3. preserve AST usefulness even when incomplete

There will still be:

* grammar gaps
* incomplete node shapes
* edge-case recovery bugs
* uncommon SQL Server syntax not yet modeled

That said, the parser is already hardened around a number of real production shapes, including:

* nested `TRY / CATCH`
* TVPs and table variables
* cursor lifecycle statements
* `WAITFOR TIME` / `WAITFOR DELAY`
* `GOTO` and labels
* `DELETE TOP (...) ... OUTPUT`
* `MERGE` variants
* `STRING_AGG ... WITHIN GROUP`
* `OPENJSON ... WITH (...)`
* legacy string-literal aliases
* `BEGIN ;WITH ...` CTE handoff inside blocks
* `SET DATEFIRST` followed by statement bodies
* computed columns with optional `PERSISTED`
* aggregate `DISTINCT` forms like `COUNT(DISTINCT ...)`
* tolerant `CREATE` preambles and trigger headers

Bug reports with SQL samples are extremely valuable.

---

# Architecture

```text
Lexer
  ↓
Parser
  ↓
ScopeBuilder
  ↓
LineageBuilder
  ↓
ColumnAnalyzer
  ↓
DiagnosticEngine
```

Design principle:

```text
Parse once
Enrich in layers
Reuse semantic graph
Avoid duplicate logic
```

---

# Roadmap

## Near term

* transaction grammar completion
* richer diagnostics
* auto-fix scaffolding

## Medium term

* schema-aware resolution
* metadata catalogs
* wildcard expansion
* FK-aware navigation
* missing index analysis
* duplicate index detection
* standards enforcement packs
* deterministic SQL rewrites

## Long term

* semantic autocomplete
* rename symbol
* find references
* impact analysis
* safe refactors
* query plan linting
* AI-assisted SQL correction
* automated performance remediation

---

# Contributing

The best issues include:

* SQL sample
* expected behavior
* current AST / diagnostic output

Grammar edge cases are especially helpful.

---

# License

MIT

Built by **Saral Simon Stalin**
