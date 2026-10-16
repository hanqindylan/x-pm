import { main, normalizeArgv } from './cli'
import { log } from './ui/log'

/**
 * 可执行入口。
 *
 * 通过 xgo 调用时（bin 里配了 xgo），自动把参数转成 `x go ...`。
 */
async function bootstrap(): Promise<void> {
  const argv = normalizeArgv(process.argv.slice(2))

  try {
    const code = await main(argv)
    process.exitCode = code
  } catch (error) {
    log.error((error as Error).message ?? String(error))
    process.exitCode = 1
  }
}

void bootstrap()