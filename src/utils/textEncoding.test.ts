import { describe, expect, it } from 'vitest'
import {
  MixedLineEndingsError,
  detectLineEnding,
  detectTextFormat,
  encodeTextPreservingFormat,
  hashBytes,
  hasUtf8Bom,
} from './textEncoding'

// ============================================
// 文本格式保真（需求三：保存不能把文件写坏）
//
// 逐字节保真是"严谨"的第一条：行尾 / BOM 变了就是整文件 diff。
// ============================================

const enc = (text: string) => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes)

describe('detectLineEnding / hasUtf8Bom', () => {
  it('识别 LF / CRLF / CR / 混合', () => {
    expect(detectLineEnding(enc('a\nb\n'))).toBe('lf')
    expect(detectLineEnding(enc('a\r\nb\r\n'))).toBe('crlf')
    expect(detectLineEnding(enc('a\rb\r'))).toBe('cr')
    expect(detectLineEnding(enc('a\r\nb\n'))).toBe('mixed')
  })

  it('识别 UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('hi')])
    expect(hasUtf8Bom(withBom)).toBe(true)
    expect(detectTextFormat(withBom)).toEqual({ eol: 'lf', bom: true })
    expect(hasUtf8Bom(enc('hi'))).toBe(false)
  })
})

describe('encodeTextPreservingFormat', () => {
  it('CRLF 原文保存后仍是 CRLF（不会退化成 LF）', () => {
    const original = enc('a\r\nb\r\n')
    const bytes = encodeTextPreservingFormat(original, 'a\nb\nc\n')
    expect(dec(bytes)).toBe('a\r\nb\r\nc\r\n')
  })

  it('LF 原文保持 LF', () => {
    const bytes = encodeTextPreservingFormat(enc('a\nb\n'), 'a\nb\nc\n')
    expect(dec(bytes)).toBe('a\nb\nc\n')
  })

  it('BOM 原文保存后把 BOM 补回来', () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('a\n')])
    const bytes = encodeTextPreservingFormat(original, 'a\nb\n')
    expect(hasUtf8Bom(bytes)).toBe(true)
    expect(dec(bytes)).toBe('a\nb\n')
  })

  it('编辑器里混进 CRLF 时先归一，不会写出 \\r\\r\\n', () => {
    const bytes = encodeTextPreservingFormat(enc('a\r\nb\r\n'), 'x\r\ny\nz')
    expect(dec(bytes)).toBe('x\r\ny\r\nz')
    expect(dec(bytes)).not.toContain('\r\r')
  })

  it('混合行尾原文拒绝保存（会整文件 diff）', () => {
    expect(() => encodeTextPreservingFormat(enc('a\r\nb\n'), 'a\nb\n')).toThrow(MixedLineEndingsError)
  })
})

describe('hashBytes', () => {
  it('同内容同指纹、不同内容不同指纹、长度也算进去', () => {
    expect(hashBytes(enc('abc'))).toBe(hashBytes(enc('abc')))
    expect(hashBytes(enc('abc'))).not.toBe(hashBytes(enc('abd')))
    expect(hashBytes(enc('abc'))).not.toBe(hashBytes(enc('abc\n')))
  })
})
