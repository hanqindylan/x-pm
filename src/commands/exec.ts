import type { CommandContext } from '../types'
import { runAction } from '../core/exec'
import { confirmSudoRetry, isPermissionError } from '../core/sudo'
import { log } from '../ui/log'

/**
 * `x exec <cmd> [args...]` —— 执行本地可执行文件。
 *
 * 与 xgo 的区别：exec 只用包管理器自带的 exec，强制走项目本地环境。
 * 失败且是权限问题时，询问是否用 sudo 重试（绝不默认提权）。
 */
export async function execCommand(
  binary: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<number> {
  if (!binary) {
    log.error('请指定要执行的命令，例如：x exec eslint .')
    return 1
  }

  const allArgs = [binary, ...args]
  const first = await runAction(ctx.pm, 'exec', allArgs, { cwd: ctx.root, sudo: ctx.sudo })

  if (first.exitCode === 0) return 0

  const detail = `${first.stderr}\n${first.stdout}`
  if (ctx.sudo || !isPermissionError(detail)) return first.exitCode

  if (await confirmSudoRetry()) {
    log.hint('已确认，使用 sudo 重试')
    const second = await runAction(ctx.pm, 'exec', allArgs, { cwd: ctx.root, sudo: true })
    return second.exitCode
  }

  return first.exitCode
}