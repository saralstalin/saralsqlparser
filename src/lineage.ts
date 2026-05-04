import { Expression, NodeLocation } from './parser';

export type LineageNodeKind =
    | 'table'
    | 'column'
    | 'cte'
    | 'variable'
    | 'result';

export interface LineageNode {
    kind: LineageNodeKind;

    /**
     * Full identifier:
     *  Orders.Amount
     *  Customer.Name
     *  @BatchId
     *  *
     */
    name: string;

    /**
     * Owner:
     *  Orders
     *  Customer
     */
    source?: string;

    /**
     * True for:
     *  Orders.*
     */
    wildcard?: boolean;

    location?: NodeLocation;
}

export interface DerivedColumn {
    /**
     * Final output name
     */
    name: string;

    /**
     * Original expression
     */
    expression?: Expression;

    /**
     * Upstream inputs
     */
    inputs: LineageNode[];

    location: NodeLocation;
}

export interface VirtualSource {
    name: string;
    columns: Map<string, DerivedColumn>;
    wildcardSources: LineageNode[];
}

export interface LineageEdge {
    from: LineageNode;
    to: LineageNode;
    location: NodeLocation;
}

export interface LineageResult {
    columns: DerivedColumn[];
    edges: LineageEdge[];
}