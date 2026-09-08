// 共享 ESLint 扁平配置（云笺集 · 代码审查门禁）
// workbench 内自含副本：模块依赖安装在本包 node_modules，避免从仓库根解析失败。
// 与仓库根 eslint.config.js 保持同一规则集（规则改动请在两侧同步）。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.astro/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest' },
    },
    // react-hooks 插件全局注册：使 .ts 文件里的 eslint-disable-next-line 注释可解析规则 ID
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // 关闭在 TS 下易误报的基础规则
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // 项目基线（偏 warn，避免一次性阻塞大量存量代码）
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-duplicate-imports': 'error',
      // 控制字符正则为本项目刻意用途：\u0000/\u0001 掩码占位（docTransforms）、文件名消毒（exporters）
      'no-control-regex': 'off',
      eqeqeq: ['warn', 'smart'],
      // hooks 规则（ts + tsx 通用：exhaustive-deps 亦覆盖含 hooks 的 .ts）
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: {
      react,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      'react/no-unknown-property': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
    },
  },
)