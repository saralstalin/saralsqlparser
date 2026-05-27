# @saralsql/tsql-parser

High-fidelity fault-tolerant parser and semantic analysis engine for Microsoft SQL Server T-SQL.

Built specifically for:

- Language Servers (LSP)
- editor tooling
- diagnostics
- autocomplete
- lineage tracking
- enterprise SQL static analysis
- SQLCMD preprocessing

---

# Why SaralSQL?

Most SQL parsers are designed for query transformation or simple AST extraction.

SaralSQL is built specifically for real SQL Server tooling workloads involving:

- massive stored procedures
- mixed DDL + DML batches
- temp tables and TVPs
- incomplete SQL during live editing
- legacy SQL Server edge cases
- semantic diagnostics and lineage

The parser is optimized for:

- SQL Server grammar fidelity
- fault-tolerant parsing
- editor-safe recovery
- semantic enrichment
- high-complexity enterprise SQL

---

# Production Validation

SaralSQL has been validated against real enterprise SQL Server codebases.

## Verified against

- ✅ 600 modern enterprise stored procedures
- ✅ 1,790 legacy production stored procedures
- ✅ recursive CTE-heavy workloads
- ✅ temp-table-heavy ETL systems
- ✅ TVP-driven workflows
- ✅ large mixed DDL/DML deployment scripts
- ✅ complex MERGE and OUTPUT patterns

## Stability Goal

The parser is designed to:

- never crash on malformed SQL
- preserve partial AST state
- continue semantic analysis after localized syntax damage

This is critical for editor and LSP scenarios.

---

# Installation

```bash
npm install @saralsql/tsql-parser
```

---

# Quick Start

```ts
import { analyze } from '@saralsql/tsql-parser';

const sql = `
SELECT Id, Name
FROM Users
WHERE Id = @Id;
`;

const result = analyze(sql);

console.log(result.diagnostics);
console.log(result.lineage);
```

---

# Primary API

Use `analyze(sql)` for the full parser and semantic pipeline.

```ts
import { analyze } from '@saralsql/tsql-parser';

const result = analyze(sql);
```

## Analyze Result

| Field | Description |
|---|---|
| `ast` | Parsed AST |
| `issues` | Recoverable parser issues |
| `scope` | Scope graph for variables, parameters, aliases, CTEs, temp tables, and table variables |
| `diagnostics` | Semantic and safety diagnostics |
| `lineage` | Column lineage edges plus source exposure, ambiguity metadata, and mutation target metadata |
| `columns` | Column resolution analysis including ambiguity candidates and correlation flags where available |
| `typeMembers` | Built-in and referenced SQL Server type-member catalog (for property/method completions and typing) |

## AST Example

### Sample SQL (used in all follow-on examples)

```sql
DECLARE @T TABLE (
  StoreId INT,
  GeoPoint GEOGRAPHY,
  StoreName VARCHAR(100)
);

SELECT
  t.StoreId,
  GeoPoint.Lat AS Latitude
FROM @T t
WHERE StoreId = 1;
```

```json
{
  "type": "Program",
  "start": 0,
  "end": 167,
  "body": [
    {
      "type": "DeclareStatement",
      "variables": [
        {
          "name": "@T",
          "dataType": "TABLE",
          "columns": [
            { "name": "StoreId", "dataType": "INT" },
            { "name": "GeoPoint", "dataType": "GEOGRAPHY" },
            { "name": "StoreName", "dataType": "VARCHAR(100)" }
          ]
        }
      ],
      "start": 0,
      "end": 88
    },
    {
      "type": "SelectStatement",
      "columns": [
        {
          "type": "Column",
          "expression": {
            "type": "Identifier",
            "name": "t.StoreId",
            "parts": ["t", "StoreId"]
          },
          "outputName": "StoreId"
        },
        {
          "type": "Column",
          "expression": {
            "type": "Identifier",
            "name": "GeoPoint.Lat",
            "parts": ["GeoPoint", "Lat"]
          },
          "alias": "Latitude",
          "outputName": "Latitude"
        }
      ],
      "from": [{ "type": "TableReference", "table": { "type": "Identifier", "name": "@T" }, "alias": "t" }],
      "where": {
        "type": "BinaryExpression",
        "left": {
          "type": "Identifier",
          "name": "StoreId",
          "parts": ["StoreId"]
        },
        "operator": "=",
        "right": { "type": "Literal", "value": 1, "variant": "number" }
      }
    }
  ]
}
```

