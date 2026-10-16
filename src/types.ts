/**
 * x-pm 全局类型定义。
 *
 * 这里集中声明跨模块共用的类型，避免各模块互相 import 造成循环依赖。
 */

/* -------------------------------------------------------------------------- */
/* 包管理器                                                                    */
/* -------------------------------------------------------------------------- */

/** 受支持的包管理器 */
export type PackageManager = 'npm' | 'pnpm' | 'bun' | 'yarn'

/** 包管理器检测来源 */
export type DetectSource =
  /** 由 `--pm` 显式指定 */
  | 'flag'
  /** 由 package.json 的 packageManager 字段指定 */
  | 'packageManager-field'
  /** 由锁文件推断 */
  | 'lockfile'
  /** 由 .xrc.json 的 defaultPM 指定 */
  | 'config'
  /** 以上都没有，回落默认值 */
  | 'fallback'

/** 包管理器检测结果 */
export interface DetectResult {
  /** 最终选定的包管理器 */
  pm: PackageManager
  /** 项目根目录（绝对路径） */
  root: string
  /** 检测来源 */
  source: DetectSource
  /** 一行中文提示，调用方可直接写入 stderr */
  message: string
  /** 命中的锁文件名（source 为 lockfile 时有值） */
  lockfile?: string
  /** package.json 中 packageManager 字段的原始值 */
  packageManagerField?: string
}

/* -------------------------------------------------------------------------- */
/* 配置与 registry                                                             */
/* -------------------------------------------------------------------------- */

/** .xrc.json 的结构（全部字段可选） */
export interface XConfig {
  /** registry 地址，例如 https://registry.npmmirror.com */
  registry?: string
  /** 默认包管理器 */
  defaultPM?: PackageManager
  /** search 默认返回条数 */
  searchLimit?: number
  /** 自定义命令别名，例如 { "s": "search" } */
  aliases?: Record<string, string>
}

/** registry 的解析来源 */
export type RegistryOrigin = 'cli' | 'config' | 'env' | 'default'

/** registry 解析结果 */
export interface ResolvedRegistry {
  /** 最终使用的 registry 地址（已去掉末尾斜杠） */
  url: string
  /** 来自哪里 */
  origin: RegistryOrigin
  /** 展示用短名，例如 npmmirror.com */
  label: string
}

/** `--source` 可选值：npm 官方源 / 国内源 */
export type RegistryPreset = 'npm' | 'cn'

/** npm search 接口返回的原始结构（只声明用到的字段） */
export interface RegistrySearchResponse {
  objects?: Array<{
    package?: {
      name?: string
      version?: string
      description?: string
      date?: string
      publisher?: { username?: string; email?: string }
      maintainers?: Array<{ username?: string; email?: string }>
      links?: Record<string, string>
    }
    score?: { final?: number }
  }>
  total?: number
}

/** 单条搜索结果 */
export interface SearchResult {
  name: string
  version: string
  description: string
  publisher: string
  /** 最新版本发布时间 */
  date?: string
  /** 包主页 */
  homepage?: string
  /** 仅 `--where` 时填充：本地包目录 */
  localDir?: string
  /** 仅 `--where` 时填充：全局包目录 */
  globalDir?: string
  /** 仅 `--where` 时填充：本地 .bin 下的可执行文件 */
  localBin?: string
}

/* -------------------------------------------------------------------------- */
/* find / where                                                                */
/* -------------------------------------------------------------------------- */

/** 包被找到的位置 */
export type FindLocation = 'local' | 'workspace' | 'global'

/** 包的依赖类型 */
export type DependencyType =
  | 'dependency'
  | 'devDependency'
  | 'peerDependency'
  | 'optionalDependency'
  | 'global'
  | 'unknown'

/** find 命中的单条记录 */
export interface FindEntry {
  name: string
  version: string
  location: FindLocation
  type: DependencyType
  /** 包目录绝对路径 */
  dir: string
  /** 是否包含可执行文件 */
  hasBin: boolean
  /** 可执行文件名列表（已去掉扩展名） */
  bins: string[]
}

/** where 的完整定位结果 */
export interface WhereResult {
  name: string
  version?: string
  /** 包目录 */
  localDir?: string
  globalDir?: string
  /** 可执行文件 */
  localBin?: string
  globalBin?: string
  /** 在 PATH 中命中的可执行文件 */
  pathBin?: string
  homepage?: string
  /** 命中的包管理器（用于展示「来源」） */
  pm?: PackageManager
  /** 来源描述，例如 pnpm-lock.yaml */
  source?: string
}

/* -------------------------------------------------------------------------- */
/* xgo / 执行                                                                  */
/* -------------------------------------------------------------------------- */

/** xgo 的执行策略 */
export type GoStrategy =
  /** 命中本地 node_modules/.bin */
  | 'local-bin'
  /** 命中 PATH */
  | 'path'
  /** 交给包管理器的 dlx / npx 执行 */
  | 'runner'

/** xgo 执行结果 */
export interface GoResult {
  command: string
  args: string[]
  strategy: GoStrategy
  exitCode: number
}

/** 统一的子进程执行选项 */
export interface RunOptions {
  cwd?: string
  /** 是否使用 sudo 提权 */
  sudo?: boolean
  /** 静默模式，不打印即将执行的命令 */
  silent?: boolean
  /** 需要继承 stdio 以支持交互式命令（默认 true） */
  stdio?: 'inherit' | 'pipe'
}

/** 命令执行上下文，由 cli 层统一构造后传给各 command */
export interface CommandContext {
  /** 检测（或强制指定）出来的包管理器 */
  pm: PackageManager
  /** 项目根目录 */
  root: string
  /** 当前工作目录 */
  cwd: string
  /** 是否显式要求 sudo（只有 xgo / exec 会真正使用它） */
  sudo: boolean
  /** 已加载的配置文件内容 */
  config: XConfig
}

/** 子进程执行结果 */
export interface RunResult {
  command: string
  args: string[]
  exitCode: number
  stdout: string
  stderr: string
}
