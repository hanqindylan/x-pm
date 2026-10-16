import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CommandContext } from '../types'
import { runAction } from '../core/exec'
import { log } from '../ui/log'

/** 读取 package.json 里的 scripts */
function readScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    return pkg.scripts ?? {}
  } catch {
    return {}
  }
}

/**
 * `x run <script> [...args]` / `x <script> [...args]` —— 运行 package.json 脚本。
 *
 * 脚本后面的参数原样透传，例如 `x dev --port 3000`。
 */
export async function runCommand(
  script: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<number> {
  if (!script) {
    const scripts = readScripts(ctx.root)
    const names = Object.keys(scripts)

    log.error('请指定要运行的脚本名，例如：x dev')
    if (names.length > 0) {
      log.hint(`当前项目可用的脚本：${names.join('、')}`)
    } else {
      log.hint('当前项目的 package.json 里还没有 scripts')
    }
    return 1
  }

  const result = await runAction(ctx.pm, 'run', [script, ...args], { cwd: ctx.root })
  return result.exitCode
}