### Top-Level Type Members (from `analyze(...)`)

```json
{
  "typeMembers": {
    "builtIn": {
      "GEOGRAPHY": [
        { "name": "Lat", "kind": "property", "returnType": "FLOAT", "returnKind": "scalar" },
        { "name": "Long", "kind": "property", "returnType": "FLOAT", "returnKind": "scalar" }
      ]
    },
    "referenced": {
      "GEOGRAPHY": [
        { "name": "Lat", "kind": "property", "returnType": "FLOAT", "returnKind": "scalar" },
        { "name": "Long", "kind": "property", "returnType": "FLOAT", "returnKind": "scalar" }
      ]
    }
  }
}
```

## Column Resolution Decision Contract

`analyze(sql).columns.resolutions[]` includes a parser-native decision object for identifier ownership and ambiguity.
Using the sample SQL above (both selected columns):

```json
[
  {
    "location": { "name": "t.StoreId" },
    "inputs": [{ "name": "@T.StoreId", "resolution": "resolved" }],
    "decision": {
      "owner": "@T",
      "scopeDepth": 0,
      "decisionReason": "qualified_reference"
    }
  },
  {
    "location": { "name": "GeoPoint.Lat" },
    "inputs": [{ "name": "GeoPoint.Lat", "resolution": "unresolved" }],
    "decision": {
      "owner": "@T",
      "scopeDepth": 0,
      "decisionReason": "qualified_reference"
    }
  }
]
```

`decisionReason` values:

- `qualified_reference`
- `single_scope_owner`
- `single_candidate_promotion`
- `ambiguous_candidates`
- `unresolved_external`
- `non_column`

This is intended as parser truth for local ownership/ambiguity so LSP clients do not need to re-run scope-walk heuristics.

## Property Access Semantic Contract

`analyze(sql).columns.propertyAccesses[]` surfaces explicit member/property-access semantics for identifier chains.
Using the sample SQL above:

```json
{
  "location": { "name": "GeoPoint.Lat", "start": 22, "end": 34 },
  "baseExpr": "GeoPoint",
  "member": "Lat",
  "resolutionMode": "local_typed_member",
  "owner": "@T",
  "dataType": "GEOGRAPHY",
  "memberType": "FLOAT"
}
```

`resolutionMode` values:

- `local_typed_member`
- `local_untyped_member`
- `shape_member`

This helps LSP clients classify `base.member` access without misclassifying all dotted identifiers as table-qualified columns.

Parser-native built-in member coverage is intentionally focused on common enterprise usage:

- `GEOGRAPHY` (core): `Lat`, `Long`, `STSrid`, `STDistance`, `STIntersects`, `STContains`, `STWithin`, `STBuffer`, `STAsText`, `ToString`
- `GEOMETRY` (core): `STSrid`, `STDistance`, `STIntersects`, `STContains`, `STWithin`, `STBuffer`, `STArea`, `STLength`, `STAsText`, `ToString`
- `XML` (core): `value`, `query`, `exist`, `nodes`, `modify`
- `hierarchyid` (core): `GetAncestor`, `GetDescendant`, `GetLevel`, `IsDescendantOf`, `ToString`

## Scope Symbol Column Metadata

Scope symbols for local tabular shapes now expose structured column metadata.

- `columns: string[]` (legacy compatibility)
- `localColumns: Array<{ rawName, normalizedName, dataType?, location? }>` (canonical)

This applies to:

- declared table variables (`DECLARE @T TABLE (...)`)
- local temp/typed table symbols created in-file
- TVP-backed and table-variable aliases where local shape is known

Using the sample SQL above, `scope.root.resolve('@T')`:

