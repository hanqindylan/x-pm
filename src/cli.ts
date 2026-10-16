#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cac } from 'cac'
import type { CAC } from 'cac'

import { loadConfig } from './core/config'
import { detectPackageManager } from './core/detect'
import { isPackageManager } from './core/detect'
import { addCommand } from './commands/add'
import { execCommand } from './commands/exec'
import { findCommand } from './commands/find'
import { goCommand } from './commands/go'
import { installCommand, listCommand, updateCommand } from './commands/install'
import { removeCommand } from './commands/remove'
import { runCommand } from './commands/run'
import { searchCommand } from './commands/search'
import { useCommand } from './commands/use'
import { whereCommand } from './commands/where'
import type { CommandContext, PackageManager, XConfig } from './types'
import { log } from './ui/log'

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                     */
/* -------------------------------------------------------------------------- */

/** 需要带值的选项 */
const VALUE_FLAGS = new Set(['--pm', '--source', '--limit'])

/** 布尔选项 */
const BOOL_FLAGS: Record<string, keyof ParsedArgv> = {
  '-D': 'dev',
  '--save-dev': 'dev',
  '--sudo': 'sudo',
  '--json': 'json',
  '--where': 'where',
  '--local': 'local',
  '--global': 'global',
  '--bin': 'bin',
  '--deep': 'deep',
  '-h': 'help',
  '--help': 'help',
  '-v': 'version',
  '--version': 'version',
}

/** x 自己解析后的参数 */
export interface ParsedArgv {
  /** 命令名 + 未知参数（保持原顺序，未知参数原样透传给包管理器） */
  rest: string[]
  /** --pm <npm|pnpm|bun|yarn> */
  pm?: string
  /** --source <npm|cn|URL> */
  source?: string
  /** --limit <n> */
  limit?: number
  dev: boolean
  sudo: boolean
  json: boolean
  where: boolean
  local: boolean
  global: boolean
  bin: boolean
  deep: boolean
  help: boolean
  version: boolean
}

/**
 * 解析命令行参数。
 *
 * 关键设计：**只摘走 x 自己的选项，其余原样放进 `rest`**，
 * 这样 `x a axios --legacy-peer-deps`、`x dev --port 3000` 这类透传不会丢参数或乱序。
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const parsed: ParsedArgv = {
    rest: [],
    dev: false,
    sudo: false,
    json: false,
    where: false,
    local: false,
    global: false,
    bin: false,
    deep: false,
    help: false,
    version: false,
  }

  let passthrough = false

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue

    // -- 之后的一切原样透传
    if (passthrough) {
      parsed.rest.push(token)
      continue
    }
    if (token === '--') {
      passthrough = true
      continue
    }

    // --pm=pnpm / --limit=20 这种等号写法
    const eqIndex = token.startsWith('--') ? token.indexOf('=') : -1
    if (eqIndex > 0) {
      const name = token.slice(0, eqIndex)
      const value = token.slice(eqIndex + 1)
      if (VALUE_FLAGS.has(name)) {
        assign(parsed, name, value)
        continue
      }
      if (name in BOOL_FLAGS) {
        ;(parsed[BOOL_FLAGS[name] as 'json'] as boolean) = true
        continue
      }
    }

    if (VALUE_FLAGS.has(token)) {
      const value = argv[i + 1]
      if (value !== undefined && !value.startsWith('-')) {
        assign(parsed, token, value)
        i += 1
      }
      continue
    }

    if (token in BOOL_FLAGS) {
      ;(parsed[BOOL_FLAGS[token] as 'json'] as boolean) = true
      continue
    }

    parsed.rest.push(token)
  }

  return parsed
}

function assign(parsed: ParsedArgv, name: string, value: string): void {
  if (name === '--pm') parsed.pm = value
  if (name === '--source') parsed.source = value
  if (name === '--limit') {
    const limit = Number.parseInt(value, 10)
    if (Number.isFinite(limit) && limit > 0) parsed.limit = limit
  }
}

/* -------------------------------------------------------------------------- */
/* 命令别名                                                                     */
/* -------------------------------------------------------------------------- */

