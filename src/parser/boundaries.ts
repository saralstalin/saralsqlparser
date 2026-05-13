import { Token, TokenType } from './lexer';
import {
    ALIAS_STOP_KEYWORDS,
    JoinKeyword,
    JoinKeywords
} from './grammar';

export function canStartAlias(token?: Token): boolean {
    if (!token) {
        return false;
    }

    if (
        token.type !== TokenType.Identifier &&
        token.type !== TokenType.Keyword
    ) {
        return false;
    }

    return !ALIAS_STOP_KEYWORDS.has(token.value);
}

export function isJoinToken(token: Token | undefined): boolean {
    if (!token) return false;

    return Object.values(JoinKeywords)
        .includes(token.value as JoinKeyword);
}

export function isFromBoundary(token?: Token): boolean {
    if (!token) return true;

    return [
        'WHERE',
        'GROUP',
        'HAVING',
        'ORDER',
        'UNION',
        'EXCEPT',
        'INTERSECT',
        'FOR',
        'OPTION',
        'OFFSET',
        'FETCH'
    ].includes(token.value);
}

export function isClauseBoundary(token?: Token): boolean {
    if (!token) {
        return true;
    }

    if (
        token.type === TokenType.Semicolon ||
        token.type === TokenType.CloseParen
    ) {
        return true;
    }

    return [
        'FROM',
        'WHERE',
        'GROUP',
        'HAVING',
        'ORDER',
        'UNION',
        'EXCEPT',
        'INTERSECT',
        'JOIN',
        'ON',
        'APPLY',
        'FOR',
        'OPTION',
        'OFFSET',
        'FETCH',
        'OUTPUT',
        'RANGE',
        'ROWS'
    ].includes(token.value);
}

export function isInsertRecoveryBoundary(token?: Token): boolean {
    if (!token) {
        return true;
    }

    return (
        token.type === TokenType.Semicolon ||
        token.type === TokenType.CloseParen ||
        token.type === TokenType.Comma
    );
}

export function isSetOperator(token: Token | null): boolean {
    if (!token || token.type !== TokenType.Keyword) return false;

    const val = token.value;
    return val === 'UNION' || val === 'EXCEPT' || val === 'INTERSECT';
}

export function isMergeBoundary(token?: Token): boolean {
    if (!token) return true;

    return (
        token.type === TokenType.Semicolon ||
        token.value === 'WHEN' ||
        token.value === 'OUTPUT' ||
        token.value === 'OPTION'
    );
}
