import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Base ESLint config for every workspace. */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.next/**',
      '.expo/**',
      '.turbo/**',
      'coverage/**',
      'node_modules/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
