import { describe, expect, it } from 'vitest'
import {
  formatCompletedAt,
  formatDateTime,
  formatDetailedDateTime,
  formatDuration,
  formatFileSize,
  formatProcessDuration,
  formatTime,
} from './formatUtils'

describe('formatDuration', () => {
  it('formats milliseconds and seconds', () => {
    expect(formatDuration(999)).toBe('999ms')
    expect(formatDuration(123.456)).toBe('123ms')
    expect(formatDuration(1500)).toBe('1.5s')
  })

  it('formats minute and second durations', () => {
    expect(formatDuration((3 * 60 + 12) * 1000)).toBe('3m 12s')
  })

  it('formats hour durations as hours, minutes, and seconds', () => {
    expect(formatDuration((1 * 60 * 60 + 21 * 60 + 12) * 1000)).toBe('1h 21m 12s')
    expect(formatDuration(60 * 60 * 1000)).toBe('1h')
  })

  it('formats day durations as days, hours, and minutes', () => {
    expect(formatDuration(((24 + 21) * 60 + 10) * 60 * 1000)).toBe('1d 21h 10m')
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1d')
  })
})

describe('formatProcessDuration', () => {
  it('uses ms under one second, whole seconds under one minute', () => {
    expect(formatProcessDuration(0)).toBe('0ms')
    expect(formatProcessDuration(999)).toBe('999ms')
    expect(formatProcessDuration(1500)).toBe('1s')
    expect(formatProcessDuration(59_999)).toBe('59s')
  })

  it('uses minutes, hours, days, and years', () => {
    expect(formatProcessDuration(60_000)).toBe('1m')
    expect(formatProcessDuration((3 * 60 + 12) * 1000)).toBe('3m 12s')
    expect(formatProcessDuration((1 * 60 * 60 + 21 * 60 + 12) * 1000)).toBe('1h 21m 12s')
    expect(formatProcessDuration(((24 + 21) * 60 + 10) * 60 * 1000)).toBe('1d 21h 10m')
    expect(formatProcessDuration(365 * 24 * 60 * 60 * 1000)).toBe('1y')
    expect(formatProcessDuration((365 + 2) * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)).toBe('1y 2d 3h')
  })
})

describe('completed time formatting', () => {
  it('formats local time as HH:MM', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatTime(ms)).toBe('10:30')
  })

  it('formats local date and time as YYYY-MM-DD HH:MM', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatDateTime(ms)).toBe('2026-04-17 10:30')
  })

  it('formats detailed local date and time with seconds', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatDetailedDateTime(ms)).toBe('2026-04-17 10:30:45')
  })

  it('switches output based on completedAt format', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatCompletedAt(ms, 'time')).toBe('10:30')
    expect(formatCompletedAt(ms, 'dateTime')).toBe('2026-04-17 10:30')
  })
})

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(999)).toBe('999 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatFileSize(200 * 1024 * 1024)).toBe('200 MB')
  })

  it('keeps two significant shapes under 10 and rounds above', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB')
  })

  it('returns empty string for invalid input', () => {
    expect(formatFileSize(Number.NaN)).toBe('')
    expect(formatFileSize(-1)).toBe('')
  })
})
