import react from '@kavach/config/eslint/react';
import next from '@next/eslint-plugin-next';

export default [
  ...react,
  {
    plugins: { '@next/next': next },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
    },
  },
];
