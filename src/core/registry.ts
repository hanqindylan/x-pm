import type {
  RegistrySearchResponse,
  ResolvedRegistry,
  SearchResult,
  XConfig,
} from '../types'

/** 国内源（默认） */
export const CN_REGISTRY = 'https://registry.npmmirror.com'
/** npm 官方源 */
export const NPM_REGISTRY = 'https://registry.npmjs.org'

/** 去掉首尾空白与末尾斜杠 */
export function normalizeRegistryUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** 取registry 的 host 用于展示，例如 npmmirror.com */
export function registryLabel(url: string): string {
  const normalized = normalizeRegistryUrl(url)
  try {
    return new URL(normalized).host
  } catch {
    return normalized
  }
}

/** resolveRegistry 的入参 */
export interface ResolveRegistryOptions {
  /** 命令行 `--source` 的值：npm / cn，也可直接传一个 URL */
  source?: string | undefined
  /** `.xrc.json` 里的配置 */
  config?: XConfig | undefined
  /** 环境变量，默认 process.env（测试可注入） */
  env?: Record<string, string | undefined> | undefined
}

/**
 * 解析最终使用的 registry。
 *
 * 优先级（从高到低）：
 *   1. 命令行 `--source`
 *   2. `.xrc.json` 的 `registry` 字段
 *   3. 环境变量 `X_REGISTRY`
 *   4. 默认国内源 npmmirror
 */
export function resolveRegistry(options: ResolveRegistryOptions = {}): ResolvedRegistry {
  const env = options.env ?? process.env

  // 1. 命令行
  if (options.source && options.source.trim()) {
    const raw = options.source.trim()
    const url =
      raw === 'npm' ? NPM_REGISTRY : raw === 'cn' ? CN_REGISTRY : normalizeRegistryUrl(raw)
    return { url, origin: 'cli', label: registryLabel(url) }
  }

  // 2. 配置文件
  if (options.config?.registry) {
    const url = normalizeRegistryUrl(options.config.registry)
    return { url, origin: 'config', label: registryLabel(url) }
  }

  // 3. 环境变量
  const fromEnv = env.X_REGISTRY
  if (fromEnv && fromEnv.trim()) {
    const url = normalizeRegistryUrl(fromEnv)
    return { url, origin: 'env', label: registryLabel(url) }
  }

  // 4. 默认国内源
  return { url: CN_REGISTRY, origin: 'default', label: registryLabel(CN_REGISTRY) }
}

/** searchPackages 的入参 */
export interface SearchPackagesOptions {
  /** 已解析好的 registry 地址 */
  registry: string
  /** 搜索关键词 */
  keyword: string
  /** 返回条数，默认 10 */
  limit?: number | undefined
  /** 注入 fetch，便于测试 */
  fetchImpl?: typeof fetch | undefined
  /** 超时毫秒数，默认 10000 */
  timeout?: number | undefined
}

/** searchPackages 的返回值 */
export interface SearchPackagesResult {
  results: SearchResult[]
  /** registry 报告的总数 */
  total: number
}

/** 把 registry 返回的原始对象转成 SearchResult */
function toSearchResult(
  object: NonNullable<RegistrySearchResponse['objects']>[number],
): SearchResult | undefined {
  const pkg = object.package
  if (!pkg?.name) return undefined

  const publisher = pkg.publisher?.username ?? pkg.maintainers?.[0]?.username ?? '-'

  return {
    name: pkg.name,
    version: pkg.version ?? '-',
    description: pkg.description ?? '',
    publisher,
    date: pkg.date,
    homepage: pkg.links?.homepage ?? pkg.links?.npm,
  }
}

/**
 * 远程搜索包。
 *
 * 接口：`GET {registry}/-/v1/search?text={keyword}&size={limit}`
 */
export async function searchPackages(options: SearchPackagesOptions): Promise<SearchPackagesResult> {
  const { registry, keyword } = options
  const limit = options.limit ?? 10
  const doFetch = options.fetchImpl ?? fetch

  const url = `${normalizeRegistryUrl(registry)}/-/v1/search?text=${encodeURIComponent(keyword)}&size=${limit}`

  let response: Response
  try {
    response = await doFetch(url, {
      signal: AbortSignal.timeout(options.timeout ?? 10_000),
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    throw new Error(`请求 registry 失败：${(error as Error).message}`)
  }

  if (!response.ok) {
    throw new Error(`registry 返回错误：${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as RegistrySearchResponse
  const objects = data.objects ?? []

  const results: SearchResult[] = []
  for (const object of objects) {
    const result = toSearchResult(object)
    if (result) results.push(result)
  }

  return { results, total: data.total ?? objects.length }
}