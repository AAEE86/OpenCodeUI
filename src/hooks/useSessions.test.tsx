import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessions } from './useSessions'
import type { Session } from '../types/api/session'

const { storeMock, createSessionMock, deleteSessionMock, unpinMock } = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let snapshot: {
    sessions: Session[]
    hasMore: boolean
    ready: boolean
    loading: boolean
    error: Error | null
  } = { sessions: [], hasMore: false, ready: false, loading: false, error: null }

  const storeMock = {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    ensure: vi.fn<(serverId: string, options?: { force?: boolean }) => Promise<void>>(() => Promise.resolve()),
    loadMore: vi.fn(() => Promise.resolve()),
    remove: vi.fn(),
    patch: vi.fn(),
    upsert: vi.fn(),
    setSnapshotForTest: (next: Partial<typeof snapshot>) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of listeners) listener()
    },
    resetSnapshotForTest: () => {
      snapshot = { sessions: [], hasMore: false, ready: false, loading: false, error: null }
      for (const listener of listeners) listener()
    },
  }

  return {
    storeMock,
    createSessionMock: vi.fn(),
    deleteSessionMock: vi.fn(),
    unpinMock: vi.fn(),
  }
})

vi.mock('../api', () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
}))

vi.mock('../store/sessionIndexStore', () => ({
  sessionIndexStore: storeMock,
}))

vi.mock('../store/pinnedSessionsStore', () => ({
  pinnedSessionsStore: {
    unpin: (...args: unknown[]) => unpinMock(...args),
  },
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    subscribe: () => () => {},
    getActiveServerId: () => 'local',
  },
}))

vi.mock('../utils', () => ({
  isSameDirectory: (left?: string, right?: string) => {
    const normalize = (value?: string) => value?.replace(/[\\/]+$/, '')
    return normalize(left) === normalize(right)
  },
}))

function makeSession(id: string, directory = '/workspace/demo', updated = 2): Session {
  return {
    id,
    projectID: 'project-1',
    location: { directory },
    title: `Session ${id}`,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated },
  } as Session
}

describe('useSessions', () => {
  beforeEach(() => {
    storeMock.ensure.mockClear()
    storeMock.loadMore.mockClear()
    storeMock.remove.mockClear()
    storeMock.patch.mockClear()
    storeMock.upsert.mockClear()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    unpinMock.mockReset()
    storeMock.resetSnapshotForTest()
  })

  it('enabled 为 false 时不拉索引', () => {
    const { rerender } = renderHook(({ enabled }) => useSessions({ directory: '/workspace/demo', enabled }), {
      initialProps: { enabled: false },
    })

    expect(storeMock.ensure).not.toHaveBeenCalled()

    rerender({ enabled: true })
    expect(storeMock.ensure).toHaveBeenCalledWith('local')
  })

  it('按目录从共享索引过滤，php 风格尾斜杠不影响匹配', () => {
    storeMock.setSnapshotForTest({
      ready: true,
      sessions: [
        makeSession('ses_a', '/workspace/demo'),
        makeSession('ses_b', '/workspace/demo/'),
        makeSession('ses_c', '/workspace/other'),
      ],
    })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', pageSize: 5 }))

    expect(result.current.sessions.map(session => session.id)).toEqual(['ses_a', 'ses_b'])
    expect(result.current.isLoading).toBe(false)
  })

  it('同一台服务器的多个目录共享一次索引请求（每个 hook 只调用 ensure，不再各自发请求）', () => {
    const first = renderHook(() => useSessions({ directory: '/workspace/a' }))
    const second = renderHook(() => useSessions({ directory: '/workspace/b' }))

    expect(first.result.current.isLoading).toBe(true)
    expect(second.result.current.isLoading).toBe(true)
    expect(storeMock.ensure).toHaveBeenCalledTimes(2)
    // 请求去重在 store 里：两次 ensure 指向同一个 serverId 的同一个入口
    expect(storeMock.ensure.mock.calls.every(call => call[0] === 'local')).toBe(true)
  })

  it('pageSize 本地切片，loadMore 先露出本地数据', async () => {
    storeMock.setSnapshotForTest({
      ready: true,
      sessions: Array.from({ length: 8 }, (_, index) => makeSession(`ses_${index}`)),
    })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', pageSize: 5 }))
    expect(result.current.sessions).toHaveLength(5)
    expect(result.current.hasMore).toBe(true)

    await act(async () => {
      await result.current.loadMore()
    })

    expect(result.current.sessions).toHaveLength(8)
    expect(storeMock.loadMore).not.toHaveBeenCalled()
    expect(result.current.hasMore).toBe(false)
  })

  it('本地见底且服务端还有下一页时才续页', async () => {
    storeMock.setSnapshotForTest({ ready: true, sessions: [makeSession('ses_0')], hasMore: true })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', pageSize: 5 }))

    await act(async () => {
      await result.current.loadMore()
    })

    expect(storeMock.loadMore).toHaveBeenCalledWith('local')
  })

  it('删除会话传对目录，并同步清掉索引条目', async () => {
    deleteSessionMock.mockResolvedValue(true)
    storeMock.setSnapshotForTest({ ready: true, sessions: [makeSession('ses_a')] })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', serverId: 'remote' }))

    await act(async () => {
      await result.current.remove('ses_a')
    })

    expect(deleteSessionMock).toHaveBeenCalledWith('ses_a', '/workspace/demo', 'remote')
    expect(unpinMock).toHaveBeenCalledWith('ses_a')
    expect(storeMock.remove).toHaveBeenCalledWith('remote', 'ses_a')
  })

  it('搜索在本地过滤标题，不产生额外请求', () => {
    storeMock.setSnapshotForTest({
      ready: true,
      sessions: [makeSession('ses_a'), makeSession('ses_b')],
    })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))
    const ensureCalls = storeMock.ensure.mock.calls.length

    act(() => {
      result.current.setSearch('ses_b')
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['ses_b'])
    expect(storeMock.ensure).toHaveBeenCalledTimes(ensureCalls)
  })

  it('新建会话直接写进索引（不等 SSE）', async () => {
    const created = makeSession('ses_new', '/workspace/git', 100)
    createSessionMock.mockResolvedValue(created)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/git' }))

    await act(async () => {
      await result.current.create('hello')
    })

    expect(createSessionMock).toHaveBeenCalledWith({ title: 'hello', directory: '/workspace/git' }, undefined)
    expect(storeMock.upsert).toHaveBeenCalledWith('local', created)
  })

  it('索引错误原样透出，refresh 走 force', async () => {
    const error = new Error('down')
    storeMock.setSnapshotForTest({ ready: false, error })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))
    expect(result.current.error).toBe(error)
    expect(result.current.isLoading).toBe(false)

    await act(async () => {
      await result.current.refresh()
    })

    expect(storeMock.ensure).toHaveBeenLastCalledWith('local', { force: true })
  })

  it('patchLocalSession 写到共享索引', () => {
    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    act(() => {
      result.current.patchLocalSession('ses_a', { title: 'new' })
    })

    expect(storeMock.patch).toHaveBeenCalledWith('local', 'ses_a', { title: 'new' })
  })
})
