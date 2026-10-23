import { act, render } from '@testing-library/react'
import { useContext, useEffect, type ContextType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from './SessionContext.shared'
import { SessionProvider } from './SessionContext'
import type { Session } from '../types/api/session'

const { storeMock, createSessionMock, deleteSessionMock, getSessionsMock, clearSessionRuntimeStateMock, unpinMock } =
  vi.hoisted(() => {
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
      ensure: vi.fn(() => Promise.resolve()),
      ensureDirectory: vi.fn(() => Promise.resolve()),
      loadMore: vi.fn(() => Promise.resolve()),
      remove: vi.fn(),
      patch: vi.fn(),
      upsert: vi.fn(),
      reset: vi.fn(),
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
      getSessionsMock: vi.fn(),
      clearSessionRuntimeStateMock: vi.fn(),
      unpinMock: vi.fn(),
    }
  })

vi.mock('../api', () => ({
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
}))

vi.mock('../store/sessionIndexStore', () => ({
  sessionIndexStore: storeMock,
}))

vi.mock('./useDirectory', () => ({
  useDirectory: () => ({ currentDirectory: '/workspace/demo' }),
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
  normalizeToForwardSlash: (value?: string) => value?.replace(/\\/g, '/'),
  isSameDirectory: (left?: string, right?: string) => {
    const normalize = (value?: string) => value?.replace(/[\\/]+$/, '')
    return normalize(left) === normalize(right)
  },
}))

