module.exports = {
    env: {
        node: true,
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    parser: "@typescript-eslint/parser",
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier",
    ],
    plugins: ["@typescript-eslint"],
    parserOptions: {
        sourceType: "module",
        ecmaVersion: 2020,
    },
    rules: {
        // Public APIs deliberately merge namespaces with types/classes (e.g. Option).
        "@typescript-eslint/no-namespace": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-unused-vars": ["warn", {"argsIgnorePattern": "^_"}],
        "no-unused-vars": "warn",
        "no-restricted-imports": [
            "error",
            {
                "patterns": [
                    {
                        "group": ["**/src/**", "@opendaw/*/src/**"],
                        "message": "Direct imports from src folders are not allowed. Use package exports instead."
                    }
                ]
            }
        ]
    },
}