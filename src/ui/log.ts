import { colors } from './colors'

/** 全局前缀，保持与 detect.ts 输出一致 */
const PREFIX = '[x]'

/**
 * 日志输出。
 *
 * 约定：
 * - `info` / `success` 走 stdout，是命令的正常产物；
 * - 其余全部走 stderr，避免污染需要被管道消费的 stdout。
 */
export const log = {
  /** 包管理器检测提示，格式与 detect.ts 保持一致 */
  detect(message: string): void {
    process.stderr.write(`${PREFIX} ${message}\n`)
  },

  info(message: string): void {
    process.stdout.write(`${message}\n`)
  },

  success(message: string): void {
    process.stdout.write(`${colors.green('✔')} ${message}\n`)
  },

  /** 即将执行的命令 */
  step(message: string): void {
    process.stderr.write(`${colors.cyan('›')} ${message}\n`)
  },

  warn(message: string): void {
    process.stderr.write(`${colors.yellow('!')} ${message}\n`)
  },

  error(message: string): void {
    process.stderr.write(`${colors.red('✖')} ${message}\n`)
  },

  hint(message: string): void {
    process.stderr.write(`${colors.dim('提示：')} ${message}\n`)
  },

  blank(): void {
    process.stdout.write('\n')
  },
}