vi.mock('../utils/sessionLifecycle', () => ({
  clearSessionRuntimeState: (...args: unknown[]) => clearSessionRuntimeStateMock(...args),
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

let latestContext: ContextType<typeof SessionContext> = null

function SessionContextProbe() {
  const context = useContext(SessionContext)

  useEffect(() => {
    latestContext = context
  }, [context])

  return null
}

function renderProvider() {
  return render(
    <SessionProvider>
      <SessionContextProbe />
    </SessionProvider>,
  )
}

describe('SessionProvider', () => {
  beforeEach(() => {
    latestContext = null
    storeMock.ensure.mockClear()
    storeMock.ensureDirectory.mockClear()
    storeMock.loadMore.mockReset()
    storeMock.loadMore.mockImplementation(() => Promise.resolve())
    storeMock.remove.mockClear()
    storeMock.patch.mockClear()
    storeMock.upsert.mockClear()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    getSessionsMock.mockReset()
    getSessionsMock.mockResolvedValue([])
    clearSessionRuntimeStateMock.mockReset()
    unpinMock.mockReset()
    storeMock.resetSnapshotForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('从共享索引按当前目录过滤（不再自己发请求）', async () => {
    storeMock.setSnapshotForTest({
      ready: true,
      sessions: [
        makeSession('ses_a', '/workspace/demo'),
        makeSession('ses_b', '/workspace/other'),
        makeSession('ses_c', '/workspace/demo/'),
      ],
    })

    renderProvider()

    expect(storeMock.ensure).toHaveBeenCalledWith('local')
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['ses_a', 'ses_c'])
    expect(latestContext?.isLoading).toBe(false)
  })

  it('首帧还没拉到数据时显示 loading，失败后不再转圈', () => {
    renderProvider()
    expect(latestContext?.isLoading).toBe(true)

    act(() => {
      storeMock.setSnapshotForTest({ ready: false, error: new Error('down') })
    })
    expect(latestContext?.isLoading).toBe(false)
  })

  it('搜索在本地过滤标题 / id，索引完整时不发请求', () => {
    storeMock.setSnapshotForTest({
      ready: true,
      sessions: [makeSession('ses_a', '/workspace/demo'), makeSession('ses_b', '/workspace/demo')],
    })

    renderProvider()
    const ensureCalls = storeMock.ensure.mock.calls.length

    act(() => {
      latestContext?.setSearch('ses_b')
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['ses_b'])
    expect(storeMock.ensure).toHaveBeenCalledTimes(ensureCalls)
    expect(getSessionsMock).not.toHaveBeenCalled()
  })

  it('索引没覆盖全部会话时，本地搜不到的再向服务端补一次', async () => {
    vi.useFakeTimers()
    storeMock.setSnapshotForTest({ ready: true, hasMore: true, sessions: [makeSession('ses_a')] })
    getSessionsMock.mockResolvedValue([makeSession('ses_old', '/workspace/demo', 99)])

    renderProvider()
    act(() => {
      latestContext?.setSearch('old')
    })
    expect(latestContext?.sessions).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(getSessionsMock).toHaveBeenCalledWith(
      { parentID: null, search: 'old', limit: 50, directory: '/workspace/demo' },
      'local',
    )
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['ses_old'])
  })

  it('服务端补回的结果按当前目录收口', async () => {
    vi.useFakeTimers()
    storeMock.setSnapshotForTest({ ready: true, hasMore: true, sessions: [makeSession('ses_a')] })
    getSessionsMock.mockResolvedValue([
      makeSession('ses_old', '/workspace/demo', 99),
      makeSession('ses_elsewhere', '/workspace/other', 100),
    ])

    renderProvider()
    act(() => {
      latestContext?.setSearch('old')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(latestContext?.sessions.map(session => session.id)).toEqual(['ses_old'])
  })

  it('本地已拉到的会话先切片露出，见底后才向服务端续页', async () => {
    const many = Array.from({ length: 40 }, (_, index) => makeSession(`ses_${index}`, '/workspace/demo'))
    storeMock.setSnapshotForTest({ ready: true, sessions: many, hasMore: false })

    renderProvider()
    expect(latestContext?.sessions).toHaveLength(30)
    expect(latestContext?.hasMore).toBe(true)

    await act(async () => {
      await latestContext!.loadMore()
    })

    expect(storeMock.loadMore).not.toHaveBeenCalled()
    expect(latestContext?.sessions).toHaveLength(40)
    expect(latestContext?.hasMore).toBe(false)

    act(() => {
      storeMock.setSnapshotForTest({ ready: true, sessions: many, hasMore: true })
    })
    await act(async () => {
      await latestContext!.loadMore()
    })

    expect(storeMock.loadMore).toHaveBeenCalledWith('local')
  })

  it('「显示更多」连翻到当前目录出现新行就停', async () => {
    storeMock.setSnapshotForTest({
      ready: true,
      hasMore: true,
      sessions: [makeSession('ses_other', '/workspace/other')],
    })
    renderProvider()

    let pages = 0
    storeMock.loadMore.mockImplementation(async () => {
      pages += 1
      if (pages < 2) return
      storeMock.setSnapshotForTest({
        ready: true,
        hasMore: true,
        sessions: [makeSession('ses_other', '/workspace/other'), makeSession('ses_b', '/workspace/demo')],
      })
    })

    await act(async () => {
      await latestContext!.loadMore()
    })

    expect(storeMock.loadMore).toHaveBeenCalledTimes(2)
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['ses_b'])
  })

  it('切换目录不重新拉索引', () => {
    storeMock.setSnapshotForTest({ ready: true, sessions: [makeSession('ses_a', '/workspace/demo')] })
    renderProvider()

    act(() => {
      storeMock.setSnapshotForTest({
        ready: true,
        sessions: [makeSession('ses_a', '/workspace/demo'), makeSession('ses_b', '/workspace/other')],
      })
    })

    expect(storeMock.ensure).toHaveBeenCalledTimes(1)
    expect(latestContext?.sessions.map(session => session.id)).toEqual(['ses_a'])
  })

  it('当前目录在索引里为空且服务端还有页时，按目录兜底补拉', () => {
    storeMock.setSnapshotForTest({
      ready: true,
      hasMore: true,
      sessions: [makeSession('ses_other', '/workspace/other')],
    })

    renderProvider()

    expect(storeMock.ensureDirectory).toHaveBeenCalledWith('local', '/workspace/demo')
  })

  it('索引已到底或目录本身有数据时不补拉', () => {
    storeMock.setSnapshotForTest({
      ready: true,
      hasMore: false,
      sessions: [makeSession('ses_other', '/workspace/other')],
    })
    renderProvider()
    expect(storeMock.ensureDirectory).not.toHaveBeenCalled()

    act(() => {
      storeMock.setSnapshotForTest({
        ready: true,
        hasMore: true,
        sessions: [makeSession('ses_a', '/workspace/demo')],
      })
    })
    expect(storeMock.ensureDirectory).not.toHaveBeenCalled()
  })

  it('删除会话：调 API、清运行时状态、清索引', async () => {
    storeMock.setSnapshotForTest({ ready: true, sessions: [makeSession('ses_a', '/workspace/demo')] })
    deleteSessionMock.mockResolvedValue(true)

    renderProvider()

    await act(async () => {
      await latestContext!.deleteSession('ses_a')
    })

    expect(deleteSessionMock).toHaveBeenCalledWith('ses_a', '/workspace/demo')
    expect(unpinMock).toHaveBeenCalledWith('ses_a')
    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('ses_a')
    expect(storeMock.remove).toHaveBeenCalledWith('local', 'ses_a')
  })
})
