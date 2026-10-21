// ESLint flat config for the app and the extension. `npm run lint` (in app/) runs it from the
// repo root so both folders are in scope; paths below are relative to the repo root.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['**/node_modules/', 'app/data/'] },
  js.configs.recommended,
  {
    // `catch (_)` is the house style for errors we deliberately swallow, and
    // `const { queuedAt, ...body } = x` is how we drop a field before sending.
    rules: { 'no-unused-vars': ['error', { caughtErrors: 'none', ignoreRestSiblings: true }] }
  },
  {
    files: ['extension/**/*.js', 'app/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' }
    }
  },
  {
    files: ['app/server.js', 'app/eslint.config.js', 'app/lib/**/*.js', 'app/test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  }
];