```json
{
  "sql": "DECLARE @T TABLE ( StoreId INT, GeoPoint GEOGRAPHY, StoreName VARCHAR(100) )",
  "name": "@T",
  "kind": "Table",
  "columns": ["StoreId", "GeoPoint", "StoreName"],
  "localColumns": [
    {
      "rawName": "StoreId",
      "normalizedName": "storeid",
      "dataType": "INT"
    },
    {
      "rawName": "GeoPoint",
      "normalizedName": "geopoint",
      "dataType": "GEOGRAPHY",
      "typeMembers": [
        { "name": "Lat", "kind": "property", "returnType": "FLOAT" },
        { "name": "Long", "kind": "property", "returnType": "FLOAT" },
        { "name": "STAsText", "kind": "method", "returnType": "NVARCHAR(MAX)" }
      ]
    },
    {
      "rawName": "StoreName",
      "normalizedName": "storename",
      "dataType": "VARCHAR(100)"
    }
  ]
}
```

---

# Coverage Scorecard

<p>
<b>Everyday TSQL coverage:</b> 92-94% <br>

<b>Full T-SQL grammer coverage:</b> ~78%<br>
<b>Strongest areas:</b> expressions, SELECT grammar, procedural T-SQL, error recovery<br>
<b>Largest gaps:</b> Azure-native DDL, advanced DDL/storage syntax, DCL, linked-server constructs
</p>

<table>
<tr>

<td width="25%" valign="top">

<h3>DQL / SELECT</h3>

<p><b>~92%</b></p>

Excellent coverage for core and advanced query grammar.

</td>

<td width="25%" valign="top">

<h3>DML</h3>

<p><b>~88%</b></p>

Strong support for INSERT, UPDATE, DELETE, MERGE, and OUTPUT.

</td>

<td width="25%" valign="top">

<h3>Expressions</h3>

<p><b>~95%</b></p>

Near-complete expression parser with precedence handling.

</td>

<td width="25%" valign="top">

<h3>Procedural T-SQL</h3>

<p><b>~90%</b></p>

Strong coverage for control flow, cursors, transactions, and error handling.

</td>

</tr>
<tr>

<td width="25%" valign="top">

<h3>DDL</h3>

<p><b>~62%</b></p>

Useful practical coverage, but not full SQL Server DDL depth.

</td>

<td width="25%" valign="top">

<h3>Azure SQL</h3>

<p><b>~30%</b></p>

JSON support is strong; Azure-native DDL is limited.

</td>

<td width="25%" valign="top">

<h3>Error Recovery</h3>

<p><b>~91%</b></p>

Systematic recovery boundaries for editor resilience.

</td>

<td width="25%" valign="top">

<h3>Overall</h3>

<p><b>~78%</b></p>

Strong everyday SQL Server parser coverage.

</td>

</tr>
</table>

---

# Grammar Coverage

SaralSQL focuses heavily on real-world SQL Server grammar used in enterprise stored procedures, ETL systems, and editor tooling.

<p>
<b>Legend:</b><br>
🟩 Full &nbsp;&nbsp;
🟨 Partial &nbsp;&nbsp;
🟥 Missing
</p>

<p>
<b>Estimated implementation coverage:</b><br>
~78% Full · major day-to-day T-SQL covered · Azure-native DDL still limited
</p>

---

<table>
<tr>

<td width="48%" valign="top">

<h3>DML — Queries</h3>

