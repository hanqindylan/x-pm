import type { CommandContext } from '../types'
import { runAction } from '../core/exec'

/**
 * `x i` —— 安装依赖。
 *
 * 未知参数全部透传给底层包管理器。
 */
export async function installCommand(args: string[], ctx: CommandContext): Promise<number> {
  const result = await runAction(ctx.pm, 'install', args, { cwd: ctx.root })
  return result.exitCode
}

/**
 * `x ls` —— 列出顶层依赖，直接透传给包管理器。
 */
export async function listCommand(args: string[], ctx: CommandContext): Promise<number> {
  const result = await runAction(ctx.pm, 'list', args, { cwd: ctx.root })
  return result.exitCode
}

/**
 * `x up` —— 更新依赖。
 */
export async function updateCommand(args: string[], ctx: CommandContext): Promise<number> {
  const result = await runAction(ctx.pm, 'update', args, { cwd: ctx.root })
  return result.exitCode
}