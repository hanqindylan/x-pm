import type { CommandContext, GoStrategy } from '../types'
import { run, runAction } from '../core/exec'
import { findInPath, findLocalBin } from '../core/resolve-bin'
import { confirmSudoRetry, isPermissionError } from '../core/sudo'
import { log } from '../ui/log'

/** `xgo` 的可选项 */
export interface GoCommandOptions {
  command: string | undefined
  args: string[]
  /** 显式要求 sudo */
  sudo?: boolean | undefined
  /** 强制指定用哪个包管理器的 runner */
  pm?: string | undefined
}

/**
 * `xgo <cmd> [args...]` —— 统一 npx / pnpm dlx / bun x / yarn dlx。
 *
 * 执行顺序：
 *   1. 本地 `node_modules/.bin/<cmd>` 存在 → 直接执行
 *   2. PATH 里能找到 → 直接执行
 *   3. 交给当前包管理器的 dlx（npm 走 npx）
 *
 * sudo 规则：只有显式 `--sudo`，或执行失败且命中权限错误并且用户确认，才会提权。
 */
export async function goCommand(options: GoCommandOptions, ctx: CommandContext): Promise<number> {
  const command = options.command
  if (!command) {
    log.error('请指定要执行的命令，例如：xgo cowsay hi')
    return 1
  }

  const args = options.args
  const pm = (options.pm as CommandContext['pm'] | undefined) ?? ctx.pm
  const wantSudo = options.sudo === true

  /* 1. 本地 node_modules/.bin */
  const localBin = findLocalBin(ctx.root, command)
  if (localBin) {
    log.hint(`命中本地可执行文件：${localBin}`)
    return finish(await run(command, args, { cwd: ctx.root, sudo: wantSudo }), args, wantSudo, ctx, pm, command)
  }

  /* 2. PATH */
  const pathBin = findInPath(command)
  if (pathBin) {
    log.hint(`命中 PATH：${pathBin}`)
    return finish(await run(command, args, { cwd: ctx.root, sudo: wantSudo }), args, wantSudo, ctx, pm, command)
  }

  /* 3. 交给包管理器的 dlx */
  log.hint(`本地与 PATH 都没有 ${command}，使用 ${pm} dlx 执行`)
  return finish(
    await runAction(pm, 'dlx', [command, ...args], { cwd: ctx.root, sudo: wantSudo }),
    args,
    wantSudo,
    ctx,
    pm,
    command,
  )
}

/** 执行结束后的收尾：非零退出码且是权限问题时，询问是否 sudo 重试 */
async function finish(
  result: { exitCode: number; stdout: string; stderr: string },
  args: string[],
  alreadySudo: boolean,
  ctx: CommandContext,
  pm: CommandContext['pm'],
  command: string,
): Promise<number> {
  if (result.exitCode === 0) return 0
  if (alreadySudo) return result.exitCode
  if (!isPermissionError(`${result.stderr}\n${result.stdout}`)) return result.exitCode

  if (!(await confirmSudoRetry())) return result.exitCode

  log.hint('已确认，使用 sudo 重试')
  const retry = await runAction(pm, 'dlx', [command, ...args], { cwd: ctx.root, sudo: true })
  return retry.exitCode
}

/** 供文档/帮助使用：xgo 的策略说明 */
export const GO_STRATEGIES: Record<GoStrategy, string> = {
  'local-bin': '本地 node_modules/.bin',
  path: 'PATH 环境变量',
  runner: '包管理器 dlx',
}