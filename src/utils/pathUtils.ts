// ============================================
// 路径工具
//
// v2 的文件条目只有 `{ path, type }`，没有 v1 的 `name` / `absolute`，
// 因此展示名与绝对路径需要由调用方派生。
//
// 放在 utils 而不是 api 层：这些是纯函数，不该经由 api 桶文件导出，
// 否则任何 mock 了 api 模块的测试都会拿到 undefined。
// ============================================

/** 从路径取 basename（兼容 / 与 \） */
export function fileBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

/** 把（根相对的）条目路径拼成绝对路径 */
export function toAbsoluteFilePath(path: string, directory?: string): string {
  if (!directory) return path
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path
  const separator = directory.includes('\\') ? '\\' : '/'
  const base = directory.replace(/[\\/]+$/, '')
  return `${base}${separator}${path.replace(/\//g, separator)}`
}

/** 统一分隔符为 /，去掉前导 ./ */
export function normalizePathSeparators(path: string): string {
  let result = path.replace(/\\/g, '/')
  if (result.startsWith('./')) result = result.slice(2)
  return result
}

/**
 * 逐段做 URL 编码（官方 `@opencode/util` 的 encodeFilePath 同款）。
 *
 * `new URL()` 会把空格自动转成 `%20`，但 `#` / `?` / `%` 会被当成结构字符：
 * 路径里带这些字符时，服务端 `new URL(uri)` + `fileURLToPath` 会截断或抛
 * `URI malformed`，附件直接读不到。所以发出去之前必须逐段编码。
 */
function encodeFilePath(normalized: string): string {
  // Windows 盘符补前导斜杠：C:/x → /C:/x
  const rooted = /^[a-zA-Z]:/.test(normalized)
    ? `/${normalized}`
    : normalized.startsWith('/')
      ? normalized
      : `/${normalized}`

  return rooted
    .split('/')
    .map((segment, index) => {
      // 保留盘符里的冒号（/C:/...），否则 fileURLToPath 认不出盘符
      if (index === 1 && /^[a-zA-Z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join('/')
}

/**
 * 绝对路径 → `file://` URL（服务端 `readFileAttachment` 只接受 file: 协议，
 * 裸路径会被 `new URL` 解析成盘符协议而 400）。
 *
 * Windows 盘符要三斜杠（`file:///C:/x`），Unix 绝对路径三斜杠
 * （`file:///x`）。路径分段做 URL 编码，空格 / `#` / `%` 等字符不会破坏 URI。
 */
export function absolutePathToFileUrl(path: string): string {
  return `file://${encodeFilePath(normalizePathSeparators(path))}`
}

/**
 * 折叠路径中的 `.` / `..` 段并统一为正斜杠（浏览器端的 path.resolve 单参数版）。
 * 保留盘符根（C:/）、UNC 前缀（//server/share）与 Unix 根（/）。
 *
 * @example
 * canonicalizePath('D:/data/../../../../../data/backup/') // 'D:/data/backup'
 * canonicalizePath('C:/a/./b/../c') // 'C:/a/c'
 */
export function canonicalizePath(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  // 识别根：'C:/' | '/' | '//'（UNC）
  const driveMatch = normalized.match(/^([a-zA-Z]:)(\/+)?/)
  const root = driveMatch ? `${driveMatch[1]}/` : normalized.startsWith('//') ? '//' : normalized.startsWith('/') ? '/' : ''
  const body = normalized.slice(root.length)
  const parts: string[] = []
  for (const part of body.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      // 根之上不能再 ..，直接丢弃（与 Node path.resolve 行为一致）
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!root) parts.push('..')
      continue
    }
    parts.push(part)
  }
  return root + parts.join('/')
}

/**
 * 把 `file.list` / `file.find` 返回的条目路径解析为绝对路径。
 *
 * v2 的条目 path 是**相对 location 根目录**的（可能带 `../`，浏览到根之外时），
 * 而不是相对被列出的目录。必须对 location 根做 resolve 并折叠 `..`，
 * 否则会拼出 `D:/data/../../../../../data/backup` 这种假绝对路径。
 *
 * @example
 * resolveEntryPath('../../data/backup/', 'C:/work/project') // 'C:/data/backup'
 */
export function resolveEntryPath(entryPath: string, locationRoot: string): string {
  const normalized = entryPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized === '.') return canonicalizePath(locationRoot)
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) return canonicalizePath(normalized)
  return canonicalizePath(`${locationRoot.replace(/[\\/]+$/, '')}/${normalized}`)
}
