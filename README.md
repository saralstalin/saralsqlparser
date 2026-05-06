# @saralsql/tsql-parser

High-fidelity parser and semantic analysis engine for Microsoft SQL Server T-SQL.

This package is intended as a file-level toolkit for editor tooling and LSP integrations. It parses, analyzes, and enriches a single SQL document; workspace-level schema cataloging belongs in the host LSP server.

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

* editor integrations
* LSP servers
* static analysis and linting
* refactoring tools
* completion and diagnostics
* column lineage and impact analysis

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

Most examples in this README use `analyze(sql)` for a complete single-file workflow. The low-level `Lexer` and `Parser` implementations are still exported separately for advanced or custom token/AST scenarios.

---

## Analyze SQL

```ts
import { analyze } from '@saralsql/tsql-parser';

const sql = `
SELECT Id, Name
FROM Users
WHERE Id = @Id;
`;

const result = analyze(sql);

console.log(result.ast);
console.log(result.issues);              // raw parser issues
console.log(result.semanticDiagnostics); // raw semantic diagnostics
console.log(result.diagnostics);         // combined parser + semantic diagnostics
console.log(result.scope.root);
console.log(result.lineage.edges);
console.log(result.columns.resolutions);
```

### `analyze(sql)` returns

* `ast` — parsed `Program`
* `issues` — raw parser issues
* `scope` — semantic scope structure
* `semanticDiagnostics` — raw semantic diagnostics
* `diagnostics` — combined parser + semantic diagnostics
* `lineage` — lineage result for the document
* `columns` — column analysis result

---

## Completion Support

This package provides local completion context based on the parsed file.

```ts
import { getCompletionsAt } from '@saralsql/tsql-parser';

const sql = 'SELECT Id, Name FROM Users u WHERE u.';
const completions = getCompletionsAt(sql, { line: 1, character: 33 });
console.log(completions);
```

### Completion API

* `getCompletionContext(sql, positionOrOffset)` — returns the completion context, visible symbols, node, scope, diagnostics, and keyword candidates
* `getCompletionsAt(sql, positionOrOffset)` — returns completion items for the current document position

---

## Document Symbols

Generate document outline symbols from a parsed AST.

```ts
import { analyze, getDocumentSymbols } from '@saralsql/tsql-parser';

const sql = `
CREATE PROCEDURE dbo.MyProc
AS
BEGIN
  SELECT 1;
END
`;

const result = analyze(sql);
const symbols = getDocumentSymbols(result.ast);
console.log(symbols);
```

---

## Diagnostics

Analyze returns both raw semantic diagnostics and a combined diagnostics stream.

```ts
import { analyze } from '@saralsql/tsql-parser';

const sql = `
UPDATE Users
SET Name = 'x'
`;

const result = analyze(sql);
console.log(result.semanticDiagnostics);
console.log(result.diagnostics);
```

### Example output

```ts
[
  {
    code: 'DML001',
    message: 'UPDATE statement has no WHERE clause — all rows will be affected',
    severity: 'warning',
    start: 0,
    end: 6
  }
]
```

---

## Scope Model

ScopeBuilder models T-SQL symbol visibility and references.

Supported symbol types include:

* variables
* parameters
* temp tables
* aliases
* CTEs
* query-local scope

---

## Column Analysis

Analyze returns column resolution results as part of the document analysis.

```ts
import { analyze } from '@saralsql/tsql-parser';

const sql = `
SELECT u.Id, Name
FROM Users u
`;

const result = analyze(sql);
console.log(result.columns.resolutions);
```

---

## Lineage

Analyze returns lineage information for a single document.

```ts
import { analyze } from '@saralsql/tsql-parser';

const sql = `
WITH X AS (
    SELECT o.Amount
    FROM Orders o
)
SELECT X.Amount AS Total
FROM X;
`;

const result = analyze(sql);
console.log(result.lineage.edges);
```

---

## Extractors

The package also exposes helpers for declaration and dependency extraction.

```ts
import {
  extractDeclarations,
  extractDependencies,
  extractReferences
} from '@saralsql/tsql-parser';
```

---

## Fault-Tolerant Parsing

SaralSQL is designed for editors.

Parsing **continues through errors** and still returns a usable AST.

Example:

```sql
SELECT *
FROM Users
WHERE
```

This produces an incomplete but usable AST node for the broken query.

---

## Architecture

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

## Project Structure

```text
tests/
src/
  analyze.ts
  completions.ts
  documentSymbols.ts
  extractors.ts
  index.ts
  position.ts
  ast/
    astWalker.ts
    types.ts
  diagnostics/
    diagnostics.ts
  lineage/
    lineage.ts
    lineageBuilder.ts
  parser/
    lexer.ts
    parser.ts
  semantic/
    columnAnalyzer.ts
    scope.ts
    scopeBuilder.ts
```

---

## Design Principles

### 1. Layered semantics

```text
Scope → Lineage → Column Analysis
```

### 2. No duplicated logic

ColumnAnalyzer reuses lineage information instead of re-implementing it.

### 3. Editor-first resilience

All semantic layers tolerate incomplete or broken AST nodes.

---

## Roadmap

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