<table cellpadding="4">
<tr><td>SELECT column list</td><td><b>🟩 Full</b></td></tr>
<tr><td>SELECT DISTINCT</td><td><b>🟩 Full</b></td></tr>
<tr><td>TOP / TOP PERCENT</td><td><b>🟩 Full</b></td></tr>
<tr><td>TOP WITH TIES</td><td><b>🟩 Full</b></td></tr>
<tr><td>SELECT INTO</td><td><b>🟩 Full</b></td></tr>
<tr><td>FROM</td><td><b>🟩 Full</b></td></tr>
<tr><td>WHERE</td><td><b>🟩 Full</b></td></tr>
<tr><td>GROUP BY</td><td><b>🟩 Full</b></td></tr>
<tr><td>HAVING</td><td><b>🟩 Full</b></td></tr>
<tr><td>ORDER BY</td><td><b>🟩 Full</b></td></tr>
<tr><td>OFFSET / FETCH NEXT</td><td><b>🟩 Full</b></td></tr>
<tr><td>FOR JSON / FOR XML</td><td><b>🟩 Full</b></td></tr>
<tr><td>UNION / EXCEPT / INTERSECT</td><td><b>🟩 Full</b></td></tr>
<tr><td>OPTION query hints</td><td><b>🟩 Full</b></td></tr>
<tr><td>GROUPING SETS / ROLLUP / CUBE</td><td><b>🟥 Missing</b></td></tr>
<tr><td>TABLESAMPLE</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

<td width="48%" valign="top">

<h3>DML — Write</h3>

<table cellpadding="4">
<tr><td>INSERT VALUES</td><td><b>🟩 Full</b></td></tr>
<tr><td>INSERT SELECT</td><td><b>🟩 Full</b></td></tr>
<tr><td>INSERT column list</td><td><b>🟩 Full</b></td></tr>
<tr><td>INSERT OUTPUT</td><td><b>🟩 Full</b></td></tr>
<tr><td>INSERT DEFAULT VALUES</td><td><b>🟨 Partial</b></td></tr>
<tr><td>INSERT EXEC</td><td><b>🟥 Missing</b></td></tr>
<tr><td>UPDATE SET</td><td><b>🟩 Full</b></td></tr>
<tr><td>UPDATE FROM / WHERE</td><td><b>🟩 Full</b></td></tr>
<tr><td>UPDATE TOP</td><td><b>🟩 Full</b></td></tr>
<tr><td>UPDATE OUTPUT</td><td><b>🟩 Full</b></td></tr>
<tr><td>UPDATE STATISTICS</td><td><b>🟩 Full</b></td></tr>
<tr><td>DELETE FROM / WHERE</td><td><b>🟩 Full</b></td></tr>
<tr><td>DELETE TOP</td><td><b>🟩 Full</b></td></tr>
<tr><td>DELETE OUTPUT</td><td><b>🟩 Full</b></td></tr>
<tr><td>MERGE all WHEN clauses</td><td><b>🟩 Full</b></td></tr>
<tr><td>MERGE OUTPUT / OPTION</td><td><b>🟩 Full</b></td></tr>
<tr><td>TRUNCATE TABLE</td><td><b>🟩 Full</b></td></tr>
</table>

</td>

</tr>
</table>

---

<table>
<tr>

<td width="48%" valign="top">

<h3>Joins & Table References</h3>

<table cellpadding="4">
<tr><td>INNER JOIN</td><td><b>🟩 Full</b></td></tr>
<tr><td>LEFT / RIGHT / FULL JOIN</td><td><b>🟩 Full</b></td></tr>
<tr><td>CROSS JOIN</td><td><b>🟩 Full</b></td></tr>
<tr><td>CROSS APPLY</td><td><b>🟩 Full</b></td></tr>
<tr><td>OUTER APPLY</td><td><b>🟩 Full</b></td></tr>
<tr><td>Hash / Merge / Loop join hints</td><td><b>🟩 Full</b></td></tr>
<tr><td>Table hints WITH (...)</td><td><b>🟩 Full</b></td></tr>
<tr><td>Subquery / derived table</td><td><b>🟩 Full</b></td></tr>
<tr><td>Table-valued functions</td><td><b>🟩 Full</b></td></tr>
<tr><td>OPENJSON WITH</td><td><b>🟩 Full</b></td></tr>
<tr><td>PIVOT / UNPIVOT</td><td><b>🟩 Full</b></td></tr>
<tr><td>Parenthesized join groups</td><td><b>🟩 Full</b></td></tr>
<tr><td>Four-part names</td><td><b>🟩 Full</b></td></tr>
<tr><td>Temp tables # / ##</td><td><b>🟩 Full</b></td></tr>
<tr><td>OPENROWSET</td><td><b>🟥 Missing</b></td></tr>
<tr><td>OPENQUERY / OPENDATASOURCE</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

