import { describe, expect, it } from 'vitest'
import { splitServeArgLine } from './shellArgs'

describe('splitServeArgLine', () => {
  it('splits a full flag on one line', () => {
    expect(splitServeArgLine('--hostname 0.0.0.0')).toEqual(['--hostname', '0.0.0.0'])
  })

  it('keeps legacy one-token-per-line rows intact', () => {
    expect(splitServeArgLine('--hostname')).toEqual(['--hostname'])
    expect(splitServeArgLine('0.0.0.0')).toEqual(['0.0.0.0'])
  })

  it('supports --flag=value as-is', () => {
    expect(splitServeArgLine('--port=5000')).toEqual(['--port=5000'])
  })

  it('respects double and single quotes', () => {
    expect(splitServeArgLine('--cors "https://a b"')).toEqual(['--cors', 'https://a b'])
    expect(splitServeArgLine("--name 'x y'")).toEqual(['--name', 'x y'])
  })

  it('collapses extra whitespace and skips empty lines', () => {
    expect(splitServeArgLine('   --port   5000  ')).toEqual(['--port', '5000'])
    expect(splitServeArgLine('   ')).toEqual([])
    expect(splitServeArgLine('')).toEqual([])
  })

  it('keeps an unterminated quote literal until end of line', () => {
    expect(splitServeArgLine('--name "abc def')).toEqual(['--name', 'abc def'])
  })
})
