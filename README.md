# @saralsql/tsql-parser

High-fidelity TypeScript parser for Microsoft SQL Server T-SQL.

Built for **language tooling**, **static analysis**, **linting**, and **IDE integrations** — not just parsing valid SQL.

---

## Why This Exists

Generic SQL parsers treat T-SQL as one of many dialects. SaralSQL is built around T-SQL specifically — variables, temp tables, stored procedures, table variables, CTEs, mixed DDL/DML batches, and the procedural constructs that appear in real enterprise codebases.

It is designed as a foundation for:

- LSP servers and IDE extensions
- Static analysis and linting
- Refactoring tools
- Autocomplete engines
- Query quality analysis

---

## Installation

```bash
npm install @saralsql/tsql-parser
```

---

## Quick Start

Everything is exported from a single entry point. No internal module references.

```ts
import { Lexer, Parser, ScopeBuilder, diagnose } from "@saralsql/tsql-parser";
```

---

## Usage

### Parse SQL

```ts
import { Lexer, Parser } from "@saralsql/tsql-parser";

const sql = `
  SELECT Id, Name
  FROM Users
  WHERE Id = @Id
`;

const ast = new Parser(new Lexer(sql)).parse().ast;
```

---

### Build Scope

```ts
import { Lexer, Parser, ScopeBuilder } from "@saralsql/tsql-parser";

const sql = `
  DECLARE @Id INT;
  SET @Id = 10;

  SELECT Id, Name
  FROM Users
  WHERE Id = @Id;
`;

const ast = new Parser(new Lexer(sql)).parse().ast;
const scopeResult = new ScopeBuilder().build(ast);

// Scope tree — query aliases, CTE names, variables, parameters
console.log(scopeResult.root);

// References that could not be resolved
console.log(scopeResult.undeclared);

// Duplicate declarations within the same scope
console.log(scopeResult.duplicates);
```

`ScopeBuilderResult` contains:

| Field | Type | Description |
|---|---|---|
| `root` | `Scope` | Root of the scope tree |
| `references` | `Map<string, SymbolReference[]>` | All recorded references by name |
| `undeclared` | `SymbolReference[]` | References with no matching declaration |
| `duplicates` | `DuplicateDeclaration[]` | Re-declarations within the same scope |

---

### Run Diagnostics

```ts
import { Lexer, Parser, ScopeBuilder, diagnose } from "@saralsql/tsql-parser";

const sql = `
  UPDATE Users
  SET Name = 'John';
`;

const ast = new Parser(new Lexer(sql)).parse().ast;
const scopeResult = new ScopeBuilder().build(ast);
const diagnostics = diagnose(ast, scopeResult);

console.log(diagnostics);
// [
//   {
//     code: "DML001",
//     message: "UPDATE statement has no WHERE clause — all rows will be affected",
//     severity: "warning",
//     start: 3,
//     end: 9
//   }
// ]
```

Each `Diagnostic` contains:

| Field | Type | Description |
|---|---|---|
| `code` | `DiagnosticCode` | Machine-readable rule identifier |
| `message` | `string` | Human-readable description |
| `severity` | `'error' \| 'warning' \| 'info'` | Severity level |
| `start` | `number` | Byte offset of the problem start |
| `end` | `number` | Byte offset of the problem end |

---

## Diagnostic Rules

### Variable rules

| Code | Severity | Description |
|---|---|---|
| `VAR001` | error | Variable used but never declared |
| `VAR002` | warning | Variable declared but never read |
| `VAR003` | warning | Parameter declared but never read |

> **Note:** `SET @x = value` is tracked as a **write**, not a read. A variable that is only written is still flagged as unused.

### DML safety

| Code | Severity | Description |
|---|---|---|
| `DML001` | warning | `UPDATE` without `WHERE` clause |
| `DML002` | warning | `DELETE` without `WHERE` clause |
| `DML003` | warning | `INSERT` without a column list |

### Query quality

| Code | Severity | Description |
|---|---|---|
| `SEL001` | warning | `SELECT *` — list columns explicitly |
| `SEL002` | error | `SELECT *` inside a `VIEW` — breaks on schema changes |

### Duplicate declarations

| Code | Severity | Description |
|---|---|---|
| `DUP001` | error | Variable re-declared in the same scope |
| `DUP002` | error | CTE name defined more than once in the same `WITH` clause |

---

## Fault-Tolerant Parsing

SaralSQL does not stop parsing on syntax errors. Every statement and expression node carries a `Recoverable` interface:

```ts
interface Recoverable {
  incomplete?: boolean;
  errors?: string[];
}
```

Incomplete SQL still produces a usable AST:

