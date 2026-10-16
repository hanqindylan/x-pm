import pc from 'picocolors'

/**
 * 统一的颜色出口。
 *
 * picocolors 会自动判断当前环境是否支持颜色（非 TTY、NO_COLOR 等场景自动降级为纯文本），
 * 所有 UI 模块只从这里取色，方便以后整体替换或关闭。
 */
export const colors = pc

export type Colors = typeof pc