<td width="48%" valign="top">

<h3>Expressions</h3>

<table cellpadding="4">
<tr><td>Arithmetic operators</td><td><b>🟩 Full</b></td></tr>
<tr><td>Bitwise operators</td><td><b>🟩 Full</b></td></tr>
<tr><td>Comparison operators</td><td><b>🟩 Full</b></td></tr>
<tr><td>AND / OR / NOT</td><td><b>🟩 Full</b></td></tr>
<tr><td>IS NULL / IS NOT NULL</td><td><b>🟩 Full</b></td></tr>
<tr><td>LIKE / NOT LIKE</td><td><b>🟩 Full</b></td></tr>
<tr><td>LIKE ESCAPE</td><td><b>🟥 Missing</b></td></tr>
<tr><td>IN / NOT IN</td><td><b>🟩 Full</b></td></tr>
<tr><td>BETWEEN / NOT BETWEEN</td><td><b>🟩 Full</b></td></tr>
<tr><td>EXISTS / NOT EXISTS</td><td><b>🟩 Full</b></td></tr>
<tr><td>CASE searched + simple</td><td><b>🟩 Full</b></td></tr>
<tr><td>CAST / TRY_CAST</td><td><b>🟩 Full</b></td></tr>
<tr><td>CONVERT with style</td><td><b>🟩 Full</b></td></tr>
<tr><td>PARSE / TRY_PARSE</td><td><b>🟩 Full</b></td></tr>
<tr><td>Function calls</td><td><b>🟩 Full</b></td></tr>
<tr><td>Aggregate DISTINCT</td><td><b>🟩 Full</b></td></tr>
<tr><td>WITHIN GROUP</td><td><b>🟩 Full</b></td></tr>
<tr><td>Variables and system variables</td><td><b>🟩 Full</b></td></tr>
<tr><td>COLLATE</td><td><b>🟨 Partial</b></td></tr>
<tr><td>IIF / CHOOSE</td><td><b>🟨 Partial</b></td></tr>
<tr><td>AT TIME ZONE</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

</tr>
</table>

---

<table>
<tr>

<td width="48%" valign="top">

<h3>Window Functions</h3>

<table cellpadding="4">
<tr><td>OVER (...)</td><td><b>🟩 Full</b></td></tr>
<tr><td>PARTITION BY</td><td><b>🟩 Full</b></td></tr>
<tr><td>ORDER BY in OVER</td><td><b>🟩 Full</b></td></tr>
<tr><td>ROWS frame</td><td><b>🟩 Full</b></td></tr>
<tr><td>RANGE frame</td><td><b>🟩 Full</b></td></tr>
<tr><td>UNBOUNDED PRECEDING</td><td><b>🟩 Full</b></td></tr>
<tr><td>UNBOUNDED FOLLOWING</td><td><b>🟩 Full</b></td></tr>
<tr><td>CURRENT ROW</td><td><b>🟩 Full</b></td></tr>
<tr><td>N PRECEDING / N FOLLOWING</td><td><b>🟩 Full</b></td></tr>
<tr><td>BETWEEN ... AND frame</td><td><b>🟩 Full</b></td></tr>
</table>

</td>

<td width="48%" valign="top">

<h3>Subqueries, CTEs & Set Operators</h3>

<table cellpadding="4">
<tr><td>Scalar subquery</td><td><b>🟩 Full</b></td></tr>
<tr><td>Derived table subquery</td><td><b>🟩 Full</b></td></tr>
<tr><td>WITH ... AS CTE</td><td><b>🟩 Full</b></td></tr>
<tr><td>Multiple CTEs</td><td><b>🟩 Full</b></td></tr>
<tr><td>CTE before DML</td><td><b>🟩 Full</b></td></tr>
<tr><td>Recursive CTE syntax</td><td><b>🟨 Partial</b></td></tr>
<tr><td>UNION / UNION ALL</td><td><b>🟩 Full</b></td></tr>
<tr><td>EXCEPT</td><td><b>🟩 Full</b></td></tr>
<tr><td>INTERSECT</td><td><b>🟩 Full</b></td></tr>
<tr><td>Nested set operators</td><td><b>🟩 Full</b></td></tr>
<tr><td>Parenthesized set queries</td><td><b>🟩 Full</b></td></tr>
</table>

