# @saralsql/tsql-parser

High-fidelity TypeScript parser, scope analyzer, and lineage engine for Microsoft SQL Server T-SQL.

Built for **language tooling**, **static analysis**, **linting**, **refactoring**, and **IDE integrations** — not just parsing valid SQL.

---

## Why This Exists

Generic SQL parsers treat T-SQL as one of many dialects. SaralSQL is built around T-SQL specifically — variables, temp tables, stored procedures, table variables, CTEs, mixed DDL/DML batches, and procedural constructs found in real enterprise codebases.

It is designed as a foundation for:

* LSP servers and IDE extensions
* Static analysis and linting
* Refactoring tools
* Autocomplete engines
* Query quality analysis
* Column lineage and impact analysis
* Schema-aware editor code actions

---

## Installation

```bash
npm install @saralsql/tsql-parser
```

---

## Quick Start

Everything is exported from a single entry point.

```ts
import {
  Lexer,
  Parser,
  ScopeBuilder,
  LineageBuilder,
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

ScopeBuilder understands:

* variables
* parameters
* table aliases
* CTEs
* procedures
* functions
* nested scope visibility
* read/write references

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

const ast = new Parser(new Lexer(sql)).parse().ast;
const scope = new ScopeBuilder().build(ast);

console.log(scope.root);
console.log(scope.undeclared);
console.log(scope.duplicates);
```

### ScopeBuilderResult

| Field        | Type                             | Description            |
| ------------ | -------------------------------- | ---------------------- |
| `root`       | `Scope`                          | Root scope             |
| `references` | `Map<string, SymbolReference[]>` | All references         |
| `undeclared` | `SymbolReference[]`              | Missing declarations   |
| `duplicates` | `DuplicateDeclaration[]`         | Duplicate declarations |

---

## Build Lineage

LineageBuilder computes **flattened column-level lineage**.

Supports:

* aliases
* joins
* CTE flattening
* subquery flattening
* wildcard lineage (`*`, `alias.*`)
* `INSERT ... SELECT`
* `UPDATE ... FROM`
* computed expressions
* CASE expressions
* aggregate functions

### Example: CTE flattening

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

Output:

```ts
[
  {
    from: {
      kind: "column",
      name: "Orders.Amount",
      source: "Orders"
    },
    to: {
      kind: "result",
      name: "Total"
    }
  }
]
```

---

### Example: Wildcard lineage

```sql
SELECT *
FROM Users;
```

Produces:

```ts
Users.* -> *
```

Qualified wildcard:

```sql
SELECT u.*
FROM Users u;
```

Produces:

```ts
Users.* -> *
```

Join wildcard:

```sql
SELECT *
FROM Orders o
JOIN Customer c
  ON o.CustomerId = c.Id;
```

Produces:

```ts
Orders.* -> *
Customer.* -> *
```

This enables:

* expand `*` to explicit columns
* dependency graphs
* impact analysis
* rename propagation
* schema-aware editor fixes

---

### Example: INSERT lineage

```sql
INSERT INTO Audit(Id, Amount)
SELECT Id, Amount
FROM Orders;
```

Produces:

```ts
Orders.Id -> Audit.Id
Orders.Amount -> Audit.Amount
```

---

### Example: UPDATE lineage

```sql
UPDATE t
SET Total = c.Amount + c.Tax
FROM Target t
JOIN Charges c
  ON c.Id = t.Id;
```

Produces:

```ts
Charges.Amount -> t.Total
Charges.Tax -> t.Total
```

---

## Run Diagnostics

