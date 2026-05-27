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
    ASTNode, NodeLocation, TableReference, JoinNode, JoinType,
    ColumnNode, ColumnDefinition, ParameterDefinition,
    QueryStatement
} from './ast/types';

export { analyze } from './analyze';
export type { AnalysisResult } from './analyze';

export {
    collectNodes,
    findFirst,
    findNodeAt,
    findParent,
    getChildren,
    walkAST
} from './ast/astWalker';
export type { ASTVisitor } from './ast/astWalker';

export { getDocumentSymbols } from './documentSymbols';
export type { DocumentSymbol, DocumentSymbolKind } from './documentSymbols';

export { getCompletionContext, getCompletionsAt } from './completions';
export type {
    CompletionContext,
    CompletionItem,
    CompletionItemKind
} from './completions';

export {
    extractDeclarations,
    extractDependencies,
    extractReferences
} from './extractors';
export type {
    ExtractedDeclaration,
    ExtractedDeclarationKind,
    ExtractedDependency,
    ExtractedReference,
    ExtractedReferenceContext,
    ExtractedReferenceKind
} from './extractors';

export {
    LineIndex,
    createLineIndex,
    locationToRange,
    offsetToPosition,
    positionToOffset
} from './position';
export type { Position, Range } from './position';

export { ScopeBuilder } from './semantic/scopeBuilder';
export type { ScopeBuilderResult, DuplicateDeclaration } from './semantic/scopeBuilder';

export { Scope } from './semantic/scope';
export type { Symbol, SymbolKind, SymbolReference, ReferenceKind, SymbolColumn, TypeMember } from './semantic/scope';

export { DiagnosticCode, diagnose } from './diagnostics/diagnostics';
export type { Diagnostic, DiagnosticSeverity } from './diagnostics/diagnostics';

export { LineageBuilder } from './lineage/lineageBuilder';
export type {
    LineageNode,
    DerivedColumn,
    VirtualSource,
    LineageSourceKind,
    SourceExposure,
    AmbiguityDiagnostic,
    MutationTarget,
    ReadScopeSource,
    ReadScopeExposure,
    LineageEdge,
    LineageResult
} from './lineage/lineage';

export { ColumnAnalyzer } from './semantic/columnAnalyzer';
export type { ColumnAnalysisResult, ColumnResolution, PropertyAccessResolution } from './semantic/columnAnalyzer';
export { getBuiltinTypeMembersCatalog, getTypeMembers, resolveTypeMember } from './semantic/typeMembers';

export { SqlCmdPreprocessor } from './parser/sqlcmdPreprocessor';
export type { SqlCmdOptions, PreprocessResult } from './parser/sqlcmdPreprocessor';
