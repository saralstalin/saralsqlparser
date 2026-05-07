import { Lexer, Parser } from './dist/src/index.js';

const sql = `SELECT Id INTO #Tmp FROM Users`;

const lexer = new Lexer(sql);
const parser = new Parser(lexer);
const result = parser.parse();
const ast = result.ast;

console.log('Body types:', ast.body.map(s => s.type));
console.log('First statement:', JSON.stringify(ast.body[0], null, 2));
if (result.issues && result.issues.length > 0) {
    console.log('Issues:', result.issues);
} else {
    console.log('No issues!');
}