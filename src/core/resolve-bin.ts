import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

import which from 'which'

/** Windows 下默认可执行文件后缀 */
const DEFAULT_WINDOWS_EXTENSIONS = ['.CMD', '.EXE', '.BAT', '.PS1']

/** 当前平台是否为 Windows */
export function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * 返回一个命令名在当前平台上可能的可执行文件名。
 *
 * Unix 上就是命令名本身；Windows 上还要带上 PATHEXT 里的后缀。
 */
export function binFileNames(name: string): string[] {
  if (!isWindows()) return [name]

  const exts = process.env.PATHEXT
    ? process.env.PATHEXT.split(';').filter(Boolean)
    : DEFAULT_WINDOWS_EXTENSIONS

  return [name, ...exts.map((ext) => `${name}${ext.toLowerCase()}`)]
}

/** 本地可执行文件目录 */
export function localBinDir(root: string): string {
  return join(root, 'node_modules', '.bin')
}

/** 在指定的 bin 目录里找可执行文件 */
export function findBinIn(binDir: string, name: string): string | undefined {
  for (const fileName of binFileNames(name)) {
    const full = join(binDir, fileName)
    if (existsSync(full)) return full
  }
  return undefined
}

/** 在项目的 node_modules/.bin 里找本地可执行文件 */
export function findLocalBin(root: string, name: string): string | undefined {
  return findBinIn(localBinDir(root), name)
}

/** 在 PATH 中查找可执行文件，跨平台（内部封装 which） */
export function findInPath(name: string): string | undefined {
  try {
    return which.sync(name) ?? undefined
  } catch {
    return undefined
  }
}

/** package.json 里我们关心的字段 */
export interface PackageMeta {
  name?: string
  version?: string
  description?: string
  homepage?: string
  bin?: string | Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/** 读取一个包目录下的 package.json；dir 为 undefined 时返回 undefined */
export function readPackageJson(dir: string | undefined): PackageMeta | undefined {
  if (!dir) return undefined

  const file = join(dir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageMeta
  } catch {
    return undefined
  }
}

/**
 * 向上逐级查找某个包的安装目录。
 *
 * 从 startDir 开始，每一级检查 `<dir>/node_modules/<name>`，一直到文件系统根。
 * 自动支持 scoped 包（`@scope/name` 会被拆成两级路径）。
 */
export function findPackageDir(name: string, startDir: string): string | undefined {
  let dir = resolve(startDir)
  const { root } = parse(dir)
  const segments = name.split('/')

  for (;;) {
    const candidate = join(dir, 'node_modules', ...segments)
    if (existsSync(join(candidate, 'package.json'))) return candidate

    const parent = dirname(dir)
    if (dir === root || parent === dir) return undefined
    dir = parent
  }
}

/**
 * 取出一个包声明的可执行文件名列表。
 *
 * `bin` 为字符串时，按 npm 约定使用包名（去掉 scope）作为命令名。
 */
export function listBinNames(meta: PackageMeta | undefined): string[] {
  const bin = meta?.bin
  if (!bin) return []

  if (typeof bin === 'string') {
    const name = meta?.name?.split('/').pop()
    return name ? [name] : []
  }

  return Object.keys(bin)
}