</td>

</tr>
</table>

---

<table>
<tr>

<td width="48%" valign="top">

<h3>DDL & Maintenance</h3>

<table cellpadding="4">
<tr><td>CREATE TABLE</td><td><b>🟩 Full</b></td></tr>
<tr><td>Column data types</td><td><b>🟩 Full</b></td></tr>
<tr><td>NULL / NOT NULL</td><td><b>🟩 Full</b></td></tr>
<tr><td>PRIMARY KEY</td><td><b>🟩 Full</b></td></tr>
<tr><td>FOREIGN KEY</td><td><b>🟩 Full</b></td></tr>
<tr><td>FK ON DELETE / ON UPDATE actions</td><td><b>🟩 Full</b></td></tr>
<tr><td>UNIQUE / CHECK / DEFAULT</td><td><b>🟩 Full</b></td></tr>
<tr><td>IDENTITY</td><td><b>🟩 Full</b></td></tr>
<tr><td>Computed columns</td><td><b>🟩 Full</b></td></tr>
<tr><td>PERSISTED computed columns</td><td><b>🟩 Full</b></td></tr>
<tr><td>Named constraints</td><td><b>🟩 Full</b></td></tr>
<tr><td>CREATE PROCEDURE</td><td><b>🟩 Full</b></td></tr>
<tr><td>CREATE FUNCTION</td><td><b>🟩 Full</b></td></tr>
<tr><td>CREATE VIEW</td><td><b>🟩 Full</b></td></tr>
<tr><td>CREATE TYPE AS TABLE</td><td><b>🟩 Full</b></td></tr>
<tr><td>CREATE INDEX</td><td><b>🟩 Full</b></td></tr>
<tr><td>ALTER INDEX</td><td><b>🟩 Full</b></td></tr>
<tr><td>UPDATE STATISTICS</td><td><b>🟩 Full</b></td></tr>
<tr><td>DROP IF EXISTS</td><td><b>🟩 Full</b></td></tr>
<tr><td>ALTER TABLE advanced actions</td><td><b>🟨 Partial</b></td></tr>
<tr><td>CREATE TRIGGER</td><td><b>🟨 Partial</b></td></tr>
<tr><td>Advanced storage options</td><td><b>🟨 Partial</b></td></tr>
<tr><td>CREATE TABLE AS SELECT</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Columnstore indexes</td><td><b>🟥 Missing</b></td></tr>
<tr><td>GRANT / REVOKE / DENY</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

<td width="48%" valign="top">

<h3>Procedural T-SQL</h3>

<table cellpadding="4">
<tr><td>DECLARE variables</td><td><b>🟩 Full</b></td></tr>
<tr><td>DECLARE table variables</td><td><b>🟩 Full</b></td></tr>
<tr><td>SET @var = expr</td><td><b>🟩 Full</b></td></tr>
<tr><td>SET session options</td><td><b>🟩 Full</b></td></tr>
<tr><td>PRINT</td><td><b>🟩 Full</b></td></tr>
<tr><td>RETURN</td><td><b>🟩 Full</b></td></tr>
<tr><td>IF / ELSE</td><td><b>🟩 Full</b></td></tr>
<tr><td>BEGIN / END</td><td><b>🟩 Full</b></td></tr>
<tr><td>WHILE</td><td><b>🟩 Full</b></td></tr>
<tr><td>BREAK / CONTINUE</td><td><b>🟩 Full</b></td></tr>
<tr><td>GOTO / labels</td><td><b>🟩 Full</b></td></tr>
<tr><td>WAITFOR</td><td><b>🟩 Full</b></td></tr>
<tr><td>TRY / CATCH</td><td><b>🟩 Full</b></td></tr>
<tr><td>THROW</td><td><b>🟩 Full</b></td></tr>
<tr><td>RAISERROR</td><td><b>🟩 Full</b></td></tr>
<tr><td>Transactions</td><td><b>🟩 Full</b></td></tr>
<tr><td>Cursors</td><td><b>🟩 Full</b></td></tr>
<tr><td>EXEC procedure</td><td><b>🟩 Full</b></td></tr>
<tr><td>EXEC named parameters</td><td><b>🟩 Full</b></td></tr>
<tr><td>EXEC output parameters</td><td><b>🟩 Full</b></td></tr>
<tr><td>EXEC dynamic string</td><td><b>🟨 Partial</b></td></tr>
<tr><td>sp_executesql</td><td><b>🟨 Partial</b></td></tr>
<tr><td>EXEC AT linked_server</td><td><b>🟥 Missing</b></td></tr>
<tr><td>EXECUTE AS</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

