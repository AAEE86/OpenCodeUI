import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoRefresh } from './useAutoRefresh'

// ============================================
// useAutoRefresh（需求三 B4 的接线处）
//
// 回归点：options.onFilesystemChanged 曾经只出现在类型里、实现里没人调用 ——
// 于是"预览文件被外部改动"整条链是死的。这里把它钉住：
// 目录内的文件变更既要回调消费方，也要照常触发刷新。
// ============================================

const registerSessionConsumer = vi.hoisted(() => vi.fn())

vi.mock('./useGlobalEvents', () => ({ registerSessionConsumer }))

type Handlers = {
  onFilesystemChanged?: (data: { file: string; event: string }) => void
  onSessionIdle?: () => void
}

describe('useAutoRefresh', () => {
  let handlers: Handlers = {}

  beforeEach(() => {
    vi.useFakeTimers()
    handlers = {}
    registerSessionConsumer.mockImplementation((_consumerId, _sessionId, next: Handlers) => {
      handlers = next
      return () => undefined
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('目录内文件变更：回调消费方 + 触发刷新（两条都要走）', () => {
    const refresh = vi.fn()
    const onFilesystemChanged = vi.fn()

    renderHook(() =>
      useAutoRefresh('preview', null, refresh, true, {
        watchDirectory: '/repo',
        onFilesystemChanged,
      }),
    )

    handlers.onFilesystemChanged?.({ file: '/repo/src/app.ts', event: 'change' })
    expect(onFilesystemChanged).toHaveBeenCalledWith({ file: '/repo/src/app.ts', event: 'change' })

    // 刷新是 debounce 过的
    vi.advanceTimersByTime(600)
    expect(refresh).toHaveBeenCalled()
  })

  it('目录外的文件变更：既不回调也不刷新', () => {
    const refresh = vi.fn()
    const onFilesystemChanged = vi.fn()

    renderHook(() =>
      useAutoRefresh('preview', null, refresh, true, {
        watchDirectory: '/repo',
        onFilesystemChanged,
      }),
    )

    handlers.onFilesystemChanged?.({ file: '/elsewhere/app.ts', event: 'change' })
    vi.advanceTimersByTime(600)

    expect(onFilesystemChanged).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('.git 内部变更：忽略', () => {
    const refresh = vi.fn()
    const onFilesystemChanged = vi.fn()

    renderHook(() => useAutoRefresh('preview', null, refresh, true, { watchDirectory: '/repo', onFilesystemChanged }))

    handlers.onFilesystemChanged?.({ file: '/repo/.git/index', event: 'change' })
    vi.advanceTimersByTime(600)

    expect(onFilesystemChanged).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
