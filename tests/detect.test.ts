/**
 * src/core/detect.ts 的单测。
 *
 * 所有用例都在临时目录里跑，互不干扰。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCKFILE_RULES,
  PACKAGE_MANAGERS,
  detectPackageManager,
  findProjectRoot,
  isPackageManager,
  parsePackageManagerField,
} from '../src/core/detect'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'x-pm-detect-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 在临时目录里写一个文件（自动创建父目录） */
function write(relativePath: string, content = ''): void {
  const target = join(dir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

/** 写一个带 packageManager 字段的 package.json */
function writePackageJson(extra: Record<string, unknown> = {}): void {
  write('package.json', JSON.stringify({ name: 'demo', version: '1.0.0', ...extra }))
}

describe('isPackageManager', () => {
  it('识别四个受支持的包管理器', () => {
    for (const pm of PACKAGE_MANAGERS) expect(isPackageManager(pm)).toBe(true)
  })

  it('拒绝其他值', () => {
    expect(isPackageManager('cnpm')).toBe(false)
    expect(isPackageManager('npm@9')).toBe(false)
    expect(isPackageManager(123)).toBe(false)
    expect(isPackageManager(null)).toBe(false)
  })
})

describe('parsePackageManagerField', () => {
  it('解析裸名称与带版本的写法', () => {
    expect(parsePackageManagerField('npm')).toBe('npm')
    expect(parsePackageManagerField('pnpm@9.15.0')).toBe('pnpm')
    expect(parsePackageManagerField('yarn@4.1.0+sha512.abcdef')).toBe('yarn')
    expect(parsePackageManagerField('bun@1.1.42')).toBe('bun')
  })

  it('容忍前后空格与大小写', () => {
    expect(parsePackageManagerField(' bun ')).toBe('bun')
    expect(parsePackageManagerField('PNPM@9.0.0')).toBe('pnpm')
  })

  it('无法识别的值返回 undefined', () => {
    expect(parsePackageManagerField('cnpm@1.0.0')).toBeUndefined()
    expect(parsePackageManagerField('@scope/pkg@1.0.0')).toBeUndefined()
    expect(parsePackageManagerField('')).toBeUndefined()
    expect(parsePackageManagerField('   ')).toBeUndefined()
    expect(parsePackageManagerField(undefined)).toBeUndefined()
    expect(parsePackageManagerField(123)).toBeUndefined()
  })
})

describe('findProjectRoot', () => {
  it('从子目录向上找到含 package.json 的目录', () => {
    writePackageJson()
    const nested = join(dir, 'packages', 'a', 'src')
    mkdirSync(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(dir)
  })

  it('从子目录向上找到含锁文件的目录', () => {
    write('pnpm-lock.yaml')
    const nested = join(dir, 'src', 'deep')
    mkdirSync(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(dir)
  })

  it('找不到标志文件时返回起始目录', () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty, { recursive: true })

    expect(findProjectRoot(empty)).toBe(empty)
  })
})

describe('detectPackageManager', () => {
  it('什么都没有时回落 npm', () => {
    const result = detectPackageManager({ cwd: dir, silent: true })

    expect(result.pm).toBe('npm')
    expect(result.source).toBe('fallback')
    expect(result.root).toBe(dir)
    expect(result.message).toContain('默认使用 npm')
  })

  it('识别 package-lock.json', () => {
    write('package-lock.json', '{}')
    const result = detectPackageManager({ cwd: dir, silent: true })

    expect(result.pm).toBe('npm')
    expect(result.source).toBe('lockfile')
    expect(result.lockfile).toBe('package-lock.json')
    expect(result.message).toBe('检测到 package-lock.json，使用 npm')
  })

  it('识别 pnpm-lock.yaml', () => {
    write('pnpm-lock.yaml')
    const result = detectPackageManager({ cwd: dir, silent: true })

    expect(result.pm).toBe('pnpm')
    expect(result.lockfile).toBe('pnpm-lock.yaml')
    expect(result.message).toBe('检测到 pnpm-lock.yaml，使用 pnpm')
  })

  it('识别 bun.lockb 与 bun.lock', () => {
    write('bun.lockb')
    expect(detectPackageManager({ cwd: dir, silent: true }).pm).toBe('bun')

    rmSync(join(dir, 'bun.lockb'))
    write('bun.lock', '{}')
    expect(detectPackageManager({ cwd: dir, silent: true }).pm).toBe('bun')
  })

  it('识别 yarn.lock', () => {
    write('yarn.lock')
    expect(detectPackageManager({ cwd: dir, silent: true }).pm).toBe('yarn')
  })

  it('锁文件优先级：npm > pnpm > bun > yarn', () => {
    write('yarn.lock')
    write('bun.lockb')
    write('pnpm-lock.yaml')
    write('package-lock.json', '{}')

    expect(detectPackageManager({ cwd: dir, silent: true }).lockfile).toBe('package-lock.json')

    rmSync(join(dir, 'package-lock.json'))
    expect(detectPackageManager({ cwd: dir, silent: true }).pm).toBe('pnpm')

    rmSync(join(dir, 'pnpm-lock.yaml'))
    expect(detectPackageManager({ cwd: dir, silent: true }).pm).toBe('bun')

    rmSync(join(dir, 'bun.lockb'))
    expect(detectPackageManager({ cwd: dir, silent: true }).pm).toBe('yarn')
  })

  it('packageManager 字段优先级高于任何锁文件', () => {
    write('package-lock.json', '{}')
    write('pnpm-lock.yaml')
    write('yarn.lock')
    writePackageJson({ packageManager: 'yarn@4.5.0' })

    const result = detectPackageManager({ cwd: dir, silent: true })

    expect(result.pm).toBe('yarn')
    expect(result.source).toBe('packageManager-field')
    expect(result.packageManagerField).toBe('yarn@4.5.0')
    expect(result.lockfile).toBeUndefined()
  })

  it('packageManager 字段无法识别时继续走锁文件', () => {
    writePackageJson({ packageManager: 'cnpm@9.0.0' })
    write('pnpm-lock.yaml')

    const result = detectPackageManager({ cwd: dir, silent: true })

    expect(result.pm).toBe('pnpm')
    expect(result.source).toBe('lockfile')
  })

  it('package.json 不是合法 JSON 时不崩溃', () => {
    write('package.json', '{ 这不是 JSON }')
    write('yarn.lock')

    const result = detectPackageManager({ cwd: dir, silent: true })

    expect(result.pm).toBe('yarn')
  })

  it('--pm 强制指定优先级最高', () => {
    write('package-lock.json', '{}')
    writePackageJson({ packageManager: 'pnpm@9.0.0' })

    const result = detectPackageManager({ cwd: dir, force: 'bun', silent: true })

    expect(result.pm).toBe('bun')
    expect(result.source).toBe('flag')
    expect(result.message).toBe('使用 --pm 指定的 bun')
  })

  it('无锁文件时使用 .xrc.json 的 defaultPM', () => {
    const result = detectPackageManager({ cwd: dir, configDefaultPM: 'pnpm', silent: true })

    expect(result.pm).toBe('pnpm')
    expect(result.source).toBe('config')
  })

  it('有锁文件时 defaultPM 不生效', () => {
    write('yarn.lock')
    const result = detectPackageManager({ cwd: dir, configDefaultPM: 'pnpm', silent: true })

    expect(result.pm).toBe('yarn')
    expect(result.source).toBe('lockfile')
  })

  it('从子目录执行时也能找到项目根', () => {
    writePackageJson()
    write('pnpm-lock.yaml')
    const nested = join(dir, 'src', 'commands')
    mkdirSync(nested, { recursive: true })

    const result = detectPackageManager({ cwd: nested, silent: true })

    expect(result.root).toBe(dir)
    expect(result.pm).toBe('pnpm')
  })

  it('默认向 stderr 打印一行提示，silent 时不打印', () => {
    write('pnpm-lock.yaml')

    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      detectPackageManager({ cwd: dir })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[0]).toBe('[x] 检测到 pnpm-lock.yaml，使用 pnpm\n')

      spy.mockClear()
      detectPackageManager({ cwd: dir, silent: true })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('LOCKFILE_RULES', () => {
  it('顺序必须是 npm > pnpm > bun > yarn', () => {
    expect(LOCKFILE_RULES.map((rule) => rule.pm)).toEqual(['npm', 'pnpm', 'bun', 'yarn'])
  })
})
