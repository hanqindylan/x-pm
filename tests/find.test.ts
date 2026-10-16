import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearFindCache,
  collectFindEntries,
  listPackagesIn,
} from '../src/commands/find'
import { parseConfig } from '../src/core/config'
import { listBinNames, localBinDir, findLocalBin } from '../src/core/resolve-bin'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'x-pm-find-'))
  clearFindCache()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(relativePath: string, content: unknown): void {
  const target = join(dir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}

/** 在 node_modules 里造一个包 */
function makePackage(
  nodeModulesRel: string,
  name: string,
  extra: Record<string, unknown> = {},
): void {
  write(`${nodeModulesRel}/${name}/package.json`, { name, version: '1.0.0', ...extra })
}

describe('listPackagesIn', () => {
  it('列出顶层包与 @scope 一层，不递归', () => {
    makePackage('node_modules', 'axios')
    makePackage('node_modules', 'lodash')
    makePackage('node_modules', '@babel/core')
    makePackage('node_modules/axios/node_modules/ms', 'ms')

    const names = listPackagesIn(join(dir, 'node_modules')).sort()

    expect(names).toEqual(['@babel/core', 'axios', 'lodash'])
  })

  it('跳过 .bin / .cache 等内部目录', () => {
    makePackage('node_modules', 'axios')
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true })
    mkdirSync(join(dir, 'node_modules/.pnpm'), { recursive: true })

    expect(listPackagesIn(join(dir, 'node_modules'))).toEqual(['axios'])
  })

  it('目录不存在时返回空数组', () => {
    expect(listPackagesIn(join(dir, 'nope'))).toEqual([])
  })
})

describe('collectFindEntries', () => {
  it('识别本地包并标注依赖类型', async () => {
    write('package.json', {
      name: 'demo',
      dependencies: { axios: '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    })
    makePackage('node_modules', 'axios')
    makePackage('node_modules', 'typescript')

    const entries = await collectFindEntries({ root: dir, pm: 'npm', local: true })
    const byName = new Map(entries.map((entry) => [entry.name, entry]))

    expect(byName.get('axios')?.type).toBe('dependency')
    expect(byName.get('axios')?.location).toBe('local')
    expect(byName.get('typescript')?.type).toBe('devDependency')
  })

  it('包名是子串时按包含关系模糊匹配', async () => {
    makePackage('node_modules', 'eslint')
    makePackage('node_modules', '@typescript-eslint/parser')

    const entries = await collectFindEntries({ root: dir, pm: 'npm', local: true })
    expect(entries.map((entry) => entry.name)).toEqual(['@typescript-eslint/parser', 'eslint'])
  })

  it('--bin 只保留带可执行文件的包', async () => {
    makePackage('node_modules', 'axios')
    makePackage('node_modules', 'eslint', { bin: { eslint: 'bin/eslint.js' } })

    const entries = await collectFindEntries({
      root: dir,
      pm: 'npm',
      local: true,
      binOnly: true,
    })

    expect(entries.map((entry) => entry.name)).toEqual(['eslint'])
    expect(entries[0]?.hasBin).toBe(true)
    expect(entries[0]?.bins).toEqual(['eslint'])
  })

  it('bin 为字符串时用包名作为命令名', async () => {
    makePackage('node_modules', '@scope/tool', { bin: './cli.js' })

    const entries = await collectFindEntries({
      root: dir,
      pm: 'npm',
      local: true,
      binOnly: true,
    })

    expect(entries[0]?.bins).toEqual(['tool'])
  })

  it('能扫到 workspace 包的 node_modules', async () => {
    write('package.json', { name: 'root', workspaces: ['packages/*'] })
    write('packages/app/package.json', { name: 'app' })
    makePackage('packages/app/node_modules', 'lodash')

    const entries = await collectFindEntries({ root: dir, pm: 'npm', local: true })
    const lodash = entries.find((entry) => entry.name === 'lodash')

    expect(lodash?.location).toBe('workspace')
  })

  it('--deep 会递归进入包自己的 node_modules', async () => {
    makePackage('node_modules', 'axios')
    makePackage('node_modules/axios/node_modules', 'ms')

    const shallow = await collectFindEntries({ root: dir, pm: 'npm', local: true })
    expect(shallow.map((entry) => entry.name)).toEqual(['axios'])

    const deep = await collectFindEntries({ root: dir, pm: 'npm', local: true, deep: true })
    expect(deep.map((entry) => entry.name).sort()).toEqual(['axios', 'ms'])
  })

  it('结果按包名排序，保证输出稳定', async () => {
    makePackage('node_modules', 'vue')
    makePackage('node_modules', 'axios')
    makePackage('node_modules', 'lodash')

    const entries = await collectFindEntries({ root: dir, pm: 'npm', local: true })
    expect(entries.map((entry) => entry.name)).toEqual(['axios', 'lodash', 'vue'])
  })
})

describe('localBinDir / findLocalBin', () => {
  it('定位 node_modules/.bin 下的可执行文件', () => {
    const binDir = localBinDir(dir)
    expect(binDir).toBe(join(dir, 'node_modules', '.bin'))

    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'eslint'), '#!/bin/sh\n', { mode: 0o755 })

    expect(findLocalBin(dir, 'eslint')).toBe(join(binDir, 'eslint'))
    expect(findLocalBin(dir, 'not-exist')).toBeUndefined()
  })
})

describe('listBinNames', () => {
  it('对象形式的 bin 取所有键', () => {
    expect(listBinNames({ bin: { eslint: './a.js', prettier: './b.js' } })).toEqual([
      'eslint',
      'prettier',
    ])
  })

  it('字符串形式的 bin 用包名', () => {
    expect(listBinNames({ name: '@scope/tool', bin: './cli.js' })).toEqual(['tool'])
  })

  it('没有 bin 时返回空数组', () => {
    expect(listBinNames({ name: 'x' })).toEqual([])
    expect(listBinNames(undefined)).toEqual([])
  })
})

describe('parseConfig', () => {
  it('解析合法配置', () => {
    const config = parseConfig(
      JSON.stringify({
        registry: 'https://registry.npmmirror.com',
        defaultPM: 'pnpm',
        searchLimit: 20,
        aliases: { s: 'search' },
      }),
    )

    expect(config).toEqual({
      registry: 'https://registry.npmmirror.com',
      defaultPM: 'pnpm',
      searchLimit: 20,
      aliases: { s: 'search' },
    })
  })

  it('丢弃非法字段而不是抛错', () => {
    const config = parseConfig(
      JSON.stringify({ registry: 123, defaultPM: 'cnpm', searchLimit: -1, aliases: 'x' }),
    )
    expect(config).toEqual({})
  })

  it('JSON 语法错误时抛出中文错误', () => {
    expect(() => parseConfig('{ 坏掉的 }')).toThrow(/不是合法的 JSON/)
  })

  it('内容不是对象时抛出中文错误', () => {
    expect(() => parseConfig('[1,2]')).toThrow(/必须是一个 JSON 对象/)
  })
})