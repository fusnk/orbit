import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Addon content is untrusted, so HTML-parsing DOM sinks are banned outright
// rather than reviewed case by case. Build DOM with textContent via lib/dom.ts.
const message = 'HTML sinks are banned; build nodes with lib/dom.ts.';
const htmlSinks = [
  ...['innerHTML', 'outerHTML', 'insertAdjacentHTML'].map((property) => ({ property, message })),
  ...['write', 'writeln'].map((property) => ({ object: 'document', property, message })),
];

export default tseslint.config(
  { ignores: ['dist/', 'src-tauri/', 'core/', 'node_modules/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': ['error', ...htmlSinks],
    },
  },
  {
    files: ['examples/addon/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
