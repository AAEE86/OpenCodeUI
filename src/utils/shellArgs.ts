/**
 * 启动参数行切分：一行一条完整参数（如 `--hostname 0.0.0.0`），
 * 按空白拆分，双/单引号可包裹含空格的值（如 --cors "https://a b"）。
 * 未闭合引号按字面保留到行尾。空行返回空数组。
 */
export function splitServeArgLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}
