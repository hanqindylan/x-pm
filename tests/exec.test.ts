import { describe, expect, it } from 'vitest'

import { buildCommand, orderFlagsFirst } from '../src/core/exec'

/**
 * 命令映射表的单测。
 *
 * 这张表是整个工具的核心，直接对照需求文档里的映射表逐条断言。
 */
describe('buildCommand 命令映射表', () => {
  it('x i', () => {
    expect(buildCommand('npm', 'install')).toEqual({ command: 'npm', args: ['install'] })
    expect(buildCommand('pnpm', 'install')).toEqual({ command: 'pnpm', args: ['install'] })
    expect(buildCommand('yarn', 'install')).toEqual({ command: 'yarn', args: ['install'] })
    expect(buildCommand('bun', 'install')).toEqual({ command: 'bun', args: ['install'] })
  })

  it('x a <pkg>', () => {
    expect(buildCommand('npm', 'add', ['axios'])).toEqual({
      command: 'npm',
      args: ['install', 'axios'],
    })
    expect(buildCommand('pnpm', 'add', ['axios'])).toEqual({
      command: 'pnpm',
      args: ['add', 'axios'],
    })
    expect(buildCommand('yarn', 'add', ['axios'])).toEqual({
      command: 'yarn',
      args: ['add', 'axios'],
    })
    expect(buildCommand('bun', 'add', ['axios'])).toEqual({
      command: 'bun',
      args: ['add', 'axios'],
    })
  })

  it('x a -D <pkg> 选项排在包名之前', () => {
    expect(buildCommand('npm', 'add', ['-D', 'typescript'])).toEqual({
      command: 'npm',
      args: ['install', '-D', 'typescript'],
    })
    expect(buildCommand('pnpm', 'add', ['--save-dev', 'typescript'])).toEqual({
      command: 'pnpm',
      args: ['add', '--save-dev', 'typescript'],
    })
  })

  it('x a 支持多个包', () => {
    expect(buildCommand('pnpm', 'add', ['axios', 'lodash'])).toEqual({
      command: 'pnpm',
      args: ['add', 'axios', 'lodash'],
    })
  })

  it('x r <pkg>', () => {
    expect(buildCommand('npm', 'remove', ['lodash'])).toEqual({
      command: 'npm',
      args: ['uninstall', 'lodash'],
    })
    expect(buildCommand('pnpm', 'remove', ['lodash'])).toEqual({
      command: 'pnpm',
      args: ['remove', 'lodash'],
    })
    expect(buildCommand('yarn', 'remove', ['lodash'])).toEqual({
      command: 'yarn',
      args: ['remove', 'lodash'],
    })
    expect(buildCommand('bun', 'remove', ['lodash'])).toEqual({
      command: 'bun',
      args: ['remove', 'lodash'],
    })
  })

  it('x run <script>', () => {
    expect(buildCommand('npm', 'run', ['dev'])).toEqual({ command: 'npm', args: ['run', 'dev'] })
    expect(buildCommand('pnpm', 'run', ['dev'])).toEqual({ command: 'pnpm', args: ['run', 'dev'] })
    expect(buildCommand('yarn', 'run', ['dev'])).toEqual({ command: 'yarn', args: ['run', 'dev'] })
    expect(buildCommand('bun', 'run', ['dev'])).toEqual({ command: 'bun', args: ['run', 'dev'] })
  })

  it('x exec <cmd>', () => {
    expect(buildCommand('npm', 'exec', ['eslint', '.'])).toEqual({
      command: 'npm',
      args: ['exec', '--', 'eslint', '.'],
    })
    expect(buildCommand('pnpm', 'exec', ['eslint', '.'])).toEqual({
      command: 'pnpm',
      args: ['exec', 'eslint', '.'],
    })
    expect(buildCommand('yarn', 'exec', ['eslint', '.'])).toEqual({
      command: 'yarn',
      args: ['exec', 'eslint', '.'],
    })
    expect(buildCommand('bun', 'exec', ['eslint', '.'])).toEqual({
      command: 'bun',
      args: ['x', 'eslint', '.'],
    })
  })

  it('xgo：npm 走 npx，其余走 dlx / x', () => {
    expect(buildCommand('npm', 'dlx', ['cowsay', 'hi'])).toEqual({
      command: 'npx',
      args: ['cowsay', 'hi'],
    })
    expect(buildCommand('pnpm', 'dlx', ['cowsay', 'hi'])).toEqual({
      command: 'pnpm',
      args: ['dlx', 'cowsay', 'hi'],
    })
    expect(buildCommand('yarn', 'dlx', ['cowsay', 'hi'])).toEqual({
      command: 'yarn',
      args: ['dlx', 'cowsay', 'hi'],
    })
    expect(buildCommand('bun', 'dlx', ['cowsay', 'hi'])).toEqual({
      command: 'bun',
      args: ['x', 'cowsay', 'hi'],
    })
  })

  it('未知参数原样透传，不丢失不乱序', () => {
    expect(buildCommand('npm', 'install', ['--legacy-peer-deps'])).toEqual({
      command: 'npm',
      args: ['install', '--legacy-peer-deps'],
    })
    expect(buildCommand('pnpm', 'run', ['dev', '--port', '3000'])).toEqual({
      command: 'pnpm',
      args: ['run', 'dev', '--port', '3000'],
    })
  })
})

describe('orderFlagsFirst', () => {
  it('把选项排到位置参数前面', () => {
    expect(orderFlagsFirst(['axios', '-D'])).toEqual(['-D', 'axios'])
    expect(orderFlagsFirst(['axios', 'lodash'])).toEqual(['axios', 'lodash'])
    expect(orderFlagsFirst([])).toEqual([])
  })
})