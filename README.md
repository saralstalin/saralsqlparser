# SaralSQL T-SQL Parser

High-fidelity TypeScript parser for Microsoft SQL Server T-SQL.

Built for **language tooling**, **static analysis**, **linting**, and **developer productivity** — not just parsing valid SQL.

---

## Overview

SaralSQL T-SQL Parser is a strongly typed parser designed specifically for **SQL Server T-SQL**.

Unlike generic SQL parsers, it understands procedural SQL and SQL Server constructs commonly found in real enterprise codebases:

* Variables (`@Id`)
* Temp tables (`#Temp`)
* CTEs (`WITH`)
* Stored procedures
* Functions
* Views
* Table types
* IF / ELSE logic
* BEGIN / END blocks
* Table hints
* Complex joins
* Window functions
* Mixed DDL + DML batches

It is designed as a foundation for:

* Parsing
* Semantic analysis
* Symbol resolution
* Diagnostics
* Refactoring tools
* Autocomplete engines
* Static performance analysis

---

## Installation

```bash
npm install @saralsql/tsql-parser
```

---

## Clean Public API

Everything is exported from a single entry point:

```ts
import {
  Lexer,
  Parser,
  ScopeBuilder,
  Scope,
  diagnose
} from "@saralsql/tsql-parser";
```

No deep imports.
No internal module references.
Stable public API.

---

## Features

### Lexer

Robust tokenizer with support for:

✅ SQL keyword normalization
✅ Variables (`@BatchId`)
✅ Temp tables (`#Orders`)
✅ Bracket identifiers (`[Order Details]`)
✅ Composite operators (`>=`, `<=`, `!=`, `<>`)
✅ Strings (`'Text'`, `N'Unicode'`)
✅ Decimal numbers
✅ Comments
✅ Exact source offsets for LSP/editor tooling

---

### Parser

Produces a strongly typed AST.

Supports:

#### Query statements

* SELECT
* DISTINCT
* TOP
* WHERE
* GROUP BY
* HAVING
* ORDER BY
* JOINs
* Subqueries
* UNION
* UNION ALL
* EXCEPT
* INTERSECT
* CTEs

#### DML

* INSERT
* UPDATE
* DELETE
* DECLARE
* SET
* PRINT

#### DDL

* CREATE TABLE
* CREATE VIEW
* CREATE PROCEDURE
* CREATE FUNCTION
* CREATE TYPE

#### Procedural SQL

* IF / ELSE
* BEGIN / END blocks
* Parameters
* Variable declarations
* Table variables

#### Expressions

* Binary operators
* Unary operators
* CASE expressions
* BETWEEN
* IN
* EXISTS
* Function calls
* Window functions (`OVER`)
* Member expressions (`dbo.Table.Column`)
* Wildcards (`*`, `alias.*`)

---

## Fault-Tolerant Parsing

SaralSQL is built for tooling, so parsing does **not** stop on incomplete SQL.

Example:

```sql
SELECT *
FROM Customers
WHERE
```

Still produces a recoverable AST node:

```ts
{
  type: "SelectStatement",
  incomplete: true,
  errors: ["Expected expression after WHERE"]
}
```

This makes it suitable for:

* IDE tooling
* Live diagnostics
* Autocomplete
* Refactoring
* Parsing partially typed SQL

---

## Parse SQL

```ts
import {
  Lexer,
  Parser
} from "@saralsql/tsql-parser";

const sql = `
SELECT Id, Name
FROM Users
WHERE Id = @Id
`;

const parser = new Parser(
  new Lexer(sql)
);

const result = parser.parse();

console.log(result.ast);
```

---

## Build Scope

Semantic scope analysis:

```ts
import {
  Lexer,
  Parser,
  ScopeBuilder
} from "@saralsql/tsql-parser";

const sql = `
DECLARE @Id INT;
SET @Id = 10;

SELECT *
FROM Users
WHERE Id = @Id;
`;

const ast =
  new Parser(new Lexer(sql))
    .parse()
    .ast;

const scope =
  new ScopeBuilder()
    .build(ast);

console.log(scope);
```

Tracks:

* Variables
* Parameters
* Tables
* Aliases
* CTEs
* Functions
* Types
* Read/write references

Detects:

* Undeclared symbols
* Duplicate declarations
* Unused variables
* Unused parameters

---

## Semantic Intelligence

SaralSQL goes beyond parsing and symbol declaration tracking.

Every symbol reference is classified as:

* **Read**
* **Write**

Example:

```sql
DECLARE @Count INT;
SET @Count = 10;

SELECT @Count;
```

Semantic model:

* `DECLARE @Count` → declaration
* `SET @Count = 10` → write reference
* `SELECT @Count` → read reference

This enables advanced static analysis:

* Variable used before assignment
* Dead writes
* Unused assignments
* Read/write lineage
* Mutation tracking
* Control-flow aware analysis
* Data-flow diagnostics
* Semantic refactoring

Foundation:

```text
Declaration → Reference → Read / Write → Data Flow → Intelligence
```

This architecture is designed for **compiler-grade SQL tooling**, not just syntax parsing.


## Diagnostics

Built-in diagnostics engine:

```ts
import { diagnose } from "@saralsql/tsql-parser";

const sql = `
UPDATE Users
SET Name = 'John';
`;

const diagnostics = diagnose(sql);

console.log(diagnostics);
```

Example output:

```ts
[
  {
    code: "DML001",
    message: "UPDATE statement has no WHERE clause — all rows will be affected",
    severity: "warning"
  }
]
```

---

## Diagnostic Rules

### Variables

| Code   | Description              |
| ------ | ------------------------ |
| VAR001 | Undeclared variable      |
| VAR002 | Unused variable          |
| VAR003 | Unused parameter         |
| VAR004 | Variable used before set |

### DML Safety

| Code   | Description                |
| ------ | -------------------------- |
| DML001 | UPDATE without WHERE       |
| DML002 | DELETE without WHERE       |
| DML003 | INSERT without column list |

### Query Quality

| Code   | Description      |
| ------ | ---------------- |
| SEL001 | SELECT * warning |
| SEL002 | SELECT * in VIEW |

### Duplicate Declarations

| Code   | Description        |
| ------ | ------------------ |
| DUP001 | Duplicate variable |
| DUP002 | Duplicate CTE      |

---

## Design Principles

### High fidelity

Every AST node preserves:

```ts
start
end
```

Precise source offsets make editor tooling reliable.

---

### Recover gracefully

Broken SQL should still produce meaningful AST.

---

### Strong typing

Full TypeScript AST model.

---

### Semantic first

Pipeline:

```text
Lexer → Parser → Scope → Diagnostics → Intelligence
```

---

## Roadmap

Planned capabilities:

* Alias resolution
* Column lineage
* Table lineage
* Semantic autocomplete
* Missing index suggestions
* Static performance analysis
* Query smell detection
* Execution plan hints
* Auto-fixes / code actions

---

## License

MIT

---

Built by **Saral Simon Stalin**