/** 内置别名 */
const ALIASES: Record<string, string> = {
  i: 'install',
  install: 'install',
  in: 'install',
  a: 'add',
  add: 'add',
  r: 'remove',
  remove: 'remove',
  rm: 'remove',
  uninstall: 'remove',
  up: 'update',
  update: 'update',
  ls: 'list',
  list: 'list',
  run: 'run',
  exec: 'exec',
  search: 'search',
  s: 'search',
  find: 'find',
  f: 'find',
  where: 'where',
  go: 'go',
  xgo: 'go',
  use: 'use',
  help: 'help',
}

/** 所有真实命令名 */
const COMMANDS = new Set([
  'install',
  'add',
  'remove',
  'update',
  'list',
  'run',
  'exec',
  'search',
  'find',
  'where',
  'go',
  'use',
  'help',
])

/** 结合 .xrc.json 的 aliases 把输入解析成命令名；不是命令则返回 undefined */
export function resolveCommandName(input: string | undefined, config: XConfig): string | undefined {
  if (!input) return undefined

  // 配置文件里的别名优先
  const custom = config.aliases?.[input]
  if (custom && COMMANDS.has(custom)) return custom

  const mapped = ALIASES[input]
  if (mapped && COMMANDS.has(mapped)) return mapped

  // 直接写全名但不在列表里（比如未来的新命令）也放行
  if (COMMANDS.has(input)) return input

  return undefined
}

/* -------------------------------------------------------------------------- */
/* 帮助                                                                         */
/* -------------------------------------------------------------------------- */

/** 读取 package.json 里的版本号 */
export function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 用 cac 生成帮助文本（cac 只负责 help，业务分发走自己的解析） */
function buildHelpCli(): CAC {
  const cli = cac('x')

  cli
    .command('i [args...]', '安装依赖（等价于 <pm> install）')
    .alias('install')
    .option('--pm <pm>', '强制指定包管理器：npm / pnpm / bun / yarn')
    .allowUnknownOptions()
  cli
    .command('a <pkg...>', '添加依赖，-D 写入 devDependencies')
    .alias('add')
    .option('-D, --save-dev', '写入 devDependencies')
    .option('--pm <pm>', '强制指定包管理器')
    .allowUnknownOptions()
  cli
    .command('r <pkg...>', '移除依赖')
    .alias('remove')
    .option('--pm <pm>', '强制指定包管理器')
    .allowUnknownOptions()
  cli
    .command('up [args...]', '更新依赖')
    .alias('update')
    .option('--pm <pm>', '强制指定包管理器')
    .allowUnknownOptions()
  cli
    .command('ls [args...]', '列出顶层依赖')
    .alias('list')
    .option('--pm <pm>', '强制指定包管理器')
    .allowUnknownOptions()
  cli
    .command('run <script> [args...]', '运行 package.json 脚本（x <script> 等价）')
    .option('--pm <pm>', '强制指定包管理器')
    .allowUnknownOptions()
  cli
    .command('exec <cmd> [args...]', '执行本地可执行文件（等价于 <pm> exec）')
    .option('--sudo', '用 sudo 执行（默认不加）')
    .option('--pm <pm>', '强制指定包管理器')
    .allowUnknownOptions()
  cli
    .command('search <keyword>', '远程搜索包，默认走国内源')
    .alias('s')
    .option('--source <npm|cn>', '切换源，默认国内源 npmmirror')
    .option('--limit <n>', '返回条数，默认 10')
    .option('--where', '附加显示本地 / 全局路径')
    .option('--json', '以 JSON 输出')
    .allowUnknownOptions()
  cli
    .command('find [keyword]', '在本地查找已安装的包')
    .alias('f')
    .option('--local', '只查本地')
    .option('--global', '只查全局')
    .option('--bin', '只列出带可执行文件的包')
    .option('--deep', '递归扫描（较慢）')
    .option('--json', '以 JSON 输出')
    .allowUnknownOptions()
  cli
    .command('where <pkg>', '精确定位包目录与可执行文件')
    .option('--bin', '只输出可执行文件路径')
    .option('--local', '只看本地')
    .option('--global', '只看全局')
    .allowUnknownOptions()
  cli
    .command('go <cmd> [args...]', '统一 npx / dlx（也可以直接用 xgo 命令）')
    .option('--sudo', '用 sudo 执行（默认不加）')
    .option('--pm <pm>', '强制指定用哪个包管理器的 runner')
    .allowUnknownOptions()
  cli
    .command('use <pm>', '写入 packageManager 字段并切换')
    .allowUnknownOptions()

  cli.command('* [args...]', '运行 package.json 里的脚本').allowUnknownOptions()

  cli.help()
  cli.version(readVersion())

  return cli
}

