/**
 * ESLint Configuration
 * Code quality and style enforcement
 */

module.exports = {
    env: {
        node: true,
        es2021: true
    },
    plugins: ['import'],
    extends: ['eslint:recommended'],
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module'
    },
    rules: {
        // Error prevention
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        'no-debugger': 'error',
        'no-unused-vars': [
            'warn',
            {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }
        ],
        'no-undef': 'warn',

        // Code quality
        eqeqeq: ['warn', 'always'],
        curly: ['warn', 'all'],
        'no-eval': 'warn',
        'no-implied-eval': 'warn',
        'no-new-func': 'warn',
        'no-script-url': 'error',
        'no-empty': 'warn',
        'no-control-regex': 'warn',
        'no-dupe-else-if': 'warn',
        'no-dupe-keys': 'warn',
        'no-mixed-spaces-and-tabs': 'warn',
        'no-sequences': 'warn',
        'no-throw-literal': 'warn',
        'no-unmodified-loop-condition': 'warn',
        'no-unused-expressions': 'warn',
        'no-useless-call': 'warn',
        'no-useless-catch': 'warn',
        'no-useless-concat': 'warn',
        'no-useless-escape': 'warn',
        'no-useless-return': 'warn',
        'prefer-const': 'warn',
        'prefer-arrow-callback': 'warn',

        // Style
        indent: ['warn', 4, { SwitchCase: 1 }],
        quotes: ['warn', 'single', { avoidEscape: true }],
        semi: ['warn', 'always'],
        'comma-dangle': ['warn', 'never'],
        'object-curly-spacing': ['warn', 'always'],
        'array-bracket-spacing': ['warn', 'never'],
        'comma-spacing': ['warn', { before: false, after: true }],
        'key-spacing': ['warn', { beforeColon: false, afterColon: true }],
        'space-before-blocks': 'warn',
        'space-before-function-paren': ['warn', 'never'],
        'space-in-parens': ['warn', 'never'],
        'space-infix-ops': 'warn',
        'space-unary-ops': 'warn',
        'spaced-comment': ['warn', 'always'],

        // Best practices
        'no-var': 'error',
        'prefer-template': 'warn',
        'prefer-destructuring': [
            'warn',
            {
                array: false,
                object: true
            }
        ],
        'no-param-reassign': ['warn', { props: false }],
        'no-nested-ternary': 'warn',
        'no-else-return': 'warn'
    },
    overrides: [
        {
            files: ['*.test.js', '*.spec.js'],
            env: {
                node: true
            },
            rules: {
                'no-unused-vars': 'off',
                'no-script-url': 'off'
            }
        }
    ]
};