```ts
import {
  Lexer,
  Parser,
  ScopeBuilder,
  diagnose
} from "@saralsql/tsql-parser";

const sql = `
UPDATE Users
SET Name = 'John';
`;

const ast = new Parser(new Lexer(sql)).parse().ast;
const scope = new ScopeBuilder().build(ast);
const diagnostics = diagnose(ast, scope);

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

### Diagnostic fields

| Field      | Type                             | Description  |
| ---------- | -------------------------------- | ------------ |
| `code`     | `DiagnosticCode`                 | Rule id      |
| `message`  | `string`                         | Description  |
| `severity` | `'error' \| 'warning' \| 'info'` | Severity     |
| `start`    | `number`                         | Start offset |
| `end`      | `number`                         | End offset   |

---

# Diagnostic Rules

## Variables

| Code     | Severity | Description                       |
| -------- | -------- | --------------------------------- |
| `VAR001` | error    | Variable used but never declared  |
| `VAR002` | warning  | Variable declared but never read  |
| `VAR003` | warning  | Parameter declared but never read |

---

## DML Safety

| Code     | Severity | Description                |
| -------- | -------- | -------------------------- |
| `DML001` | warning  | UPDATE without WHERE       |
| `DML002` | warning  | DELETE without WHERE       |
| `DML003` | warning  | INSERT without column list |

---

## Query Quality

| Code     | Severity | Description          |
| -------- | -------- | -------------------- |
| `SEL001` | warning  | SELECT *             |
| `SEL002` | error    | SELECT * inside VIEW |

---

## Duplicate declarations

| Code     | Severity | Description         |
| -------- | -------- | ------------------- |
| `DUP001` | error    | Variable redeclared |
| `DUP002` | error    | Duplicate CTE name  |

---

# Fault-Tolerant Parsing

SaralSQL is designed for editors.

It does not stop parsing on syntax errors.

Every recoverable node can carry:

```ts
interface Recoverable {
  incomplete?: boolean;
  errors?: string[];
}
```

Example incomplete SQL:

```sql
SELECT *
FROM Users
WHERE
```

Still produces usable AST:

```ts
{
  type: "SelectStatement",
  incomplete: true,
  where: null
}
```

Useful for:

* autocomplete
* hover
* live linting
* code actions
* inline diagnostics

---

# Scope Model

Models real T-SQL visibility:

* Batch scope
* Procedure / Function scope
* WITH scope
* Query-local aliases
* Parameters
* Variables
* Temp tables
* Types

Cursor lookup:

```ts
const scope = scopeResult.root.findInnermost(offset);
const visible = scope.getVisibleSymbols();
```

Perfect for autocomplete.

---

# T-SQL Coverage

## Query

`SELECT`, `DISTINCT`, `TOP`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `UNION`, `EXCEPT`, `INTERSECT`, subqueries, CTEs

## Joins

`INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, `CROSS APPLY`, `OUTER APPLY`

## DML

`INSERT`, `UPDATE`, `DELETE`

## DDL

`CREATE TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `TYPE`

## Procedural

`IF`, `ELSE`, `BEGIN`, `END`, `DECLARE`, `SET`, `PRINT`

## Expressions

CASE, BETWEEN, IN, EXISTS, LIKE, IS NULL, COLLATE, OVER/PARTITION BY, functions, wildcards, multipart identifiers

---

# Node Locations

Every node has:

```ts
interface NodeLocation {
  start: number;
  end: number;
}
```

Offsets are exact byte offsets into source text.

Useful for:

* syntax highlighting
* hovers
* go to definition
* find references
* quick fixes
* editor ranges

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
DiagnosticEngine
```

Each layer is independent.

* **Lexer** → tokenization
* **Parser** → AST generation
* **ScopeBuilder** → semantic scope tree
* **LineageBuilder** → flattened column lineage
* **DiagnosticEngine** → warnings/errors

---

# Roadmap

## Near term

* `WHILE`
* `RETURN`
* `EXEC / EXECUTE`
* `TRY / CATCH`
* `THROW`
* `RAISERROR`
* `OFFSET / FETCH`
* `OUTPUT`
* `GO` batch boundaries

## Medium term

* `MERGE`
* `ALTER`
* `DROP`
* Catalog/schema integration
* Column metadata resolution
* Schema-aware wildcard expansion

## Long term

* Semantic autocomplete
* Symbol navigation
* Find references
* Column impact analysis
* Missing index suggestions
* Auto-fixes and code actions

---

## License

MIT

---

Built by **Saral Simon Stalin**
