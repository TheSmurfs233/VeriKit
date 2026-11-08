import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 只检查 TypeScript。仓库里的 .js / .mjs 是两个几十行的构建/检查脚本，
    // 为它们引入 globals 依赖不划算（S0 的零依赖原则）。
    ignores: ['dist/**', 'node_modules/**', 'test/golden/**', '**/*.js', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TS 由编译器负责未定义变量检查，eslint 的 no-undef 在 TS 上会误报
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
);
