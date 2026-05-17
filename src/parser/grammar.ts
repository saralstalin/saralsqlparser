import {
    CreateNode,
    DropNode,
    JoinType
} from '../ast/types';

export const JoinKeywords = {
    JOIN: 'JOIN',
    INNER: 'INNER',
    LEFT: 'LEFT',
    RIGHT: 'RIGHT',
    FULL: 'FULL',
    CROSS: 'CROSS',
    OUTER: 'OUTER',
    APPLY: 'APPLY',
    HASH: 'HASH',
    MERGE: 'MERGE',
    LOOP: 'LOOP'
} as const;

export type JoinKeyword =
    typeof JoinKeywords[keyof typeof JoinKeywords];

export const JoinTypes: Record<string, JoinType> = {
    INNER: 'INNER JOIN',
    LEFT_OUTER: 'LEFT OUTER JOIN',
    RIGHT_OUTER: 'RIGHT OUTER JOIN',
    FULL_OUTER: 'FULL OUTER JOIN',
    CROSS: 'CROSS JOIN',
    CROSS_APPLY: 'CROSS APPLY',
    OUTER_APPLY: 'OUTER APPLY',
};

export enum Precedence {
    LOWEST,
    OR,
    AND,
    NOT,
    COMPARE,
    SUM,
    PRODUCT,
    PREFIX,
    UNARY,
    CALL
}

export const STRUCTURAL_KEYWORDS = new Set([
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'CROSS',
    'HASH',
    'MERGE',
    'LOOP',
    'JOIN',

    'WHERE',
    'GROUP',
    'ORDER',
    'HAVING',

    'UNION',
    'ALL',
    'EXCEPT',
    'INTERSECT',

    'ON',
    'APPLY',
    'OUTER',

    'WITH',
    'FOR',
    'TABLESAMPLE',
    'PIVOT',
    'UNPIVOT'
]);

export const RESYNC_KEYWORDS = new Set([
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SET',
    'DECLARE', 'IF', 'BEGIN', 'CREATE', 'DROP', 'WITH', 'GO',
    'WHEN', 'THEN', 'ELSE', 'END', 'MERGE', 'PRINT', 'THROW',
    'BREAK', 'CONTINUE', 'TRY', 'RAISERROR', 'RETURN', 'EXEC', 'EXECUTE', 'WHILE', 'GOTO',
    'COMMIT', 'ROLLBACK', 'SAVE', 'TRANSACTION', 'DISTRIBUTED', 'TRAN', 'TRY', 'CATCH',
    'ALTER', 'TRUNCATE', 'VALUES', 'OUTPUT', 'FETCH', 'OFFSET', 'OPTION'
]);

export const ALIAS_STOP_KEYWORDS = new Set([
    ...STRUCTURAL_KEYWORDS,
    ...RESYNC_KEYWORDS
]);

export const CREATE_OBJECT_TYPES: Record<string, CreateNode['objectType']> = {
    TABLE: 'TABLE',
    VIEW: 'VIEW',
    PROCEDURE: 'PROCEDURE',
    FUNCTION: 'FUNCTION',
    TYPE: 'TYPE',
    TRIGGER: 'TRIGGER',
    SCHEMA: 'SCHEMA',
    SEQUENCE: 'SEQUENCE',
    SYNONYM: 'SYNONYM',
    PARTITION_FUNCTION: 'PARTITION_FUNCTION',
    PARTITION_SCHEME: 'PARTITION_SCHEME',
    PROC: 'PROCEDURE'
};

export const DROP_OBJECT_TYPES: Record<string, DropNode['objectType']> = {
    TABLE: 'TABLE',
    VIEW: 'VIEW',
    PROCEDURE: 'PROCEDURE',
    FUNCTION: 'FUNCTION',
    INDEX: 'INDEX',
    PROC: 'PROCEDURE'
};

export const PRECEDENCE_MAP: Record<string, Precedence> = {
    '.': Precedence.CALL,
    'OR': Precedence.OR,
    'AND': Precedence.AND,
    'NOT': Precedence.NOT,
    'IS': Precedence.COMPARE,
    'IN': Precedence.COMPARE,
    'BETWEEN': Precedence.COMPARE,
    'LIKE': Precedence.COMPARE,
    '=': Precedence.COMPARE,
    '<>': Precedence.COMPARE,
    '!=': Precedence.COMPARE,
    '<': Precedence.COMPARE,
    '>': Precedence.COMPARE,
    '>=': Precedence.COMPARE,
    '<=': Precedence.COMPARE,

    '&': Precedence.SUM,
    '|': Precedence.SUM,
    '^': Precedence.SUM,

    '+': Precedence.SUM,
    '-': Precedence.SUM,

    '*': Precedence.PRODUCT,
    '/': Precedence.PRODUCT,
    '%': Precedence.PRODUCT,

    'COLLATE': Precedence.CALL,
    '(': Precedence.CALL,
};
