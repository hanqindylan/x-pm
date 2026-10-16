import which from 'which'

/** 匹配权限不足的特征串 */
const PERMISSION_PATTERNS = [
  /EACCES/,
  /EPERM/,
  /permission denied/i,
  /operation not permitted/i,
  /拒绝访问/,
]

/** 当前系统是否支持 sudo（Windows 没有） */
export function isSudoSupported(): boolean {
  if (process.platform === 'win32') return false
  try {
    return Boolean(which.sync('sudo'))
  } catch {
    return false
  }
}

/**
 * 判断一个错误是否属于「权限不足」。
 *
 * 用于 xgo 失败后决定要不要提示用户用 sudo 重试。
 */
export function isPermissionError(error: unknown): boolean {
  if (!error) return false

  const parts: string[] = []
  if (error instanceof Error) {
    parts.push(error.message)
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === 'string') parts.push(stderr)
  } else {
    parts.push(String(error))
  }

  const text = parts.join('\n')
  return PERMISSION_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * 询问用户是否用 sudo 重试。
 *
 * - 显式传了 --sudo 时不会走到这里；
 * - 非交互环境（管道、CI）直接返回 false，避免挂起等待输入；
 * - 用户取消同样返回 false，绝不擅自加 sudo。
 */
export async function confirmSudoRetry(): Promise<boolean> {
  if (!isSudoSupported()) {
    process.stderr.write('[x] 当前系统没有可用的 sudo，请用管理员权限手动重试\n')
    return false
  }

  if (!process.stdin.isTTY) return false

  try {
    const prompts = (await import('prompts')).default
    const answer = (await prompts({
      type: 'confirm',
      name: 'retry',
      message: '检测到权限问题，是否用 sudo 重试？',
      initial: false,
    })) as { retry?: boolean }

    return answer.retry === true
  } catch {
    // 交互失败（无 TTY、被中断等）一律视为不重试
    return false
  }
}