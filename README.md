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
* auto-fixes

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

Most consumers should use:

```ts
analyze(sql)
```

Low-level lexer / parser APIs are also exposed for advanced scenarios.

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
* CTEs
* UNION / INTERSECT / EXCEPT
* GROUP BY
* HAVING
* ORDER BY
* OFFSET / FETCH
* window functions (core OVER support)

---

## Procedural T-SQL

Supported:

* DECLARE
* SET
* PRINT
* RETURN
* RAISERROR
* EXEC / EXECUTE
* IF / ELSE
* BEGIN / END
* WHILE
* variable assignment
* stored procedure parameters
* READONLY table-valued parameters

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

---

## DDL

Supported:

* CREATE TABLE
* ALTER TABLE (partial)
* CREATE PROCEDURE
* CREATE FUNCTION (partial)
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
* REFERENCES parsing

---

## Semantic layers

Supported:

* variable scope
* parameter scope
* alias scope
* temp table scope
* CTE scope
* lineage extraction
* declaration extraction
* dependency extraction
* document symbols
* completions
* diagnostics

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

# Current Limitations

SaralSQL is already useful, but **not yet complete T-SQL grammar coverage**.

Current gaps include:

## Procedural

Not fully implemented / partial:

* TRY / CATCH
* THROW
* WAITFOR
* cursors
* GOTO / labels
* transaction grammar edge cases

---

## DDL

Partial / planned:

* CREATE INDEX
* filtered indexes
* INCLUDE columns
* computed columns
* persisted computed columns
* partition grammar
* filegroup/storage options

---

## Query grammar

Partial:

* full window frame grammar
* PIVOT / UNPIVOT edge cases
* OPENQUERY / OPENJSON family
* XML grammar
* JSON grammar edge cases

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

* CREATE INDEX
* TRY / CATCH
* THROW
* window frame grammar
* richer diagnostics
* auto-fix scaffolding

## Medium term

* schema-aware resolution
* metadata catalogs
* wildcard expansion
* FK-aware navigation
* missing index analysis
* duplicate index detection

## Long term

* semantic autocomplete
* rename symbol
* find references
* impact analysis
* safe refactors
* query plan linting
* AI-assisted SQL auto-correction

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