```sql
SELECT *
FROM Customers
WHERE
```

```ts
{
  type: "SelectStatement",
  incomplete: true,
  where: null
}
```

This makes SaralSQL suitable for IDE use where SQL is partially typed at any given moment.

---

## Scope Model

The scope tree models T-SQL scoping semantics precisely:

- **Batch scope** — variables declared at the top level
- **Procedure / Function scope** — parameters and local variables isolated per routine
- **SELECT scope** — table aliases and column aliases are query-local
- **WITH scope** — CTE names visible only within the `WITH` statement body
- **Block scope** — `BEGIN / END` boundaries

T-SQL variables declared inside `IF / ELSE` branches are **batch-scoped**, not block-scoped. SaralSQL models this correctly — a `DECLARE` inside an `IF` is visible after the block ends.

### Cursor resolution

Given a byte offset, find the innermost scope at that position:

```ts
const scope = scopeResult.root.findInnermost(offset);
const visible = scope.getVisibleSymbols();
```

`getVisibleSymbols()` walks the parent chain and returns all symbols visible at that position — suitable for autocomplete.

### Symbol kinds

```ts
enum SymbolKind {
  Variable   // DECLARE @x INT
  Parameter  // @param in CREATE PROCEDURE
  Table      // CREATE TABLE or DECLARE @t TABLE
  Alias      // FROM Users u
  CTE        // WITH cte AS (...)
  Procedure  // CREATE PROCEDURE
  Function   // CREATE FUNCTION
  Type       // CREATE TYPE
  TempTable  // #temp tables
  Column
}
```

### Read / write tracking

Every symbol reference is classified:

```ts
type ReferenceKind = 'read' | 'write';
```

```sql
DECLARE @Count INT;   -- declaration
SET @Count = 10;      -- write reference
SELECT @Count;        -- read reference
```

This enables:

- Detecting write-only variables (declared and assigned, never read)
- Dead write detection
- Data-flow analysis foundations

---

## T-SQL Coverage

### Query statements
`SELECT`, `DISTINCT`, `TOP`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `UNION`, `UNION ALL`, `EXCEPT`, `INTERSECT`, subqueries, CTEs

### Joins
`INNER JOIN`, `LEFT / RIGHT / FULL OUTER JOIN`, `CROSS JOIN`, `CROSS APPLY`, `OUTER APPLY`

### DML
`INSERT` (multi-column, multi-row), `UPDATE`, `DELETE` (including alias-based join deletes)

### DDL
`CREATE TABLE`, `CREATE VIEW`, `CREATE PROCEDURE`, `CREATE FUNCTION`, `CREATE TYPE`

### Procedural SQL
`IF / ELSE`, `BEGIN / END`, `DECLARE` (scalar and table variables), `SET`, `PRINT`

### Expressions
Binary and unary operators, `CASE`, `BETWEEN`, `IN`, `EXISTS`, `LIKE`, `IS NULL`, function calls, window functions (`OVER / PARTITION BY`), member expressions (`dbo.Table.Column`), wildcards (`*`, `alias.*`), `COLLATE`

---

## Node Locations

Every AST node carries precise byte offsets:

```ts
interface NodeLocation {
  start: number;
  end: number;
}
```

Offsets are always relative to the original source string — including across multiline scripts and Windows-style `\r\n` line endings. This makes it safe to use them for editor range highlighting, hover tooltips, and go-to-definition without any translation layer.

---

## Architecture

```
Lexer → Parser → ScopeBuilder → DiagnosticEngine
```

Each layer is independent and can be used without the next:

- **Lexer** — tokenises raw T-SQL, normalises keywords to uppercase, tracks exact byte offsets
- **Parser** — transforms tokens into a strongly-typed AST; pure function, no side effects
- **ScopeBuilder** — post-parse AST walk; builds the scope tree and reference map
- **DiagnosticEngine** — walks AST and scope tree; emits structured diagnostics

---

## Roadmap

### Near term (`0.2.0`)
- `WHILE` loop, `RETURN`, `EXEC / EXECUTE`
- `TRY / CATCH`, `THROW`, `RAISERROR`
- `OFFSET / FETCH` pagination
- `OUTPUT` clause on `INSERT / UPDATE / DELETE`
- `GO` batch boundaries modelled in AST
- Reference resolution — link identifier uses to declaration sites

### Medium term
- `MERGE` statement
- `ALTER` and `DROP` DDL
- Column alias resolution
- Derived table column inference

### Long term
- Column and table lineage
- Semantic autocomplete
- Missing index suggestions
- Query smell detection
- Auto-fixes and code actions

---

## License

MIT

---

Built by **Saral Simon Stalin**