</tr>
</table>

---

<table>
<tr>

<td width="48%" valign="top">

<h3>Azure SQL / Synapse</h3>

<table cellpadding="4">
<tr><td>OPENJSON WITH schema</td><td><b>🟩 Full</b></td></tr>
<tr><td>FOR JSON AUTO / PATH</td><td><b>🟩 Full</b></td></tr>
<tr><td>JSON_VALUE / JSON_QUERY / JSON_MODIFY</td><td><b>🟨 Partial</b></td></tr>
<tr><td>ISJSON</td><td><b>🟨 Partial</b></td></tr>
<tr><td>Temporal table DDL</td><td><b>🟥 Missing</b></td></tr>
<tr><td>FOR SYSTEM_TIME query syntax</td><td><b>🟥 Missing</b></td></tr>
<tr><td>SYSTEM_VERSIONING = ON</td><td><b>🟥 Missing</b></td></tr>
<tr><td>CREATE EXTERNAL TABLE</td><td><b>🟥 Missing</b></td></tr>
<tr><td>CREATE EXTERNAL DATA SOURCE</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Columnstore indexes</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Dynamic data masking</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Row-level security</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Ledger table syntax</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

<td width="48%" valign="top">

<h3>Semantic Features</h3>

<table cellpadding="4">
<tr><td>Variable scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>Parameter scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>Alias scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>CTE scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>Temp table scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>Table variable scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>PIVOT / UNPIVOT output scope</td><td><b>🟩 Full</b></td></tr>
<tr><td>Declaration extraction</td><td><b>🟩 Full</b></td></tr>
<tr><td>Dependency extraction</td><td><b>🟩 Full</b></td></tr>
<tr><td>Document symbols</td><td><b>🟩 Full</b></td></tr>
<tr><td>Completions</td><td><b>🟩 Full</b></td></tr>
<tr><td>Diagnostics</td><td><b>🟩 Full</b></td></tr>
<tr><td>Column lineage</td><td><b>🟩 Full</b></td></tr>
<tr><td>Workspace-wide schema catalog</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Database-backed wildcard expansion</td><td><b>🟥 Missing</b></td></tr>
<tr><td>Runtime type validation</td><td><b>🟥 Missing</b></td></tr>
</table>

</td>

</tr>
</table>

---

# Prioritized Coverage Gaps

<table>
<tr>

<td width="48%" valign="top">

<h3>P1 — High Impact</h3>

<table cellpadding="4">
<tr><td>GROUP BY ROLLUP / CUBE / GROUPING SETS</td></tr>
<tr><td>Temporal query syntax: FOR SYSTEM_TIME</td></tr>
<tr><td>AT TIME ZONE expression</td></tr>
<tr><td>COLUMNSTORE INDEX</td></tr>
</table>

</td>

<td width="48%" valign="top">

<h3>P2 — Important</h3>

