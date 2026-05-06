# @saralsql/tsql-parser

High-fidelity TypeScript parser, semantic engine, and lineage analyzer for Microsoft SQL Server T-SQL.

Built for **language tooling**, **static analysis**, **linting**, **refactoring**, and **IDE integrations** — not just parsing valid SQL.

---

## Why This Exists

Generic SQL parsers treat T-SQL as one of many dialects. SaralSQL is built specifically for **real-world T-SQL**, including:

* variables and parameters
* temp tables and table variables
* stored procedures and functions
* CTEs and subqueries
* mixed DDL + DML batches
* procedural constructs

It is designed as a foundation for:

* LSP servers and IDE extensions
* Static analysis and linting
* Refactoring tools
* Autocomplete engines
* Query quality analysis
* Column lineage and impact analysis
* Schema-aware editor features

---

## Installation

```bash
npm install @saralsql/tsql-parser
```

---

## Quick Start

All APIs are exported from a single entry point:

```ts
import {
  Lexer,
  Parser,
  ScopeBuilder,
  LineageBuilder,
  ColumnAnalyzer,
  diagnose
} from "@saralsql/tsql-parser";
```

---

# Usage

## Parse SQL

```ts
import { Lexer, Parser } from "@saralsql/tsql-parser";

const sql = `
SELECT Id, Name
FROM Users
WHERE Id = @Id;
`;

const ast = new Parser(new Lexer(sql)).parse().ast;

console.log(ast);
```

---

## Build Scope

ScopeBuilder models **symbol visibility and references**.

Supports:

* variables
* parameters
* aliases
* CTEs
* nested scopes
* read/write tracking

```ts
import {
  Lexer,
  Parser,
  ScopeBuilder
} from "@saralsql/tsql-parser";

const ast = new Parser(new Lexer(sql)).parse().ast;

const scope = new ScopeBuilder().build(ast);

console.log(scope.root);
console.log(scope.undeclared);
console.log(scope.duplicates);
```

### ScopeBuilderResult

| Field        | Description            |
| ------------ | ---------------------- |
| `root`       | Root scope             |
| `references` | All symbol references  |
| `undeclared` | Missing declarations   |
| `duplicates` | Duplicate declarations |

---

## Column Analysis (NEW)

ColumnAnalyzer provides **column-level resolution**, built on top of lineage.

It answers:

* What does this column refer to?
* Which table does it come from?
* How does it propagate through expressions?

```ts
import {
  Lexer,
  Parser,
  ColumnAnalyzer
} from "@saralsql/tsql-parser";

const sql = `
SELECT u.Id, Name
FROM Users u
`;

const ast = new Parser(new Lexer(sql)).parse().ast;

const analyzer = new ColumnAnalyzer();
const result = analyzer.analyze(ast);

console.log(result.resolutions);
```

### Example Output

```ts
[
  {
    location: IdentifierNode,
    inputs: [
      { name: "Users.Id", source: "Users" }
    ]
  }
]
```

---

## Build Lineage

LineageBuilder computes **flattened column-level lineage**.

Supports:

* joins
* aliases
* subqueries
* CTE flattening
* wildcard (`*`, `alias.*`)
* INSERT / UPDATE propagation
* computed expressions
* CASE expressions
* aggregates

### Example

```ts
import {
  Lexer,
  Parser,
  LineageBuilder
} from "@saralsql/tsql-parser";

const sql = `
WITH X AS (
    SELECT o.Amount
    FROM Orders o
)
SELECT X.Amount AS Total
FROM X;
`;

const ast = new Parser(new Lexer(sql)).parse().ast;

const lineage = new LineageBuilder().build(ast);

console.log(lineage.edges);
```

### Output

```ts
[
  {
    from: { name: "Orders.Amount", source: "Orders" },
    to: { name: "Total" }
  }
]
```

---

## Run Diagnostics

```ts
import {
  diagnose
} from "@saralsql/tsql-parser";

const diagnostics = diagnose(ast, scope);

console.log(diagnostics);
```

### Example

```ts
[
  {
    code: "DML001",
    message: "UPDATE without WHERE clause",
    severity: "warning"
  }
]
```

---

# Fault-Tolerant Parsing

SaralSQL is designed for editors.

Parsing **never stops on errors**.

Example:

```sql
SELECT *
FROM Users
WHERE
```

Produces usable AST:

```ts
{
  type: "SelectStatement",
  incomplete: true,
  where: null
}
```

---

# Scope Model

Models real T-SQL behavior:

* batch scope
* procedure / function scope
* query-local aliases
* variables and parameters
* nested visibility

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

---

# Project Structure

```text
src/
  ast/
  parser/
  semantic/
    scopeBuilder.ts
    columnAnalyzer.ts
  lineage/
  diagnostics/
  index.ts
```

---

# Design Principles

### 1. Layered semantics

```text
Scope → Lineage → Column Analysis
```

Each layer builds on the previous one.

---

### 2. No duplicated logic

ColumnAnalyzer **reuses lineage**, it does not re-implement resolution.

---

### 3. Fault-tolerant by design

All semantic layers accept:

```ts
Expression | null | undefined
```

---

# T-SQL Coverage

## Query

SELECT, DISTINCT, TOP, WHERE, GROUP BY, HAVING, ORDER BY
UNION, EXCEPT, INTERSECT
CTEs, subqueries

## Joins

INNER, LEFT, RIGHT, FULL
CROSS, APPLY

## DML

INSERT, UPDATE, DELETE

## DDL

CREATE TABLE, VIEW, PROCEDURE, FUNCTION

## Procedural

IF, ELSE, BEGIN, END
DECLARE, SET, PRINT

## Expressions

CASE, BETWEEN, IN, EXISTS, LIKE
IS NULL, functions, wildcards
OVER / PARTITION BY

---

# Roadmap

## Near term

* Column ambiguity diagnostics
* Missing column detection
* Schema-aware resolution

## Medium term

* Catalog/schema integration
* Column metadata resolution
* Schema-aware wildcard expansion

## Long term

* Semantic autocomplete
* Symbol navigation
* Find references
* Column impact analysis
* Missing index suggestions
* Auto-fixes

---

## License

MIT

---

Built by **Saral Simon Stalin**
