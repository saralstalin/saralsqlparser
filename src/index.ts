export { Lexer } from './parser/lexer';
export type { Token, TokenType } from './parser/lexer';

export { Parser } from './parser/parser';
export type {
    ParseResult,
    Program,
    Statement,
    Expression,
    // All node types a consumer might use
    SelectNode, InsertNode, UpdateNode, DeleteNode,
    DeclareNode, SetNode, CreateNode, WithNode,
    IfNode, BlockNode, PrintNode, ErrorNode,
    // Expression nodes
    BinaryExpression, UnaryExpression, LiteralNode,
    IdentifierNode, VariableNode, FunctionCallNode,
    CaseExpression, InExpression, BetweenExpression,
    GroupingExpression, SubqueryExpression, OverExpression,
    MemberExpression, WildcardExpression,
    // Structural
    NodeLocation, TableReference, JoinNode, JoinType,
    ColumnNode, ColumnDefinition, ParameterDefinition,
    QueryStatement
} from '@/ast/types';

export { ScopeBuilder } from './semantic/scopeBuilder';
export type { ScopeBuilderResult, DuplicateDeclaration } from './semantic/scopeBuilder';

export { Scope } from './semantic/scope';
export type { Symbol, SymbolKind, SymbolReference, ReferenceKind } from './semantic/scope';

export { diagnose } from './diagnostics/diagnostics';
export type { Diagnostic, DiagnosticSeverity, DiagnosticCode } from './diagnostics/diagnostics';

export { LineageBuilder } from './lineage/lineageBuilder';
export type {
    LineageNode,
    DerivedColumn,
    VirtualSource,
    LineageEdge,
    LineageResult
} from './lineage/lineage';

export { ColumnAnalyzer } from './semantic/columnAnalyzer';
export type { ColumnResolution } from './semantic/columnAnalyzer';