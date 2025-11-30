/**
 * ESLint Configuration
 * Code quality and style enforcement
 */

module.exports = {
    env: {
        node: true,
        es2021: true
    },
    extends: [
        'eslint:recommended'
    ],
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module'
    },
    rules: {
        // Error prevention
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        'no-debugger': 'error',
        'no-unused-vars': ['warn', { 
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_'
        }],
        'no-undef': 'error',
        
        // Code quality
        'eqeqeq': ['error', 'always'],
        'curly': ['error', 'all'],
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        'no-script-url': 'error',
        'no-sequences': 'error',
        'no-throw-literal': 'error',
        'no-unmodified-loop-condition': 'error',
        'no-unused-expressions': 'error',
        'no-useless-call': 'error',
        'no-useless-concat': 'error',
        'no-useless-return': 'error',
        'prefer-const': 'warn',
        'prefer-arrow-callback': 'warn',
        
        // Style
        'indent': ['warn', 4, { SwitchCase: 1 }],
        'quotes': ['warn', 'single', { avoidEscape: true }],
        'semi': ['warn', 'always'],
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
        'prefer-const': 'warn',
        'prefer-template': 'warn',
        'prefer-destructuring': ['warn', {
            array: false,
            object: true
        }],
        'no-param-reassign': ['warn', { props: false }],
        'no-nested-ternary': 'warn',
        'no-else-return': 'warn'
    },
    overrides: [
        {
            files: ['*.test.js', '*.spec.js'],
            env: {
                jest: true
            },
            rules: {
                'no-unused-vars': 'off'
            }
        }
    ]
};