<table cellpadding="4">
<tr><td>GRANT / REVOKE / DENY</td></tr>
<tr><td>Double-quoted identifiers</td></tr>
<tr><td>EXEC AT linked_server</td></tr>
<tr><td>EXECUTE AS USER / LOGIN / CALLER</td></tr>
<tr><td>OPENQUERY / OPENDATASOURCE</td></tr>
</table>

</td>

</tr>
</table>

---

# Current Diagnostics

SaralSQL focuses on high-signal diagnostics suitable for editors and code review.

## Variables & Parameters

- undeclared variables
- unused variables
- unused parameters

## DML Safety

- SELECT *
- self-comparisons such as `u.Id = u.Id`
- UPDATE without filters
- DELETE without filters
- UPDATE target with `WITH (NOLOCK)`

## DDL & Structure

- unbracketed keyword-like identifiers
- missing commas before table constraints
- suspicious hint usage
- OPTION clause guidance

Diagnostics are intentionally selective. The goal is to remain useful in enterprise SQL without overwhelming users with low-value warnings.

---

# Fault Tolerance Example

Input SQL:

```sql
SELECT *
FROM Users
WHERE
```

Expected behavior:

- partial AST is preserved
- parser issue is recorded
- scope graph remains usable where possible
- completion context can still be produced
- analysis continues for valid sections

This is a core design requirement for editor and LSP scenarios.

---

# Diagnostics Example

Input:

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

---

# Column Lineage Example

Input:

```sql
INSERT INTO dbo.InvoiceSummary (
    CustomerId,
    InvoiceMonth,
    TotalAmount
)
SELECT
    i.CustomerId,
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

---

# Lineage Metadata Example

`analyze(sql).lineage` also provides source exposure, ambiguity metadata, and mutation target metadata.

```json
{
  "sources": [
    {
      "name": "a",
      "alias": "a",
      "kind": "derived_subquery",
      "projection": [
        { "name": "SomeName" }
      ]
    }
  ],
  "ambiguities": [
    {
      "name": "Id",
      "candidates": ["Employee", "Department"]
    }
  ],
  "mutations": [
    {
      "statement": "UPDATE",
      "targetName": "e",
      "resolvedSourceName": "Employee"
    }
  ]
}
```

---

# SQLCMD Preprocessing

SaralSQL natively supports SQLCMD directives (`:setvar`, `:r`) and variable expansions (`$(Var)`).

All AST node coordinates and diagnostic offsets are automatically mapped back to the raw, unexpanded text, ensuring perfect LSP integration.

```ts
import { analyze, SqlCmdOptions } from '@saralsql/tsql-parser';

const sql = `
:setvar TableName "Users"

SELECT Id, Name
FROM $(TableName)
WHERE Id = @Id;
`;

const options: SqlCmdOptions = { 
  initialVariables: { 
    Environment: 'PROD' 
  } 
};

const result = analyze(sql, options);
```

---

# Architecture

```text
Lexer
→ Parser
→ ScopeBuilder
→ LineageBuilder
→ ColumnAnalyzer
→ DiagnosticEngine
```

## Design Principles

```text
Parse once
Enrich in layers
Reuse semantic graph
Avoid duplicate logic
Recover locally
Keep editor tooling alive
```

---

# Non-goals

SaralSQL is intentionally a single-document analysis engine.

It does not currently provide:

- cross-file schema catalogs
- workspace-wide symbol resolution
- metadata-backed wildcard expansion
- live database-backed type validation
- execution-plan validation

Those belong in:

- the host LSP
- external metadata services
- workspace analysis layers

---

# Roadmap

## Near Term

- broader corpus validation
- richer diagnostics
- automated code fixes
- improved DDL coverage
- Azure SQL grammar expansion

## Medium Term

- schema-aware resolution
- wildcard expansion
- FK-aware navigation
- metadata catalogs
- standards enforcement packs

## Long Term

- semantic autocomplete
- rename symbol
- find references
- impact analysis
- safe refactors
- AI-assisted SQL correction

---

# Contributing

Useful bug reports should include:

- isolated SQL sample
- expected behavior
- current parser output
- parser issue or diagnostic output
- package version

---

# License

MIT

Built by Saral Simon Stalin
