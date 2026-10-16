import { execa } from 'execa'

import type { PackageManager, RunOptions, RunResult } from '../types'
import { log } from '../ui/log'
import { isSudoSupported } from './sudo'

/** x 支持的语义化操作 */
export type XAction =
  | 'install'
  | 'add'
  | 'remove'
  | 'update'
  | 'list'
  | 'run'
  | 'exec'
  | 'dlx'
  | 'global-root'
  | 'global-bin'
  | 'global-prefix'
  | 'version'

/** 单个包管理器下某个操作对应的真实命令 */
interface CommandSpec {
  /** 可执行文件名 */
  bin: string
  /** 固定参数 */
  args: string[]
}

/**
 * 命令映射表。
 *
 * `npm exec --` / `npx` 的 `--` 是必须的，否则 npm 会把参数当成自己的选项吃掉。
 * yarn v1 没有 `update`，对应的是 `upgrade`。
 */
const ACTIONS: Record<PackageManager, Record<XAction, CommandSpec>> = {
  npm: {
    install: { bin: 'npm', args: ['install'] },
    add: { bin: 'npm', args: ['install'] },
    remove: { bin: 'npm', args: ['uninstall'] },
    update: { bin: 'npm', args: ['update'] },
    list: { bin: 'npm', args: ['ls', '--depth=0'] },
    run: { bin: 'npm', args: ['run'] },
    exec: { bin: 'npm', args: ['exec', '--'] },
    dlx: { bin: 'npx', args: [] },
    'global-root': { bin: 'npm', args: ['root', '-g'] },
    'global-bin': { bin: 'npm', args: ['bin', '-g'] },
    'global-prefix': { bin: 'npm', args: ['prefix', '-g'] },
    version: { bin: 'npm', args: ['--version'] },
  },
  pnpm: {
    install: { bin: 'pnpm', args: ['install'] },
    add: { bin: 'pnpm', args: ['add'] },
    remove: { bin: 'pnpm', args: ['remove'] },
    update: { bin: 'pnpm', args: ['update'] },
    list: { bin: 'pnpm', args: ['list', '--depth=0'] },
    run: { bin: 'pnpm', args: ['run'] },
    exec: { bin: 'pnpm', args: ['exec'] },
    dlx: { bin: 'pnpm', args: ['dlx'] },
    'global-root': { bin: 'pnpm', args: ['root', '-g'] },
    'global-bin': { bin: 'pnpm', args: ['bin', '-g'] },
    'global-prefix': { bin: 'pnpm', args: ['root', '-g'] },
    version: { bin: 'pnpm', args: ['--version'] },
  },
  yarn: {
    install: { bin: 'yarn', args: ['install'] },
    add: { bin: 'yarn', args: ['add'] },
    remove: { bin: 'yarn', args: ['remove'] },
    update: { bin: 'yarn', args: ['upgrade'] },
    list: { bin: 'yarn', args: ['list', '--depth=0'] },
    run: { bin: 'yarn', args: ['run'] },
    exec: { bin: 'yarn', args: ['exec'] },
    dlx: { bin: 'yarn', args: ['dlx'] },
    'global-root': { bin: 'yarn', args: ['global', 'dir'] },
    'global-bin': { bin: 'yarn', args: ['bin', '-g'] },
    'global-prefix': { bin: 'yarn', args: ['global', 'dir'] },
    version: { bin: 'yarn', args: ['--version'] },
  },
  bun: {
    install: { bin: 'bun', args: ['install'] },
    add: { bin: 'bun', args: ['add'] },
    remove: { bin: 'bun', args: ['remove'] },
    update: { bin: 'bun', args: ['update'] },
    list: { bin: 'bun', args: ['ls'] },
    run: { bin: 'bun', args: ['run'] },
    exec: { bin: 'bun', args: ['x'] },
    dlx: { bin: 'bun', args: ['x'] },
    'global-root': { bin: 'bun', args: ['pm', 'bin', '-g'] },
    'global-bin': { bin: 'bun', args: ['pm', 'bin', '-g'] },
    'global-prefix': { bin: 'bun', args: ['prefix', '-g'] },
    version: { bin: 'bun', args: ['--version'] },
  },
}

