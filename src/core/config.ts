import { readFileSync } from 'node:fs'

import { findUp } from 'find-up'

import type { PackageManager, XConfig } from '../types'
import { isPackageManager } from './detect'

/** 配置文件名 */
export const CONFIG_FILENAME = '.xrc.json'

/** 加载结果 */
export interface LoadedConfig {
  /** 解析后的配置，未找到配置文件时为空对象 */
  config: XConfig
  /** 配置文件绝对路径，未找到时为 undefined */
  path?: string
  /** 配置文件所在目录 */
  dir?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析并校验 `.xrc.json` 的内容。
 *
 * 非法字段会被丢弃并给出中文警告，而不是直接抛错——
 * 配置文件写错不该让整个命令跑不起来。
 */
export function parseConfig(raw: string, source = CONFIG_FILENAME): XConfig {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`${source} 不是合法的 JSON，请检查格式`)
  }

  if (!isPlainObject(data)) {
    throw new Error(`${source} 的内容必须是一个 JSON 对象`)
  }

  const config: XConfig = {}

  if (data.registry !== undefined) {
    if (typeof data.registry === 'string' && data.registry.trim()) {
      config.registry = data.registry.trim()
    } else {
      warnField(source, 'registry', '必须是非空字符串，已忽略')
    }
  }

  if (data.defaultPM !== undefined) {
    if (isPackageManager(data.defaultPM)) {
      config.defaultPM = data.defaultPM
    } else {
      warnField(source, 'defaultPM', '必须是 npm / pnpm / bun / yarn 之一，已忽略')
    }
  }

  if (data.searchLimit !== undefined) {
    const limit = data.searchLimit
    if (typeof limit === 'number' && Number.isInteger(limit) && limit > 0) {
      config.searchLimit = limit
    } else {
      warnField(source, 'searchLimit', '必须是正整数，已忽略')
    }
  }

  if (data.aliases !== undefined) {
    if (isPlainObject(data.aliases)) {
      const aliases: Record<string, string> = {}
      for (const [key, value] of Object.entries(data.aliases)) {
        if (key && typeof value === 'string' && value.trim()) {
          aliases[key] = value.trim()
        }
      }
      if (Object.keys(aliases).length > 0) config.aliases = aliases
    } else {
      warnField(source, 'aliases', '必须是字符串到字符串的对象，已忽略')
    }
  }

  return config
}

function warnField(source: string, field: string, reason: string): void {
  process.stderr.write(`[x] ${source} 的 ${field} 字段${reason}\n`)
}

/**
 * 从 cwd 向上查找并加载 `.xrc.json`。
 *
 * 找不到文件时返回空配置，不视为错误。
 * @param cwd 起始目录，默认 process.cwd()
 * @param filename 配置文件名，默认 .xrc.json
 */
export async function loadConfig(cwd: string = process.cwd(), filename: string = CONFIG_FILENAME): Promise<LoadedConfig> {
  const path = await findUp(filename, { cwd })
  if (!path) return { config: {} }

  const config = parseConfig(readFileSync(path, 'utf8'), filename)

  // findUp 返回的是文件的绝对路径，目录取 dirname
  const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
  return { config, path, dir: dir || cwd }
}

/** 校验一个字符串是否是受支持的包管理器，用于 `--pm` 参数 */
export function toPackageManager(value: string): PackageManager | undefined {
  const trimmed = value.trim()
  return isPackageManager(trimmed) ? trimmed : undefined
}