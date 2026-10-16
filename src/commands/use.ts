import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CommandContext, PackageManager } from '../types'
import { getPmVersion } from '../core/exec'
import { isPackageManager } from '../core/detect'
import { log } from '../ui/log'

/** 锁文件与包管理器的对应关系，用于切换后的提示 */
const LOCKFILES: Record<PackageManager, string[]> = {
  npm: ['package-lock.json'],
  pnpm: ['pnpm-lock.yaml'],
  bun: ['bun.lockb', 'bun.lock'],
  yarn: ['yarn.lock'],
}

/**
 * `x use <pm>` —— 写入 package.json 的 packageManager 字段并切换。
 *
 * 该字段是检测优先级最高的依据，写入后无需删锁文件也能立即生效。
 */
export async function useCommand(
  pm: string | undefined,
  ctx: CommandContext,
): Promise<number> {
  if (!pm) {
    log.error('请指定要切换的包管理器，例如：x use pnpm')
    log.hint('可选值：npm、pnpm、bun、yarn')
    return 1
  }

  if (!isPackageManager(pm)) {
    log.error(`不支持的包管理器：${pm}`)
    log.hint('可选值：npm、pnpm、bun、yarn')
    return 1
  }

  const target: PackageManager = pm
  const pkgPath = join(ctx.root, 'package.json')

  if (!existsSync(pkgPath)) {
    log.error(`当前目录没有 package.json：${ctx.root}`)
    return 1
  }

  let raw = ''
  let pkg: Record<string, unknown>
  try {
    raw = readFileSync(pkgPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('不是对象')
    }
    pkg = parsed as Record<string, unknown>
  } catch (error) {
    log.error(`无法读取 package.json：${(error as Error).message}`)
    return 1
  }

  const version = await getPmVersion(target)
  const previous = typeof pkg.packageManager === 'string' ? pkg.packageManager : undefined

  pkg.packageManager = version ? `${target}@${version}` : target

  try {
    // 保留原有缩进风格，末尾补一个换行
    const indent = detectIndent(raw)
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`, 'utf8')
  } catch (error) {
    log.error(`写入 package.json 失败：${(error as Error).message}`)
    return 1
  }

  log.blank()
  log.success(`已切换到 ${target}`)
  log.info(`  packageManager: ${previous ?? '(无)'} → ${pkg.packageManager}`)
  log.blank()

  // 提示残留的其他锁文件，但不自动删除
  const stale = Object.entries(LOCKFILES)
    .filter(([key]) => key !== target)
    .flatMap(([, files]) => files)
    .filter((file) => existsSync(join(ctx.root, file)))

  if (stale.length > 0) {
    log.warn(`目录里还残留其他包管理器的锁文件：${stale.join('、')}`)
    log.hint('packageManager 字段优先级最高，不删也不影响使用；想彻底切换可以手动清理')
  }

  log.hint('现在直接运行 x 命令就会使用 ' + target)
  log.blank()

  return 0
}

/** 从原始文本里猜 JSON 缩进，默认 2 空格 */
function detectIndent(raw: string): string | number {
  const match = raw.match(/\n([ \t]+)"/)
  if (!match?.[1]) return 2
  return match[1].includes('\t') ? '\t' : match[1].length
}