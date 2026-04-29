const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset({
    tsconfig: { isolatedModules: true }
}).transform;

/** @type {import("jest").Config} **/
module.exports = {
    testEnvironment: "node",
    transform: {
        ...tsJestTransformCfg,
    },
    // Only look for tests in the tests/ directory
    testMatch: ["**/tests/**/*.test.ts"],
    // Cache transformed modules between runs
    cache: true,
};