/**
 * 把参数重排成「选项在前、位置参数在后」。
 *
 * `x a -D axios` → `axios -D` 会被各包管理器接受，但 `npm install -D axios`
 * 才是规范写法，重排后行为更一致。
 */
export function orderFlagsFirst(args: string[]): string[] {
  const flags = args.filter((arg) => arg.startsWith('-'))
  const rest = args.filter((arg) => !arg.startsWith('-'))
  return [...flags, ...rest]
}

/** 按包管理器拼出一条真实命令 */
export function buildCommand(
  pm: PackageManager,
  action: XAction,
  args: string[] = [],
): { command: string; args: string[] } {
  const spec = ACTIONS[pm]?.[action]
  if (!spec) throw new Error(`暂不支持 ${pm} 的 ${action} 操作`)

  const ordered = ['add', 'remove', 'install'].includes(action) ? orderFlagsFirst(args) : args
  return { command: spec.bin, args: [...spec.args, ...ordered] }
}

/**
 * 统一的子进程执行入口。
 *
 * - 默认 `stdio: 'inherit'`，dev server 之类交互式命令能正常读写；
 * - sudo 只在显式传 `sudo: true` 时生效，绝不默认提权；
 * - `reject: false`，非零退出码不抛异常，交给调用方决定。
 */
export async function run(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const { cwd = process.cwd(), sudo = false, silent = false, stdio = 'inherit' } = options

  let file = command
  let finalArgs = args

  if (sudo) {
    if (!isSudoSupported()) throw new Error('当前系统不支持 sudo')
    file = 'sudo'
    finalArgs = [command, ...args]
  }

  if (!silent) log.step([file, ...finalArgs].join(' '))

  const result = await execa(file, finalArgs, {
    cwd,
    stdio: stdio === 'inherit' ? 'inherit' : 'pipe',
    reject: false,
    extendEnv: true,
  })

  return {
    command: file,
    args: finalArgs,
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** 以包管理器语义化操作的方式执行，例如 runAction('pnpm', 'add', ['axios']) */
export async function runAction(
  pm: PackageManager,
  action: XAction,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const built = buildCommand(pm, action, args)
  return run(built.command, built.args, options)
}

/** 执行一条命令并捕获输出（不继承 stdio），失败或无输出时返回空字符串 */
export async function capture(command: string, args: string[] = [], cwd?: string): Promise<string> {
  try {
    const result = await execa(command, args, {
      cwd,
      reject: false,
      extendEnv: true,
      encoding: 'utf8',
    })
    if (typeof result.exitCode === 'number' && result.exitCode !== 0) return ''
    return (result.stdout ?? '').trim()
  } catch {
    return ''
  }
}

/** 全局安装目录（node_modules 的位置），带进程内缓存 */
const globalRootCache = new Map<PackageManager, string | undefined>()

/** 取包管理器的全局 node_modules 目录；拿不到时返回 undefined */
export async function getGlobalRoot(pm: PackageManager): Promise<string | undefined> {
  if (globalRootCache.has(pm)) return globalRootCache.get(pm)

  const { command, args } = buildCommand(pm, 'global-root')
  const out = await capture(command, args)

  const { existsSync } = await import('node:fs')
  const value = out && existsSync(out) ? out : undefined
  globalRootCache.set(pm, value)
  return value
}

/** 取包管理器的全局 bin 目录；拿不到时返回 undefined */
export async function getGlobalBinDir(pm: PackageManager): Promise<string | undefined> {
  const { command, args } = buildCommand(pm, 'global-bin')
  const out = await capture(command, args)
  return out || undefined
}

/** 取包管理器版本号，例如 10.9.7 */
export async function getPmVersion(pm: PackageManager): Promise<string | undefined> {
  const { command, args } = buildCommand(pm, 'version')
  const out = await capture(command, args)
  const version = out.split(/\s+/)[0]
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : undefined
}

/** 仅用于测试：清空全局目录缓存 */
export function clearGlobalCache(): void {
  globalRootCache.clear()
}