const { performance } = require('node:perf_hooks');
const { Lexer } = require('../dist/src/parser/lexer.js');
const { Parser } = require('../dist/src/parser/parser.js');

function parseBuiltResult(sql) {
    return new Parser(
        new Lexer(sql)
    ).parse();
}

function buildMixedWorkload(iterations = 120) {
    const sqlParts = [];

    for (let i = 0; i < iterations; i++) {
        sqlParts.push(`
            DECLARE @Id${i} AS INT = ${i}
            DECLARE @Name${i} AS VARCHAR(100) = 'User${i}'

            IF NOT EXISTS (
                SELECT TOP 1 1
                FROM Users u
                WHERE u.Id = @Id${i}
            )
            BEGIN
                INSERT INTO Users (
                    Id,
                    Name,
                    CreatedAt
                )
                VALUES (
                    @Id${i},
                    @Name${i},
                    GETDATE()
                )
            END
            ELSE
            BEGIN
                UPDATE Users
                SET
                    Name =
                        CASE
                            WHEN ISNULL(@Name${i}, '') = ''
                                THEN 'Unknown'
                            ELSE @Name${i}
                        END,
                    ModifiedAt = GETDATE()
                WHERE Id = @Id${i}
            END

            SELECT
                u.Id,
                u.Name,
                CASE
                    WHEN u.Id % 2 = 0
                        THEN 'Even'
                    ELSE 'Odd'
                END AS Category,
                ROW_NUMBER() OVER (
                    PARTITION BY u.Name
                    ORDER BY u.Id
                ) AS RowNum
            FROM Users u
            WHERE EXISTS (
                SELECT 1
                FROM Orders o
                WHERE o.UserId = u.Id
            )

            WITH UserCTE AS (
                SELECT
                    Id,
                    Name
                FROM Users
                WHERE Id = @Id${i}
            )
            SELECT *
            FROM UserCTE

            BEGIN TRANSACTION

            UPDATE Users
            SET Name = 'Updated${i}'
            WHERE Id = @Id${i}

            COMMIT TRANSACTION
        `);
    }

    return sqlParts.join('\n');
}

function median(values) {
    return values[Math.floor(values.length / 2)];
}

function runBenchmark({
    iterations = 120,
    samples = 7,
    dropSlowest = 2
} = {}) {
    const sql = buildMixedWorkload(iterations);

    const warmup = parseBuiltResult(sql);

    if (warmup.issues && warmup.issues.length > 0) {
        throw new Error(
            `Warmup parse produced ${warmup.issues.length} issues`
        );
    }

    const timings = [];
    let lastResult = warmup;

    for (let i = 0; i < samples; i++) {
        const start = performance.now();
        lastResult = parseBuiltResult(sql);
        timings.push(performance.now() - start);
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const trimmed = sorted.slice(0, Math.max(sorted.length - dropSlowest, 1));

    return {
        iterations,
        samples,
        dropSlowest,
        sqlLines: sql.split('\n').length,
        statementCount: lastResult.ast.body.length,
        issueCount: lastResult.issues ? lastResult.issues.length : 0,
        rawSamplesMs: timings,
        trimmedSamplesMs: trimmed,
        medianMs: median(trimmed)
    };
}

function formatSamples(values) {
    return values.map(x => x.toFixed(2)).join(', ');
}

function main() {
    const result = runBenchmark();

    console.log('T-SQL parser benchmark');
    console.log(`SQL lines: ${result.sqlLines}`);
    console.log(`Statements: ${result.statementCount}`);
    console.log(`Issues: ${result.issueCount}`);
    console.log(`Raw samples (ms): ${formatSamples(result.rawSamplesMs)}`);
    console.log(`Trimmed samples (ms): ${formatSamples(result.trimmedSamplesMs)}`);
    console.log(`Median (ms): ${result.medianMs.toFixed(2)}`);
}

main();
