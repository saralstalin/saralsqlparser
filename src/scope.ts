import { NodeLocation } from './parser';

export enum SymbolKind {
    Variable = 'Variable',
    Parameter = 'Parameter',
    Table = 'Table',
    Column = 'Column',
    Alias = 'Alias',
    CTE = 'CTE',
    Procedure = 'Procedure',
    Function = 'Function',
    TempTable = 'TempTable',
    Type = 'Type'
}

export interface Symbol {
    name: string;
    kind: SymbolKind;
    dataType?: string;
    columns?: string[];
    location: NodeLocation;
    metadata?: Record<string, unknown>;
}

export class Scope {
    private readonly symbols = new Map<string, Symbol>();
    private readonly children: Scope[] = [];

    getChildren(): readonly Scope[] { return this.children; }

    constructor(
        public readonly start: number,
        public readonly end: number,
        public readonly parent: Scope | null = null,
        public readonly name?: string
    ) {
        if (parent) {
            parent.children.push(this);
        }
    }

    define(symbol: Symbol): void {
        this.symbols.set(symbol.name.toLowerCase(), symbol);
    }

    resolveLocal(name: string): Symbol | undefined {
        return this.symbols.get(name.toLowerCase());
    }

    resolve(name: string): Symbol | undefined {
        const key = name.toLowerCase();

        let scope: Scope | null = this;
        while (scope) {
            const found = scope.symbols.get(key);
            if (found) return found;
            scope = scope.parent;
        }

        return undefined;
    }

    contains(offset: number): boolean {
        return offset >= this.start && offset <= this.end;
    }

    findInnermost(offset: number): Scope {
        for (const child of this.children) {
            if (child.contains(offset)) {
                return child.findInnermost(offset);
            }
        }

        return this;
    }

    getVisibleSymbols(): Symbol[] {
        const merged = new Map<string, Symbol>();

        let scope: Scope | null = this;
        while (scope) {
            for (const [k, v] of scope.symbols) {
                if (!merged.has(k)) {
                    merged.set(k, v);
                }
            }
            scope = scope.parent;
        }

        return [...merged.values()];
    }
}
