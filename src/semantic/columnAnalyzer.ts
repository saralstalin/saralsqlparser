import {
    Program,
    Expression,
    IdentifierNode
} from '../ast/types';

import { LineageBuilder } from '../lineage/lineageBuilder';
import { LineageNode } from '../lineage/lineage';

// ---------------------------------------------
// Public types
// ---------------------------------------------
export interface ColumnResolution {
    location: IdentifierNode;
    inputs: LineageNode[];
    ambiguityCandidates?: string[];
    isCorrelated?: boolean;
}

export interface ColumnAnalysisResult {
    resolutions: ColumnResolution[];
}

// ---------------------------------------------
// Column Analyzer
// ---------------------------------------------
export class ColumnAnalyzer {
    private builder = new LineageBuilder();

    analyze(program: Program): ColumnAnalysisResult {
        // Build lineage once (important for performance + correctness)
        const lineage = this.builder.build(program);

        const resolutions: ColumnResolution[] = [];

        // Walk all derived columns from lineage
        for (const col of lineage.columns) {
            if (!col.expression) continue;

            this.collectIdentifiers(col.expression, (id) => {
                const inputs =
                    this.getIdentifierInputs(id, col.inputs);
                const ambiguityCandidates =
                    this.collectAmbiguityCandidates(inputs);

                resolutions.push({
                    location: id,
                    inputs,
                    ...(ambiguityCandidates.length
                        ? { ambiguityCandidates }
                        : {}),
                    isCorrelated:
                        id.parts.length >= 2 &&
                        inputs.some(input => input.resolution === 'resolved')
                });
            });
        }

        return { resolutions };
    }

    private collectAmbiguityCandidates(inputs: LineageNode[]): string[] {
        const seen = new Set<string>();
        const candidates: string[] = [];

        for (const input of inputs) {
            for (const candidate of input.candidateSources ?? []) {
                const key = candidate.toLowerCase();
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                candidates.push(candidate);
            }
        }

        return candidates;
    }

    private getIdentifierInputs(
        identifier: IdentifierNode,
        columnInputs: LineageNode[]
    ): LineageNode[] {
        const matched = columnInputs.filter(input =>
            input.location &&
            input.location.start === identifier.start &&
            input.location.end === identifier.end
        );

        if (matched.length > 0) {
            return matched;
        }

        return columnInputs;
    }

    // -----------------------------------------
    // Expression traversal (NULL SAFE)
    // -----------------------------------------

    private collectIdentifiers(
        expr: Expression | null | undefined,
        cb: (id: IdentifierNode) => void
    ): void {
        if (!expr) return;

        switch (expr.type) {
            case 'Identifier':
                cb(expr);
                return;

            case 'BinaryExpression':
                this.collectIdentifiers(expr.left, cb);
                this.collectIdentifiers(expr.right, cb); // can be null
                return;

            case 'UnaryExpression':
                this.collectIdentifiers(expr.right, cb); // can be null
                return;

            case 'GroupingExpression':
                this.collectIdentifiers(expr.expression, cb); // can be null
                return;

            case 'FunctionCall':
                for (const arg of expr.args) {
                    this.collectIdentifiers(arg, cb);
                }
                return;

            case 'ValuesTableExpression':
                for (const row of expr.rows) {
                    for (const value of row) {
                        this.collectIdentifiers(value, cb);
                    }
                }
                return;

            case 'CaseExpression':
                if (expr.input) {
                    this.collectIdentifiers(expr.input, cb);
                }

                for (const branch of expr.branches) {
                    this.collectIdentifiers(branch.when, cb); // nullable
                    this.collectIdentifiers(branch.then, cb); // nullable
                }

                if (expr.elseBranch) {
                    this.collectIdentifiers(expr.elseBranch, cb);
                }
                return;

            // ✅ FIXED: InExpression (your actual shape)
            case 'InExpression':
                this.collectIdentifiers(expr.left, cb);

                if (expr.list) {
                    for (const item of expr.list) {
                        this.collectIdentifiers(item, cb);
                    }
                }

                // subquery intentionally ignored (handled by lineage)
                return;

            // ✅ FIXED: BetweenExpression (your actual shape)
            case 'BetweenExpression':
                this.collectIdentifiers(expr.left, cb);
                this.collectIdentifiers(expr.lowerBound, cb);
                this.collectIdentifiers(expr.upperBound, cb);
                return;

            case 'MemberExpression':
                this.collectIdentifiers(expr.object, cb);
                return;

            case 'OverExpression':
                this.collectIdentifiers(expr.expression, cb);

                if (expr.window.partitionBy) {
                    for (const p of expr.window.partitionBy) {
                        this.collectIdentifiers(p, cb);
                    }
                }

                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.collectIdentifiers(o.expression, cb);
                    }
                }

                return;

            case 'SubqueryExpression':
                // handled elsewhere
                return;

            case 'WildcardExpression':
                // no identifiers to collect
                return;

            case 'Literal':
                return;

            case 'Variable':
                return;

            default:
                return;
        }
    }
}
