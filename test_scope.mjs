import { Lexer, Parser } from './dist/src/index.js';

const sql = `INSERT INTO T VALUES (; SELECT 1;`;

const lexer = new Lexer(sql);
const parser = new Parser(lexer);
const ast = parser.parse().ast;

console.log('Body types:', ast.body.map(s => s.type));