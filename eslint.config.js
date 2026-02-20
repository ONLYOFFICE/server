const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');
const {includeIgnoreFile} = require('@eslint/compat');
const path = require('node:path');
const gitignorePath = path.resolve(__dirname, '.gitignore');

module.exports = [
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '.next/',
      'out/',
      '*.min.js',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'SpellChecker/**',
      'Metrics/**'
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node, // All Node.js globals automatically
        ...globals.es2022 // Modern JavaScript globals
      }
    },
    rules: {
      // Code quality rules (compatible with Prettier)
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-undef': 'error',
      eqeqeq: 'off',
      curly: ['error', 'all'],

      // Server-friendly settings
      'no-console': 'off', // Allow console in server code
      'no-continue': 'off', // Allow continue statements
      'no-plusplus': 'off',

      // Modern JavaScript practices
      'prefer-const': 'error', // Enforce const for immutable bindings
      'no-var': 'error', // Enforce let/const over var
      'object-shorthand': 'error', // Modern object property syntax
      'prefer-arrow-callback': 'error', // Modern callback style
      'no-duplicate-imports': 'error', // Avoid duplicate imports
      'no-useless-constructor': 'error', // Remove unnecessary constructors
      'no-useless-return': 'error', // Remove unnecessary return statements
      'max-lines': ['warn', 5000]
    }
  },
  prettier
];
