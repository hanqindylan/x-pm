import { describe, expect, it } from 'vitest'

import {
  CN_REGISTRY,
  NPM_REGISTRY,
  normalizeRegistryUrl,
  registryLabel,
  resolveRegistry,
  searchPackages,
} from '../src/core/registry'
import { parseArgv, resolveCommandName } from '../src/cli'
import { stringWidth } from '../src/ui/table'

describe('normalizeRegistryUrl', () => {
  it('去掉末尾斜杠与首尾空格', () => {
    expect(normalizeRegistryUrl('  https://registry.npmmirror.com/  ')).toBe(
      'https://registry.npmmirror.com',
    )
    expect(normalizeRegistryUrl('https://r.example.com///')).toBe('https://r.example.com')
  })
})

describe('registryLabel', () => {
  it('取 host 作为展示名', () => {
    expect(registryLabel(CN_REGISTRY)).toBe('registry.npmmirror.com')
    expect(registryLabel(NPM_REGISTRY)).toBe('registry.npmjs.org')
  })

  it('非法 URL 原样返回', () => {
    expect(registryLabel('不是-url')).toBe('不是-url')
  })
})

describe('resolveRegistry 优先级', () => {
  it('默认走国内源', () => {
    const result = resolveRegistry({ env: {} })
    expect(result.url).toBe(CN_REGISTRY)
    expect(result.origin).toBe('default')
  })

  it('环境变量 X_REGISTRY 覆盖默认值', () => {
    const result = resolveRegistry({ env: { X_REGISTRY: 'https://registry.example.com' } })
    expect(result.url).toBe('https://registry.example.com')
    expect(result.origin).toBe('env')
  })

  it('.xrc.json 的 registry 覆盖环境变量', () => {
    const result = resolveRegistry({
      config: { registry: 'https://from-config.com' },
      env: { X_REGISTRY: 'https://from-env.com' },
    })
    expect(result.url).toBe('https://from-config.com')
    expect(result.origin).toBe('config')
  })

  it('--source 覆盖配置文件', () => {
    const result = resolveRegistry({
      source: 'npm',
      config: { registry: 'https://from-config.com' },
      env: { X_REGISTRY: 'https://from-env.com' },
    })
    expect(result.url).toBe(NPM_REGISTRY)
    expect(result.origin).toBe('cli')
  })

  it('--source cn 显式使用国内源', () => {
    expect(resolveRegistry({ source: 'cn', env: {} }).url).toBe(CN_REGISTRY)
  })

  it('--source 也可以直接传 URL', () => {
    const result = resolveRegistry({ source: 'https://my.registry.dev/', env: {} })
    expect(result.url).toBe('https://my.registry.dev')
    expect(result.origin).toBe('cli')
  })
})

describe('searchPackages', () => {
  const mockFetch = (payload: unknown, ok = true, status = 200) => {
    const calls: string[] = []
    const fn = (async (url: string | URL) => {
      calls.push(String(url))
      return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Error',
        json: async () => payload,
      } as unknown as Response
    }) as unknown as typeof fetch
    return { fn, calls }
  }

  it('拼接正确的搜索接口并映射结果', async () => {
    const { fn, calls } = mockFetch({
      total: 2,
      objects: [
        {
          package: {
            name: 'react',
            version: '19.1.0',
            description: 'React is a JS library',
            publisher: { username: 'reactjs' },
            links: { homepage: 'https://react.dev' },
          },
        },
        {
          package: {
            name: 'react-dom',
            version: '19.1.0',
            description: 'React DOM',
          },
        },
      ],
    })

    const result = await searchPackages({
      registry: CN_REGISTRY,
      keyword: 'react',
      limit: 5,
      fetchImpl: fn,
    })

    expect(calls[0]).toBe(
      'https://registry.npmmirror.com/-/v1/search?text=react&size=5',
    )
    expect(result.total).toBe(2)
    expect(result.results[0]).toMatchObject({
      name: 'react',
      version: '19.1.0',
      description: 'React is a JS library',
      publisher: 'reactjs',
      homepage: 'https://react.dev',
    })
    // 没有 publisher 时回落到 '-'
    expect(result.results[1]?.publisher).toBe('-')
  })

  it('关键词会被 URL 编码', async () => {
    const { fn, calls } = mockFetch({ objects: [] })
    await searchPackages({ registry: CN_REGISTRY, keyword: '@vue/shared', fetchImpl: fn })
    expect(calls[0]).toContain('text=%40vue%2Fshared')
  })

  it('registry 返回非 2xx 时抛出中文错误', async () => {
    const { fn } = mockFetch({}, false, 503)
    await expect(
      searchPackages({ registry: CN_REGISTRY, keyword: 'x', fetchImpl: fn }),
    ).rejects.toThrow(/registry 返回错误：503/)
  })

  it('网络异常时抛出中文错误', async () => {
    const fn = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    await expect(
      searchPackages({ registry: CN_REGISTRY, keyword: 'x', fetchImpl: fn }),
    ).rejects.toThrow(/请求 registry 失败/)
  })
})

