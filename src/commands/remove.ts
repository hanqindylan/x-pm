import type { CommandContext } from '../types'
import { runAction } from '../core/exec'
import { log } from '../ui/log'

/**
 * `x r <pkg...>` —— 移除依赖。
 */
export async function removeCommand(args: string[], ctx: CommandContext): Promise<number> {
  const packages = args.filter((arg) => !arg.startsWith('-'))

  if (packages.length === 0) {
    log.error('请指定要移除的包名，例如：x r lodash')
    return 1
  }

  const result = await runAction(ctx.pm, 'remove', args, { cwd: ctx.root })
  return result.exitCode
}