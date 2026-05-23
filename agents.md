# AI Agent Context: SaralSQL T-SQL Parser

## 🎯 Project Overview
`@saralsql/tsql-parser` is a high-fidelity, fault-tolerant parser and semantic analysis engine built specifically for Microsoft SQL Server T-SQL. 
Unlike typical query-transformation parsers, SaralSQL is designed entirely around **Language Server Protocol (LSP)**, editor tooling, diagnostics, lineage tracking, and enterprise SQL static analysis.

**Author**: Saral Simon Stalin
**Stack**: TypeScript, Node.js, Jest

## 🏗️ Architecture Pipeline
The analysis process follows a strict, layered, single-document pipeline:

1. **Lexer** (`src/parser/lexer.ts`): Tokenizes raw T-SQL strings into tokens.
2. **Parser** (`src/parser/parser.ts`): A fault-tolerant recursive descent parser that produces an Abstract Syntax Tree (AST).
3. **ScopeBuilder** (`src/semantic/scopeBuilder.ts`): Traverses the AST to map out variable, parameter, alias, CTE, and temp table scopes.
4. **LineageBuilder**: Determines column dependencies and data movement edges.
5. **ColumnAnalyzer**: Resolves column ambiguities and correlation flags.
6. **DiagnosticEngine** (`src/diagnostics/diagnostics.ts`): Emits high-signal, safe semantics and structural diagnostics (e.g., `VAR001`, `DML001`).

## 🛑 Core Design Principles
When contributing code or analyzing this repository, adhere to the following principles:

1. **Fault Tolerance is Non-Negotiable**: 
   The parser must *never* crash on malformed SQL. Real-time editor scenarios require the parser to gracefully recover, preserve partial AST structures, and flag localized errors without halting the entire parsing operation.
2. **Parse Once, Enrich in Layers**: 
   Avoid duplicating logic. Build the AST first, then enrich it using the layered builders (Scope, Lineage, Diagnostics).
3. **Editor-Safe Recovery**: 
   Always keep the host tooling alive. If an unrecognized token appears, generate an incomplete node, capture the error within the node (`incomplete: true`, `errors: [...]`), and move forward.
4. **High-Signal Diagnostics**: 
   Diagnostics must be selective and high-signal (e.g., SELECT *, UPDATE without WHERE, Unused parameters). Avoid emitting low-value or pedantic warnings that would overwhelm enterprise users.
5. **Single Document Boundaries**: 
   Do not attempt to resolve cross-file schema catalogs or live database type validation here. SaralSQL is purely an in-memory, single-document analysis engine. Cross-file resolution belongs to the host LSP.

## 🧩 Key Data Structures
- **AST Nodes** (`src/ast/types.ts`): e.g., `SelectNode`, `UpdateNode`, `CreateNode`. All nodes track source position (`start`, `end`).
- **Scope** (`src/semantic/scope.ts`): Represents a lexical block containing `Symbol` definitions. Useful for resolving `SymbolKind` (Variable, Parameter, Alias, CTE).
- **Diagnostics**: Contain `DiagnosticCode` (e.g., `VAR001`), `severity` (error, warning, info), `message`, and position (`start`, `end`).
- **DocumentSymbol** (`src/documentSymbols.ts`): Maps AST nodes to LSP-compatible document symbols (used for file outlines and navigation).

## 🧪 Testing Guidelines
- The test suite is built on **Jest**.
- **Testing Strategy**: All changes must have a regression test and should also pass full test suite.
- **Corpus Strategy**: Ensure coverage for everyday T-SQL, procedural logic, mixed DDL/DML batches, and complex edge cases (e.g., Microsoft complex corpus).
- **Fault-Tolerance Testing**: Always include tests that mimic incomplete live-typing (e.g., `SELECT Name, FROM Users;`) to verify AST recovery.
- **Diagnostic Testing**: Check for exact diagnostic codes, severities, and text spans.

## 📝 Conventions
- Use strict TypeScript typing.
- Offset positions (`start`, `end`) are critical for LSP integration. Ensure every new node type accurately captures the string span of its underlying token(s).
- Follow naming conventions for Diagnostic Codes (e.g., `VAR###` for variables, `DML###` for operations, `DDL###` for schema, `SEL###` for queries).