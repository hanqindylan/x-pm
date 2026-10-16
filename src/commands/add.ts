import type { CommandContext } from '../types'
import { runAction } from '../core/exec'
import { log } from '../ui/log'

/**
 * `x a <pkg...>` —— 添加依赖。
 *
 * - 支持 `-D` / `--save-dev` 写入 devDependencies；
 * - 支持一次添加多个包；
 * - 其余参数原样透传（例如 `--legacy-peer-deps`）。
 */
export async function addCommand(args: string[], ctx: CommandContext): Promise<number> {
  const packages = args.filter((arg) => !arg.startsWith('-'))
  const flags = args.filter((arg) => arg.startsWith('-'))

  if (packages.length === 0) {
    log.error('请指定要添加的包名，例如：x a axios')
    log.hint('添加开发依赖：x a -D typescript')
    return 1
  }

  const result = await runAction(ctx.pm, 'add', [...flags, ...packages], { cwd: ctx.root })
  return result.exitCode
}