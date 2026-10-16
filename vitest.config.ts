import { defineConfig } from 'vitest/config'

/** vitest 配置：只跑 tests 目录下的用例，Node 环境 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
})
