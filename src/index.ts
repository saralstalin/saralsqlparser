export { Lexer } from './lexer';
export type { Token, TokenType } from './lexer';

export { Parser } from './parser';
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
} from './parser';

export { ScopeBuilder } from './scopeBuilder';
export type { ScopeBuilderResult, DuplicateDeclaration } from './scopeBuilder';

export { Scope } from './scope';
export type { Symbol, SymbolKind, SymbolReference, ReferenceKind } from './scope';

export { diagnose } from './diagnostics';
export type { Diagnostic, DiagnosticSeverity, DiagnosticCode } from './diagnostics';

export { LineageBuilder } from './lineageBuilder';
export type {
    LineageNode,
    DerivedColumn,
    VirtualSource,
    LineageEdge,
    LineageResult
} from './lineage';