import { Program, ParseIssue } from './ast/types';
import { Diagnostic, diagnose } from './diagnostics/diagnostics';
import { Lexer } from './parser/lexer';
import { Parser } from './parser/parser';
import { LineageResult } from './lineage/lineage';
import { LineageBuilder } from './lineage/lineageBuilder';
import { ColumnAnalysisResult, ColumnAnalyzer } from './semantic/columnAnalyzer';
import { ScopeBuilder, ScopeBuilderResult } from './semantic/scopeBuilder';

export type AnalysisDiagnosticSource = 'parser' | 'semantic';

export interface AnalysisDiagnostic {
    source: AnalysisDiagnosticSource;
    code: string;
    message: string;
    severity: Diagnostic['severity'];
    start: number;
    end: number;
}

export interface AnalysisResult {
    ast: Program;
    issues: ParseIssue[];
    scope: ScopeBuilderResult;
    semanticDiagnostics: Diagnostic[];
    diagnostics: AnalysisDiagnostic[];
    lineage: LineageResult;
    columns: ColumnAnalysisResult;
}

export function analyze(sql: string): AnalysisResult {
    const parseResult = new Parser(new Lexer(sql)).parse();
    const scope = new ScopeBuilder().build(parseResult.ast);
    const semanticDiagnostics = diagnose(parseResult.ast, scope);
    const lineage = new LineageBuilder().build(parseResult.ast);
    const columns = new ColumnAnalyzer().analyze(parseResult.ast);
    const issues = parseResult.issues ?? [];

    return {
        ast: parseResult.ast,
        issues,
        scope,
        semanticDiagnostics,
        diagnostics: combineDiagnostics(issues, semanticDiagnostics),
        lineage,
        columns
    };
}

function combineDiagnostics(
    issues: ParseIssue[],
    semanticDiagnostics: Diagnostic[]
): AnalysisDiagnostic[] {
    return [
        ...issues.map(issue => ({
            source: 'parser' as const,
            code: issue.code,
            message: issue.message,
            severity: 'error' as const,
            start: issue.start,
            end: issue.end
        })),
        ...semanticDiagnostics.map(diagnostic => ({
            source: 'semantic' as const,
            code: diagnostic.code,
            message: diagnostic.message,
            severity: diagnostic.severity,
            start: diagnostic.start,
            end: diagnostic.end
        }))
    ].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        if (a.end !== b.end) return a.end - b.end;
        return a.source.localeCompare(b.source);
    });
}
