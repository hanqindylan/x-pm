import { colors } from './colors'

/** ANSI 颜色码匹配 */
const ANSI_PATTERN = /\[[0-9;]*m/g

/** 去掉 ANSI 颜色码，用于计算真实显示宽度 */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '')
}

/**
 * 单个码点的终端显示宽度。
 *
 * 0 = 零宽（组合字符、变体选择符、ZWJ）
 * 2 = 全角（CJK、假名、韩文、全角符号、绝大多数 emoji）
 * 1 = 其余
 */
function codePointWidth(code: number): number {
  // 零宽字符
  if (code === 0x200d) return 0 // ZWJ
  if (code >= 0x0300 && code <= 0x036f) return 0 // 组合附加符号
  if (code >= 0xfe00 && code <= 0xfe0f) return 0 // 变体选择符
  if (code >= 0x1f3fb && code <= 0x1f3ff) return 0 // 肤色修饰
  if (code >= 0xfe00 && code <= 0xfe0f) return 0

  // 全角
  if (code >= 0x1100 && code <= 0x115f) return 2 // 谚文字母
  if (code >= 0x2e80 && code <= 0x303e) return 2 // CJK 部首、标点
  if (code >= 0x3041 && code <= 0x33ff) return 2 // 平假名/片假名/注音
  if (code >= 0x3400 && code <= 0x4dbf) return 2 // 汉字扩展 A
  if (code >= 0x4e00 && code <= 0x9fff) return 2 // 基本汉字
  if (code >= 0xa000 && code <= 0xa4cf) return 2 // 彝文
  if (code >= 0xac00 && code <= 0xd7a3) return 2 // 韩文音节
  if (code >= 0xf900 && code <= 0xfaff) return 2 // CJK 兼容表意
  if (code >= 0xfe10 && code <= 0xfe19) return 2 // 竖排标点
  if (code >= 0xfe30 && code <= 0xfe6f) return 2 // CJK 兼容形式
  if (code >= 0xff00 && code <= 0xff60) return 2 // 全角 ASCII
  if (code >= 0xffe0 && code <= 0xffe6) return 2 // 全角货币
  if (code >= 0x1f300 && code <= 0x1f64f) return 2 // emoji
  if (code >= 0x1f900 && code <= 0x1f9ff) return 2 // 补充 emoji
  if (code >= 0x20000 && code <= 0x3fffd) return 2 // 汉字扩展 B~

  return 1
}

/** 字符串的终端显示宽度（中文按 2 计） */
export function stringWidth(input: string): number {
  let width = 0
  for (const char of stripAnsi(input)) {
    width += codePointWidth(char.codePointAt(0) ?? 0)
  }
  return width
}

/** 右侧补空格到指定显示宽度 */
export function padToWidth(input: string, width: number): string {
  const diff = width - stringWidth(input)
  return diff > 0 ? input + ' '.repeat(diff) : input
}

/** 截断到指定显示宽度，超出部分用省略号收尾 */
export function truncateToWidth(input: string, max: number): string {
  if (max <= 0) return ''
  if (stringWidth(input) <= max) return input

  let out = ''
  let width = 0
  for (const char of stripAnsi(input)) {
    const charWidth = codePointWidth(char.codePointAt(0) ?? 0)
    // 预留 1 格给省略号
    if (width + charWidth > max - 1) break
    out += char
    width += charWidth
  }
  return `${out}…`
}

/** 表格渲染参数 */
export interface TableOptions {
  /** 表头 */
  head: string[]
  /** 数据行 */
  rows: string[][]
  /** 每列最大显示宽度，超出截断；未给出的列不限制 */
  maxWidths?: Array<number | undefined>
  /** 是否给表头加粗，默认 true */
  boldHead?: boolean
}

/**
 * 渲染带边框的表格。
 *
 * 边框风格：┌ ┬ ┐ │ ├ ┼ ┤ └ ┴ ┘
 * 列宽按终端显示宽度计算，中文按 2 格对齐。
 */
export function renderTable(options: TableOptions): string {
  const { head, rows, maxWidths, boldHead = true } = options

  // 计算每列宽度
  const widths = head.map((cell, index) => {
    let natural = stringWidth(cell)
    for (const row of rows) {
      natural = Math.max(natural, stringWidth(row[index] ?? ''))
    }
    const limit = maxWidths?.[index]
    return limit !== undefined && natural > limit ? limit : natural
  })

  const border = (left: string, middle: string, right: string): string =>
    left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right

  const renderRow = (cells: string[], decorate?: (text: string) => string): string => {
    const padded = widths.map((width, index) => {
      const text = truncateToWidth(cells[index] ?? '', width)
      const paddedText = padToWidth(text, width)
      return ` ${decorate ? decorate(paddedText) : paddedText} `
    })
    return `│${padded.join('│')}│`
  }

  const lines = [
    border('┌', '┬', '┐'),
    renderRow(head, boldHead ? (text) => colors.bold(text) : undefined),
    border('├', '┼', '┤'),
    ...rows.map((row) => renderRow(row)),
    border('└', '┴', '┘'),
  ]

  return lines.join('\n')
}

/**
 * 渲染带缩进树的层级文本（用于 `x where`）。
 *
 * lines 里的每项形如 `{ indent: number; text: string }`，会自动补上树形连接符。
 */
export interface TreeNode {
  /** 缩进层级，0 为根 */
  indent: number
  text: string
  /** 是否为该层最后一项（影响连接符） */
  last?: boolean
  /** 前缀字符，默认 '├─' / '└─'；根节点为 '' */
  connector?: string
}

/** 渲染一棵带 │ 竖线的树 */
export function renderTree(nodes: TreeNode[]): string {
  return nodes
    .map((node, index) => {
      if (node.connector === '') return node.text

      const isLast = node.last ?? index === nodes.length - 1
      const prefix = node.connector ?? (isLast ? '└─' : '├─')

      // 计算前面需要补几根竖线：看之前同缩进层级的节点有没有结束
      let bars = ''
      for (let i = index - 1; i >= 0; i -= 1) {
        const prev = nodes[i]
        if (!prev) break
        if (prev.indent === undefined) continue
        if (prev.indent! < node.indent) {
          bars += prev.last ? '  ' : '│ '
        } else if (prev.indent! > node.indent) {
          continue
        } else {
          break
        }
      }

      return `${bars}${prefix}${node.text}`
    })
    .join('\n')
}