describe('parseArgv', () => {
  it('摘走 x 自己的选项，其余原样保留', () => {
    const parsed = parseArgv(['a', 'axios', '--save-dev', '--pm', 'pnpm'])
    expect(parsed.rest).toEqual(['a', 'axios'])
    expect(parsed.dev).toBe(true)
    expect(parsed.pm).toBe('pnpm')
  })

  it('支持等号写法', () => {
    const parsed = parseArgv(['search', 'react', '--source=npm', '--limit=20'])
    expect(parsed.rest).toEqual(['search', 'react'])
    expect(parsed.source).toBe('npm')
    expect(parsed.limit).toBe(20)
  })

  it('未知的选项原样透传给包管理器', () => {
    const parsed = parseArgv(['dev', '--port', '3000', '--legacy-peer-deps'])
    expect(parsed.rest).toEqual(['dev', '--port', '3000', '--legacy-peer-deps'])
  })

  it('-- 之后的内容全部透传', () => {
    const parsed = parseArgv(['a', 'axios', '--', '--pm'])
    expect(parsed.rest).toEqual(['a', 'axios', '--pm'])
    expect(parsed.pm).toBeUndefined()
  })

  it('识别全部布尔开关', () => {
    const parsed = parseArgv(['find', 'eslint', '--local', '--bin', '--deep', '--json'])
    expect(parsed.local).toBe(true)
    expect(parsed.bin).toBe(true)
    expect(parsed.deep).toBe(true)
    expect(parsed.json).toBe(true)
  })

  it('--version / -v 会被吃掉而不是当成脚本名', () => {
    expect(parseArgv(['--version']).version).toBe(true)
    expect(parseArgv(['-v']).version).toBe(true)
    expect(parseArgv(['--version']).rest).toEqual([])
  })

  it('非法 --limit 被忽略而不是变成 NaN', () => {
    expect(parseArgv(['search', 'x', '--limit=abc']).limit).toBeUndefined()
  })
})

describe('resolveCommandName', () => {
  it('识别内置别名', () => {
    expect(resolveCommandName('i', {})).toBe('install')
    expect(resolveCommandName('install', {})).toBe('install')
    expect(resolveCommandName('a', {})).toBe('add')
    expect(resolveCommandName('r', {})).toBe('remove')
    expect(resolveCommandName('up', {})).toBe('update')
    expect(resolveCommandName('ls', {})).toBe('list')
    expect(resolveCommandName('s', {})).toBe('search')
    expect(resolveCommandName('f', {})).toBe('find')
  })

  it('.xrc.json 里的别名生效', () => {
    expect(resolveCommandName('st', { aliases: { st: 'search' } })).toBe('search')
    // 指向未知命令时忽略
    expect(resolveCommandName('st', { aliases: { st: 'nope' } })).toBeUndefined()
  })

  it('无法识别时返回 undefined，交给脚本兜底', () => {
    expect(resolveCommandName('dev', {})).toBeUndefined()
    expect(resolveCommandName(undefined, {})).toBeUndefined()
  })
})

describe('stringWidth', () => {
  it('中文按 2 格计算', () => {
    expect(stringWidth('abc')).toBe(3)
    expect(stringWidth('中文')).toBe(4)
    expect(stringWidth('包名')).toBe(4)
  })

  it('忽略 ANSI 颜色码', () => {
    expect(stringWidth('[32mabc[39m')).toBe(3)
  })
})