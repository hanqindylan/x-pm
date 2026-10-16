import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'

import type {
  CommandContext,
  DependencyType,
  FindEntry,
  FindLocation,
  PackageManager,
} from '../types'
import { getGlobalRoot } from '../core/exec'
import { readPackageJson } from '../core/resolve-bin'
import { log } from '../ui/log'
import { renderTable } from '../ui/table'

/* -------------------------------------------------------------------------- */
/* 扫描                                                                         */
/* -------------------------------------------------------------------------- */

/** 列出某个 node_modules 下的包名（含 @scope 一层，不递归） */
export function listPackagesIn(nodeModulesDir: string): string[] {
  if (!existsSync(nodeModulesDir)) return []

  const names: string[] = []

  let entries: Dirent[]
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    // 跳过 .bin、.cache、.pnpm 之类的内部目录
    if (entry.name.startsWith('.')) continue

    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModulesDir, entry.name)
      try {
        for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
          if (sub.name.startsWith('.')) continue
          names.push(`${entry.name}/${sub.name}`)
        }
      } catch {
        // scope 目录读不到就跳过
      }
      continue
    }

    names.push(entry.name)
  }

  return names
}

/** 极简 glob：只支持路径里最后一段的 `*`（足够覆盖常见的 workspaces 配置） */
function matchWorkspacePattern(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.replace(/\/+$/, '')
  if (!normalizedPattern.includes('*')) return normalizedPattern === candidate

  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`).test(candidate)
}

/** 读取 package.json 里的 workspaces 字段 */
function readWorkspaces(root: string): string[] {
  const pkg = readPackageJson(root)
  if (!pkg) return []

  const field = (pkg as { workspaces?: unknown }).workspaces
  if (Array.isArray(field)) return field.filter((item): item is string => typeof item === 'string')
  if (field && typeof field === 'object' && Array.isArray((field as { packages?: unknown }).packages)) {
    return ((field as { packages: unknown[] }).packages).filter(
      (item): item is string => typeof item === 'string',
    )
  }
  return []
}

/** 收集所有需要扫描的 node_modules 目录（项目 + 父级 + workspace） */
export function collectNodeModulesDirs(root: string, includeWorkspace = true): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()

  const push = (dir: string): void => {
    if (seen.has(dir)) return
    seen.add(dir)
    dirs.push(dir)
  }

  // 本项目 + 所有祖先目录的 node_modules（支持 pnpm / yarn 的提升布局）
  let dir = resolve(root)
  const { root: fsRoot } = parse(dir)
  for (;;) {
    push(join(dir, 'node_modules'))
    const parent = dirname(dir)
    if (dir === fsRoot || parent === dir) break
    dir = parent
  }

  if (includeWorkspace) {
    for (const pattern of readWorkspaces(root)) {
      const base = pattern.replace(/\/+$/, '')
      if (!base.includes('*')) {
        push(join(root, base, 'node_modules'))
        continue
      }
      const parentDir = join(root, dirname(base))
      if (!existsSync(parentDir)) continue
      try {
        for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
          if (matchWorkspacePattern(base, join(relative(root, parentDir), entry.name))) {
            push(join(parentDir, entry.name, 'node_modules'))
          }
        }
      } catch {
        // 读不到就跳过
      }
    }
  }

  return dirs
}

/* -------------------------------------------------------------------------- */
/* 缓存                                                                         */
/* -------------------------------------------------------------------------- */

interface CacheFile {
  [key: string]: string[]
}

const CACHE_FILE = join(tmpdir(), 'x-pm-find-cache.json')
let memoryCache: CacheFile | null = null

function loadCache(): CacheFile {
  if (memoryCache) return memoryCache
  try {
    memoryCache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as CacheFile
  } catch {
    memoryCache = {}
  }
  return memoryCache
}

function saveCache(cache: CacheFile): void {
  memoryCache = cache
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8')
  } catch {
    // 缓存写失败不影响主流程
  }
}

/** 缓存 key：目录路径 + mtime，node_modules 一有变动缓存自动失效 */
function cacheKey(nodeModulesDir: string): string | undefined {
  try {
    const stats = statSync(nodeModulesDir)
    return `${nodeModulesDir}@${Math.floor(stats.mtimeMs)}`
  } catch {
    return undefined
  }
}

/** 带 mtime 缓存的目录扫描 */
export function listPackagesCached(nodeModulesDir: string): string[] {
  const key = cacheKey(nodeModulesDir)
  if (!key) return listPackagesIn(nodeModulesDir)

  const cache = loadCache()
  const cached = cache[key]
  if (cached) return cached

  const names = listPackagesIn(nodeModulesDir)
  cache[key] = names
  saveCache(cache)
  return names
}

/** 仅用于测试：清空内存缓存 */
export function clearFindCache(): void {
  memoryCache = null
}

/* -------------------------------------------------------------------------- */
/* 收集结果                                                                     */
/* -------------------------------------------------------------------------- */

/** 判断包在宿主 package.json 里属于哪一类依赖 */
function resolveDependencyType(root: string, name: string): DependencyType {
  const pkg = readPackageJson(root) as
    | (Record<string, unknown> & {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
      })
    | undefined
  if (!pkg) return 'unknown'

  if (pkg.dependencies?.[name]) return 'dependency'
  if (pkg.devDependencies?.[name]) return 'devDependency'
  if (pkg.optionalDependencies?.[name]) return 'optionalDependency'
  if (pkg.peerDependencies?.[name]) return 'peerDependency'
  return 'unknown'
}

/** 收集参数 */
export interface CollectOptions {
  /** 项目根目录 */
  root: string
  /** 包管理器，用于定位全局目录 */
  pm: PackageManager
  /** 只查本地 */
  local?: boolean
  /** 只查全局 */
  global?: boolean
  /** 只列出带可执行文件的包 */
  binOnly?: boolean
  /** 递归扫描所有 node_modules */
  deep?: boolean
}

/**
 * 扫描已安装的包。
 *
 * 默认只扫顶层 + @scope 一层，保证大仓库也是毫秒级；
 * `--deep` 才会递归进入每个包自己的 node_modules。
 */
export async function collectFindEntries(options: CollectOptions): Promise<FindEntry[]> {
  const { root, pm, local = false, global = false, binOnly = false, deep = false } = options
  const includeLocal = local || !global
  const includeGlobal = global || !local

  const entries = new Map<string, FindEntry>()

  /* 本地 */
  if (includeLocal) {
    const dirs = collectNodeModulesDirs(root)
    const projectRoot = resolve(root)

    for (const nodeModulesDir of dirs) {
      // 项目自身和祖先目录的 node_modules 归为 local；
      // 项目内部的其它 node_modules（workspace 包的）归为 workspace
      const isDescendant = nodeModulesDir.startsWith(projectRoot + sep)
      const isOwn = nodeModulesDir === join(projectRoot, 'node_modules')
      const location: FindLocation = isDescendant && !isOwn ? 'workspace' : 'local'

      // 依赖类型以「拥有这个 node_modules 的那个 package.json」为准
      const ownerRoot = dirname(nodeModulesDir)

      for (const name of listPackagesCached(nodeModulesDir)) {
        if (entries.has(name)) continue

        const dir = join(nodeModulesDir, ...name.split('/'))
        const meta = readPackageJson(dir)
        if (!meta) continue

        const bins = Object.keys(
          typeof meta.bin === 'string'
            ? { [meta.name?.split('/').pop() ?? name]: meta.bin }
            : (meta.bin ?? {}),
        )

        if (binOnly && bins.length === 0) continue

        const type = resolveDependencyType(ownerRoot, name)

        entries.set(name, {
          name,
          version: meta.version ?? '-',
          location,
          type,
          dir,
          hasBin: bins.length > 0,
          bins,
        })
      }
    }
  }

  /* 全局 */
  if (includeGlobal) {
    const globalRoot = await getGlobalRoot(pm)
    if (globalRoot) {
      for (const name of listPackagesCached(globalRoot)) {
        if (entries.has(name)) continue

        const dir = join(globalRoot, ...name.split('/'))
        const meta = readPackageJson(dir)
        if (!meta) continue

        const bins = Object.keys(
          typeof meta.bin === 'string'
            ? { [meta.name?.split('/').pop() ?? name]: meta.bin }
            : (meta.bin ?? {}),
        )

        if (binOnly && bins.length === 0) continue

        entries.set(name, {
          name,
          version: meta.version ?? '-',
          location: 'global',
          type: 'global',
          dir,
          hasBin: bins.length > 0,
          bins,
        })
      }
    }
  }

  /* --deep：递归进入每个包自己的 node_modules */
  if (deep) {
    for (const entry of [...entries.values()]) {
      const nested = join(entry.dir, 'node_modules')
      if (!existsSync(nested)) continue

      for (const name of listPackagesIn(nested)) {
        if (entries.has(name)) continue

        const dir = join(nested, ...name.split('/'))
        const meta = readPackageJson(dir)
        if (!meta) continue

        const bins = Object.keys(
          typeof meta.bin === 'string'
            ? { [meta.name?.split('/').pop() ?? name]: meta.bin }
            : (meta.bin ?? {}),
        )

        if (binOnly && bins.length === 0) continue

        entries.set(name, {
          name,
          version: meta.version ?? '-',
          location: entry.location,
          type: 'unknown',
          dir,
          hasBin: bins.length > 0,
          bins,
        })
      }
    }
  }

  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 依赖类型的中文标签 */
const TYPE_LABEL: Record<DependencyType, string> = {
  dependency: 'dependency',
  devDependency: 'devDep',
  peerDependency: 'peerDep',
  optionalDependency: 'optionalDep',
  global: 'global',
  unknown: '-',
}

/** 位置的简写，用于表格 */
const LOCATION_LABEL: Record<FindLocation, string> = {
  local: '本地',
  workspace: 'workspace',
  global: '全局',
}

/** `x find` 的可选项 */
export interface FindCommandOptions {
  keyword?: string | undefined
  local?: boolean | undefined
  global?: boolean | undefined
  bin?: boolean | undefined
  deep?: boolean | undefined
  json?: boolean | undefined
}

/**
 * `x find [关键词]` —— 在本地查找已安装的包。
 *
 * 模糊匹配包名，`--local` / `--global` 限定范围，`--bin` 只看带可执行文件的包。
 */
export async function findCommand(
  options: FindCommandOptions,
  ctx: CommandContext,
): Promise<number> {
  const entries = await collectFindEntries({
    root: ctx.root,
    pm: ctx.pm,
    local: options.local,
    global: options.global,
    binOnly: options.bin,
    deep: options.deep,
  })

  const keyword = options.keyword?.trim().toLowerCase()
  const matched = keyword
    ? entries.filter((entry) => entry.name.toLowerCase().includes(keyword))
    : entries

  if (options.json) {
    log.info(JSON.stringify(matched, null, 2))
    return 0
  }

  if (matched.length === 0) {
    log.warn(keyword ? `没有找到匹配「${options.keyword}」的包` : '没有找到任何已安装的包')
    return 0
  }

  const table = renderTable({
    head: ['包名', '版本', '位置', '类型', '路径'],
    rows: matched.map((entry) => [
      entry.name,
      entry.version,
      LOCATION_LABEL[entry.location],
      TYPE_LABEL[entry.type],
      shortenPath(entry.dir),
    ]),
    maxWidths: [32, 12, 10, 12, 52],
  })

  log.blank()
  log.info(table)
  log.blank()
  log.info(`共 ${matched.length} 个包`)
  log.blank()

  return 0
}

/** 把长路径压缩成 ~/... 形式 */
function shortenPath(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}