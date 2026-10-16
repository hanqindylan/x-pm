import { defineConfig } from 'tsup'

/**
 * tsup 打包配置。
 *
 * 产物为 ESM 单文件，并在顶部注入 shebang，
 * tsup 检测到 shebang 后会自动把产物标记为可执行文件。
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  sourcemap: true,
  dts: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
