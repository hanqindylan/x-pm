/**
 * 包管理器检测。
 *
 * 检测顺序（从高到低）：
 *   1. `--pm` 显式指定
 *   2. package.json 的 `packageManager` 字段（命中后直接忽略锁文件）
 *   3. package-lock.json / npm-shrinkwrap.json → npm
 *   4. pnpm-lock.yaml                          → pnpm
 *   5. bun.lockb / bun.lock                    → bun
 *   6. yarn.lock                               → yarn
 *   7. .xrc.json 的 defaultPM
 *   8. 默认 npm
 *
 * 本模块刻意不依赖任何第三方库，纯 node 内置能力实现，便于单测与复用。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

import type { DetectResult, PackageManager } from '../types'

/** 所有受支持的包管理器 */
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'bun', 'yarn'] as const satisfies readonly PackageManager[]

/** 锁文件规则，数组顺序即优先级：npm > pnpm > bun > yarn */
export const LOCKFILE_RULES: ReadonlyArray<{ pm: PackageManager; files: readonly string[] }> = [
  { pm: 'npm', files: ['package-lock.json', 'npm-shrinkwrap.json'] },
  { pm: 'pnpm', files: ['pnpm-lock.yaml'] },
  { pm: 'bun', files: ['bun.lockb', 'bun.lock'] },
  { pm: 'yarn', files: ['yarn.lock'] },
]

/** 用于向上查找项目根目录的标志文件 */
const ROOT_MARKERS: readonly string[] = [
  'package.json',
  ...LOCKFILE_RULES.flatMap((rule) => rule.files),
]

/** 判断一个字符串是否是受支持的包管理器 */
export function isPackageManager(value: unknown): value is PackageManager {
  return typeof value === 'string' && (PACKAGE_MANAGERS as readonly string[]).includes(value)
}

/**
 * 解析 package.json 的 packageManager 字段。
 *
 * 支持 `pnpm`、`pnpm@9.15.0`、`yarn@4.1.0+sha512.xxx` 等写法；
 * 无法识别（如 `cnpm@1.0.0`、`@scope/pkg`）时返回 undefined。
 */
export function parsePackageManagerField(value: unknown): PackageManager | undefined {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  // 以 @ 开头说明是 scoped 包名，不是包管理器
  if (!trimmed || trimmed.startsWith('@')) return undefined

  const atIndex = trimmed.indexOf('@')
  const name = (atIndex === -1 ? trimmed : trimmed.slice(0, atIndex)).trim().toLowerCase()

  return isPackageManager(name) ? name : undefined
}

/**
 * 从 cwd 向上查找项目根目录。
 *
 * 判定依据：该目录下存在 package.json 或任一锁文件；
 * 一路找到文件系统根都没有命中时，返回起始目录本身。
 */
export function findProjectRoot(cwd: string = process.cwd()): string {
  const start = resolve(cwd)
  const { root: fsRoot } = parse(start)

  let dir = start
  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir

    const parent = dirname(dir)
    if (dir === fsRoot || parent === dir) return start
    dir = parent
  }
}

/** detectPackageManager 的入参 */
export interface DetectOptions {
  /** 工作目录，默认 process.cwd() */
  cwd?: string
  /** `--pm` 强制指定的包管理器 */
  force?: PackageManager
  /** `.xrc.json` 里的 defaultPM（仅作为锁文件缺失时的兜底） */
  configDefaultPM?: PackageManager
  /** 为 true 时不向 stderr 打印提示（供测试使用） */
  silent?: boolean
}

/**
 * 检测当前项目应使用的包管理器。
 *
 * 每次调用都会向 stderr 打印一行中文提示，例如：
 *   [x] 检测到 pnpm-lock.yaml，使用 pnpm
 */
export function detectPackageManager(options: DetectOptions = {}): DetectResult {
  const root = findProjectRoot(options.cwd)

  /** 打印提示并返回结果 */
  const emit = (result: DetectResult): DetectResult => {
    if (!options.silent) process.stderr.write(`[x] ${result.message}\n`)
    return result
  }

  // 1. --pm 显式指定，优先级最高
  if (options.force) {
    return emit({
      pm: options.force,
      root,
      source: 'flag',
      message: `使用 --pm 指定的 ${options.force}`,
    })
  }

  // 2. package.json 的 packageManager 字段
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    const field = readPackageManagerField(pkgPath)
    const pm = parsePackageManagerField(field)
    if (pm) {
      return emit({
        pm,
        root,
        source: 'packageManager-field',
        packageManagerField: field,
        message: `检测到 package.json 的 packageManager 字段（${String(field)}），使用 ${pm}`,
      })
    }
  }

  // 3-6. 锁文件
  for (const rule of LOCKFILE_RULES) {
    const lockfile = rule.files.find((file) => existsSync(join(root, file)))
    if (lockfile) {
      return emit({
        pm: rule.pm,
        root,
        source: 'lockfile',
        lockfile,
        message: `检测到 ${lockfile}，使用 ${rule.pm}`,
      })
    }
  }

  // 7. .xrc.json 的 defaultPM
  if (options.configDefaultPM) {
    return emit({
      pm: options.configDefaultPM,
      root,
      source: 'config',
      message: `未检测到锁文件，使用 .xrc.json 指定的 ${options.configDefaultPM}`,
    })
  }

  // 8. 默认 npm
  return emit({
    pm: 'npm',
    root,
    source: 'fallback',
    message: '未检测到 packageManager 字段与锁文件，默认使用 npm',
  })
}

/** 读取 package.json 的 packageManager 字段；文件不存在或不是合法 JSON 时返回 undefined */
function readPackageManagerField(pkgPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (parsed && typeof parsed === 'object' && 'packageManager' in parsed) {
      const value = (parsed as { packageManager?: unknown }).packageManager
      return typeof value === 'string' ? value : undefined
    }
  } catch {
    // package.json 解析失败：忽略，继续走锁文件检测
  }
  return undefined
}
