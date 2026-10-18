// ============================================
// 文本格式保真（需求三）
//
// 保存时必须逐字节保持原文件的"格式性"差异，否则一次保存会产生整文件 diff：
//   - 行尾：CRLF / LF / CR（混合行尾默认拒绝保存）
//   - BOM：UTF-8 BOM 会被 TextDecoder 剥掉，写回要显式补回来
// 另外提供基线指纹（hashBytes），保存前用它判断"磁盘是否被别人改过"。
// ============================================

export type LineEnding = 'lf' | 'crlf' | 'cr' | 'mixed'

export interface TextFormat {
  eol: LineEnding
  bom: boolean
}

/** 混合行尾：保存必然整文件 diff，默认拒绝（由调用方转成可见错误） */
export class MixedLineEndingsError extends Error {
  constructor() {
    super('mixed line endings')
    this.name = 'MixedLineEndingsError'
  }
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2]
}

/** 探测原文的行尾风格（同时存在 CRLF 与裸 LF/CR 视为 mixed） */
export function detectLineEnding(bytes: Uint8Array): LineEnding {
  let crlf = 0
  let lf = 0
  let cr = 0

  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] === 0x0a) {
        crlf++
        index++
      } else {
        cr++
      }
    } else if (bytes[index] === 0x0a) {
      lf++
    }
  }

  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  if (kinds > 1) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (cr > 0) return 'cr'
  return 'lf'
}

/** 数一下三种行尾各出现多少次（"多数行尾"兜底用） */
export function countLineEndings(bytes: Uint8Array): { crlf: number; lf: number; cr: number } {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] === 0x0a) {
        crlf++
        index++
      } else {
        cr++
      }
    } else if (bytes[index] === 0x0a) {
      lf++
    }
  }
  return { crlf, lf, cr }
}

/** 混合行尾时的"多数派"行尾（并列时按 CRLF > LF > CR 取） */
export function majorityLineEnding(bytes: Uint8Array): Exclude<LineEnding, "mixed"> {
  const { crlf, lf, cr } = countLineEndings(bytes)
  if (crlf >= lf && crlf >= cr) return "crlf"
  if (lf >= cr) return "lf"
  return "cr"
}

export function detectTextFormat(bytes: Uint8Array): TextFormat {
  return { eol: detectLineEnding(bytes), bom: hasUtf8Bom(bytes) }
}

/**
 * 把编辑器里的文本按原文格式编码回字节。
 *
 * 顺序很关键：先把 CRLF/CR 统一成 LF，再按目标行尾替换，否则会出现 `\r\r\n`。
 */
export function encodeTextPreservingFormat(original: Uint8Array, text: string): Uint8Array {
  const format = detectTextFormat(original)
  if (format.eol === 'mixed') throw new MixedLineEndingsError()

  const normalized = text.replace(/\r\n?/g, '\n')
  const withEol = format.eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : format.eol === 'cr' ? normalized.replace(/\n/g, '\r') : normalized

  const encoded = new TextEncoder().encode(withEol)
  if (!format.bom) return encoded

  const withBom = new Uint8Array(encoded.length + 3)
  withBom.set(UTF8_BOM, 0)
  withBom.set(encoded, 3)
  return withBom
}

/** 基线指纹：判断磁盘上的字节是否还是编辑开始时的那些（FNV-1a 32 位 + 长度） */
/**
 * 混合行尾时的兜底：不拒绝，而是按"多数行尾"统一后写回。
 * 只在用户明确确认后调用（默认路径仍然是拒绝，见 encodeTextPreservingFormat）。
 */
export function encodeTextUnifyingLineEndings(original: Uint8Array, text: string): Uint8Array {
  const eol = majorityLineEnding(original)
  const normalized = text.replace(/\r\n?/g, "\n")
  const withEol = eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : eol === "cr" ? normalized.replace(/\n/g, "\r") : normalized
  const encoded = new TextEncoder().encode(withEol)
  if (!hasUtf8Bom(original)) return encoded
  const withBom = new Uint8Array(encoded.length + 3)
  withBom.set(UTF8_BOM, 0)
  withBom.set(encoded, 3)
  return withBom
}

export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < bytes.length; index++) {
    hash ^= bytes[index]
    hash = Math.imul(hash, 0x01000193)
  }
  return `${bytes.length.toString(36)}-${(hash >>> 0).toString(36)}`
}
