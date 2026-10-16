import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { CommandContext, SearchResult } from '../types'
import { getGlobalRoot } from '../core/exec'
import { registryLabel, resolveRegistry, searchPackages } from '../core/registry'
import { findLocalBin, findPackageDir } from '../core/resolve-bin'
import { log } from '../ui/log'
import { renderTable } from '../ui/table'

/** `x search` 的可选项 */
export interface SearchCommandOptions {
  keyword: string | undefined
  /** --source npm | cn | 完整 URL */
  source?: string | undefined
  /** --limit */
  limit?: number | undefined
  /** --json */
  json?: boolean
  /** --where：额外显示本地/全局路径 */
  where?: boolean
}

/**
 * 给搜索结果补上本地与全局路径信息（`--where`）。
 *
 * - 本地路径：`<root>/node_modules/<pkg>`
 * - 全局路径：`<npm root -g>/<pkg>`
 * - bin 路径：`<root>/node_modules/.bin/<pkg>`
 */
async function attachLocalInfo(results: SearchResult[], ctx: CommandContext): Promise<void> {
  const globalRoot = await getGlobalRoot(ctx.pm)

  for (const result of results) {
    const localDir = findPackageDir(result.name, ctx.root)
    if (localDir) result.localDir = localDir

    const localBin = findLocalBin(ctx.root, result.name)
    if (localBin) result.localBin = localBin

    if (globalRoot) {
      const globalDir = join(globalRoot, ...result.name.split('/'))
      if (existsSync(globalDir)) result.globalDir = globalDir
    }
  }
}

/**
 * `x search <关键词>` —— 远程搜索包。
 *
 * 默认走国内源 npmmirror。
 */
export async function searchCommand(
  options: SearchCommandOptions,
  ctx: CommandContext,
): Promise<number> {
  const keyword = options.keyword?.trim()
  if (!keyword) {
    log.error('请输入搜索关键词，例如：x search react')
    return 1
  }

  const registry = resolveRegistry({
    source: options.source,
    config: ctx.config,
  })

  const limit = options.limit ?? ctx.config.searchLimit ?? 10

  log.blank()
  log.info(`源: ${registry.label}    当前项目: ${ctx.pm}`)
  log.blank()

  let results: SearchResult[]
  try {
    const response = await searchPackages({ registry: registry.url, keyword, limit })
    results = response.results
  } catch (error) {
    log.error((error as Error).message)
    log.hint(`当前源：${registryLabel(registry.url)}，可用 --source npm 切换到官方源`)
    return 1
  }

  if (options.where) await attachLocalInfo(results, ctx)

  if (options.json) {
    log.info(JSON.stringify(results, null, 2))
    return 0
  }

  if (results.length === 0) {
    log.warn(`没有找到与「${keyword}」匹配的包`)
    return 0
  }

  if (options.where) {
    const table = renderTable({
      head: ['包名', '版本', '本地路径', '全局路径'],
      rows: results.map((result) => [
        result.name,
        result.version,
        result.localDir ?? '-',
        result.globalDir ?? '-',
      ]),
      maxWidths: [28, 14, 40, 40],
    })
    log.blank()
    log.info(table)
    log.blank()

    const withBin = results.filter((result) => result.localBin)
    if (withBin.length > 0) {
      log.info('本地可执行文件：')
      for (const result of withBin) {
        log.info(`  ${result.name} → ${result.localBin}`)
      }
      log.blank()
    }

    log.info(`安装：x a ${results[0]?.name ?? keyword}`)
    return 0
  }

  const table = renderTable({
    head: ['包名', '版本', '描述', '发布者'],
    rows: results.map((result) => [
      result.name,
      result.version,
      result.description,
      result.publisher,
    ]),
    maxWidths: [30, 14, 46, 18],
  })

  log.blank()
  log.info(table)
  log.blank()
  log.info(`安装：x a ${results[0]?.name ?? keyword}`)
  log.blank()

  return 0
}