/* -------------------------------------------------------------------------- */
/* 分发                                                                         */
/* -------------------------------------------------------------------------- */

async function dispatch(parsed: ParsedArgv): Promise<number> {
  const rawCommand = parsed.rest[0]
  const args = parsed.rest.slice(1)

  // --version / -v 最早短路，避免为了打印版本号去检测包管理器
  if (parsed.version && !rawCommand) {
    log.info(readVersion())
    return 0
  }

  const loaded = await loadConfig(process.cwd())
  const config = loaded.config

  const command = resolveCommandName(rawCommand, config)

  /* 无命令 / help */
  if (!rawCommand || command === 'help' || (parsed.help && !command)) {
    buildHelpCli().outputHelp()
    return 0
  }

  /* 未识别的命令 → 当作 package.json 脚本 */
  if (!command) {
    return runCommand(rawCommand, args, await makeContext(parsed, config))
  }

  const ctx = await makeContext(parsed, config)

  switch (command) {
    case 'install':
      return installCommand(args, ctx)
    case 'add':
      return addCommand(args, ctx)
    case 'remove':
      return removeCommand(args, ctx)
    case 'update':
      return updateCommand(args, ctx)
    case 'list':
      return listCommand(args, ctx)
    case 'run':
      return runCommand(args[0], args.slice(1), ctx)
    case 'exec':
      return execCommand(args[0], args.slice(1), ctx)
    case 'search':
      return searchCommand(
        {
          keyword: args[0],
          source: parsed.source,
          limit: parsed.limit,
          json: parsed.json,
          where: parsed.where,
        },
        ctx,
      )
    case 'find':
      return findCommand(
        {
          keyword: args[0],
          local: parsed.local,
          global: parsed.global,
          bin: parsed.bin,
          deep: parsed.deep,
          json: parsed.json,
        },
        ctx,
      )
    case 'where':
      return whereCommand(
        {
          name: args[0],
          bin: parsed.bin,
          local: parsed.local,
          global: parsed.global,
        },
        ctx,
      )
    case 'go':
      return goCommand(
        { command: args[0], args: args.slice(1), sudo: parsed.sudo, pm: parsed.pm },
        ctx,
      )
    case 'use':
      return useCommand(args[0], ctx)
    default:
      log.error(`未知命令：${rawCommand ?? ''}`)
      return 1
  }
}

/** 构造命令上下文：检测包管理器 + 组装配置 */
async function makeContext(parsed: ParsedArgv, config: XConfig): Promise<CommandContext> {
  const force: PackageManager | undefined =
    parsed.pm && isPackageManager(parsed.pm) ? parsed.pm : undefined

  const detected = detectPackageManager({
    force,
    configDefaultPM: config.defaultPM,
  })

  return {
    pm: detected.pm,
    root: detected.root,
    cwd: process.cwd(),
    sudo: parsed.sudo,
    config,
  }
}

/* -------------------------------------------------------------------------- */
/* 入口                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * CLI 主入口。
 *
 * @param argv 原始参数（不含 node 与脚本路径）
 * @returns 退出码
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv)

  // cac 只用来生成帮助文本，业务分发走自己的解析
  const cli = buildHelpCli()

  if (parsed.help && parsed.rest.length === 0) {
    cli.outputHelp()
    return 0
  }

  try {
    return await dispatch(parsed)
  } catch (error) {
    log.error((error as Error).message ?? String(error))
    return 1
  }
}

/** 根据被调用的文件名判断是不是 xgo（第二个 bin） */
export function normalizeArgv(argv: string[]): string[] {
  const invokedAs = basename(process.argv[1] ?? '')
  return invokedAs === 'xgo' ? ['go', ...argv] : argv
}

export { buildHelpCli }