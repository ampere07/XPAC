module.exports = {
  extends: [
    'react-app',
    'react-app/jest',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: [],
  rules: {
    // Customize rules if needed
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
