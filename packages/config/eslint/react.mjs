import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import base from './base.mjs';

/** Base config plus React hooks rules, for web and mobile. */
export default [
  ...base,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
