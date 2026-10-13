import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeServeArgsRows, serviceStore } from './serviceStore'

describe('normalizeServeArgsRows', () => {
  it('merges legacy one-token-per-line rows into a single line', () => {
    expect(normalizeServeArgsRows(['--hostname', '0.0.0.0'])).toEqual(['--hostname 0.0.0.0'])
    expect(normalizeServeArgsRows(['--cors', 'https://example.com', '--hostname', '0.0.0.0'])).toEqual([
      '--cors https://example.com --hostname 0.0.0.0',
    ])
  })

  it('leaves new-format rows (with spaces or quotes) untouched', () => {
    expect(normalizeServeArgsRows(['--hostname 0.0.0.0', '--cors "https://a b"'])).toEqual([
      '--hostname 0.0.0.0',
      '--cors "https://a b"',
    ])
  })

  it('keeps single-token rows as-is (identical in both formats)', () => {
    expect(normalizeServeArgsRows(['--print-logs'])).toEqual(['--print-logs'])
    expect(normalizeServeArgsRows([])).toEqual([])
  })

  it('drops empty rows when merging', () => {
    expect(normalizeServeArgsRows(['--hostname', ' ', '0.0.0.0'])).toEqual(['--hostname 0.0.0.0'])
  })
})

describe('serviceStore.serveArgsList', () => {
  beforeEach(() => {
    serviceStore.setServeArgs([])
  })

  it('splits each line into tokens', () => {
    serviceStore.setServeArgs(['--hostname 0.0.0.0', '--cors "https://a b"', '  '])
    expect(serviceStore.serveArgsList).toEqual(['--hostname', '0.0.0.0', '--cors', 'https://a b'])
  })
})
