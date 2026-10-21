import { describe, expect, it } from 'vitest'
import { buildQueryString, toAbsoluteBaseUrl } from './http'

// ============================================
// toAbsoluteBaseUrl 测试
// ============================================

describe('toAbsoluteBaseUrl', () => {
  it('resolves a same-origin prefix against the page origin', () => {
    expect(toAbsoluteBaseUrl('/api')).toBe(`${window.location.origin}/api`)
  })

  it('strips trailing slashes from a resolved relative URL', () => {
    expect(toAbsoluteBaseUrl('/api/')).toBe(`${window.location.origin}/api`)
  })

  it('resolves a protocol-relative URL against the page protocol', () => {
    expect(toAbsoluteBaseUrl('//example.com/api')).toBe(`${window.location.protocol}//example.com/api`)
  })

  it('leaves absolute URLs unchanged', () => {
    expect(toAbsoluteBaseUrl('http://127.0.0.1:4096')).toBe('http://127.0.0.1:4096')
    expect(toAbsoluteBaseUrl('https://opencode.example.com:51133/api')).toBe(
      'https://opencode.example.com:51133/api',
    )
  })

  it('returns an empty value unchanged', () => {
    expect(toAbsoluteBaseUrl('')).toBe('')
  })
})

// ============================================
// buildQueryString 测试
// ============================================

describe('buildQueryString', () => {
  it('returns empty string for empty params', () => {
    expect(buildQueryString({})).toBe('')
  })

  it('skips undefined values', () => {
    expect(buildQueryString({ a: 'hello', b: undefined })).toBe('?a=hello')
  })

  it('handles string, number, boolean values', () => {
    const result = buildQueryString({ name: 'test', page: 1, active: true })
    expect(result).toBe('?name=test&page=1&active=true')
  })

  it('encodes special characters in values', () => {
    const result = buildQueryString({ directory: 'C:\\Program Files\\app' })
    expect(result).toBe('?directory=C%3A%5CProgram%20Files%5Capp')
  })

  it('encodes special characters in keys', () => {
    const result = buildQueryString({ 'key with spaces': 'value' })
    expect(result).toBe('?key%20with%20spaces=value')
  })

  it('encodes ampersand and equals in values', () => {
    const result = buildQueryString({ q: 'a=1&b=2' })
    expect(result).toBe('?q=a%3D1%26b%3D2')
  })

  it('encodes unicode characters', () => {
    const result = buildQueryString({ path: '/home/用户/project' })
    expect(result).toBe('?path=%2Fhome%2F%E7%94%A8%E6%88%B7%2Fproject')
  })
})
