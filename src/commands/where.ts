import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { CommandContext, WhereResult } from '../types'
import { getGlobalBinDir, getGlobalRoot } from '../core/exec'
import {
  findInPath,
  findLocalBin,
  findPackageDir,
  listBinNames,
  readPackageJson,
} from '../core/resolve-bin'
import { log } from '../ui/log'

/** 全局 node_modules 下的包目录 */
function findGlobalPackageDir(name: string, globalRoot: string | undefined): string | undefined {
  if (!globalRoot) return undefined
  const dir = join(globalRoot, ...name.split('/'))
  return existsSync(join(dir, 'package.json')) ? dir : undefined
}

/** 全局 bin 目录下的可执行文件 */
function findGlobalBin(binDir: string | undefined, name: string): string | undefined {
  if (!binDir) return undefined
  for (const candidate of [name, `${name}.cmd`, `${name}.exe`]) {
    const full = join(binDir, candidate)
    if (existsSync(full)) return full
  }
  return undefined
}

/** 在全局与本地都找一个名为 name 的可执行文件 */
function findBinByPackage(globalRoot: string | undefined, name: string): string | undefined {
  if (!globalRoot) return undefined
  const dir = join(globalRoot, ...name.split('/'))
  const meta = readPackageJson(dir)
  const bins = listBinNames(meta)
  if (bins.length === 0) return undefined
  return bins[0]
}

/** 解析一个包的全部路径信息 */
export async function resolveWhere(
  name: string,
  options: { root: string; pm: CommandContext['pm'] },
): Promise<WhereResult> {
  const globalRoot = await getGlobalRoot(options.pm)
  const globalBinDir = await getGlobalBinDir(options.pm)

  const localDir = findPackageDir(name, options.root)
  const globalDir = findGlobalPackageDir(name, globalRoot)

  const meta = readPackageJson(localDir ?? globalDir)
  const binNames = listBinNames(meta)
  const binName = binNames[0] ?? name

  const localBin = findLocalBin(options.root, binName)
  const globalBin =
    findGlobalBin(globalBinDir, binName) ??
    findGlobalBin(globalBinDir, name) ??
    findGlobalBin(globalBinDir, findBinByPackage(globalRoot, name) ?? name)
  const pathBin = findInPath(binName) ?? findInPath(name)

  const result: WhereResult = { name }

  if (meta?.version) result.version = meta.version
  if (localDir) result.localDir = localDir
  if (globalDir) result.globalDir = globalDir
  if (localBin) result.localBin = localBin
  if (globalBin) result.globalBin = globalBin
  if (pathBin) result.pathBin = pathBin
  if (meta?.homepage) result.homepage = meta.homepage
  result.pm = options.pm

  return result
}

/** `x where` 的可选项 */
export interface WhereCommandOptions {
  name: string | undefined
  bin?: boolean | undefined
  local?: boolean | undefined
  global?: boolean | undefined
}

/**
 * `x where <包名>` —— 精确定位包目录与可执行文件。
 *
 * `--bin` 只输出可执行文件路径（每行一个），方便管道使用。
 */
export async function whereCommand(
  options: WhereCommandOptions,
  ctx: CommandContext,
): Promise<number> {
  const name = options.name?.trim()
  if (!name) {
    log.error('请指定包名，例如：x where eslint')
    return 1
  }

  const result = await resolveWhere(name, { root: ctx.root, pm: ctx.pm })

  const hasLocal = Boolean(result.localDir)
  const hasGlobal = Boolean(result.globalDir)

  if (!hasLocal && !hasGlobal && !result.pathBin) {
    log.warn(`没有找到 ${name}`)
    log.hint(`可以先安装：x a ${name}`)
    return 1
  }

  /* --bin：只输出路径 */
  if (options.bin) {
    const paths: string[] = []
    if (result.localBin) paths.push(result.localBin)
    if (!options.local && result.globalBin) paths.push(result.globalBin)
    if (!options.local && !options.global && result.pathBin) paths.push(result.pathBin)

    if (paths.length === 0) {
      log.error(`${name} 没有可执行文件`)
      return 1
    }

    for (const path of paths) log.info(path)
    return 0
  }

  const onlyLocal = options.local === true
  const onlyGlobal = options.global === true

  const lines: string[] = []
  lines.push('')
  lines.push(`${result.name}${result.source ? `  (来源: ${result.source})` : ''}`)
  lines.push('')

  /* 包目录 */
  const dirs: string[] = []
  if (!onlyGlobal && result.localDir) dirs.push(`  本地:   ${result.localDir}`)
  if (!onlyLocal && result.globalDir) dirs.push(`  全局:   ${result.globalDir}`)
  if (dirs.length > 0) {
    lines.push('├─ 包目录')
    lines.push(...dirs)
    lines.push('│')
  }

  /* 可执行文件 */
  const bins: string[] = []
  if (!onlyGlobal && result.localBin) bins.push(`  本地:   ${result.localBin}`)
  if (!onlyLocal && result.globalBin) bins.push(`  全局:   ${result.globalBin}`)
  if (!onlyLocal && !onlyLocal && result.pathBin) bins.push(`  PATH:   ${result.pathBin}`)
  if (bins.length > 0) {
    lines.push('├─ 可执行文件')
    lines.push(...bins)
    lines.push('│')
  }

  /* 元信息 */
  const meta: string[] = []
  if (result.version) meta.push(`  版本:   ${result.version}`)
  if (result.pm) meta.push(`  来源:   ${result.pm}`)
  if (result.homepage) meta.push(`  主页:   ${result.homepage}`)
  if (meta.length > 0) {
    lines.push('└─ 元信息')
    lines.push(...meta)
  } else {
    // 没有元信息时，把最后一个区块的竖线收掉
    if (lines[lines.length - 1] === '│') lines.pop()
  }

  log.blank()
  log.info(lines.join('\n'))
  log.blank()

  return 0
}