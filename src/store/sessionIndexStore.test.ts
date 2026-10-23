import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import type { Session } from '../types/api/session'

const { listSessionsPageMock, getSessionMock, subscribeMock } = vi.hoisted(() => ({
  listSessionsPageMock: vi.fn(),
  getSessionMock: vi.fn(),
  subscribeMock: vi.fn(),
}))

vi.mock('../api/session', () => ({
  listSessionsPage: (...args: unknown[]) => listSessionsPageMock(...args),
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

vi.mock('../api/events', () => ({
  subscribeToServerEvents: (...args: unknown[]) => subscribeMock(...args),
}))

vi.mock('../utils/directoryUtils', () => ({
  autoDetectPathStyle: vi.fn(),
}))

const { sessionIndexStore } = await import('./sessionIndexStore')

const SERVER = 'local'

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    projectID: 'project-1',
    location: { directory: '/workspace/demo' },
    title: `Session ${id}`,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    ...patch,
  } as Session
}

function page(data: Session[], next: string | null = null) {
  return { data, next }
}

let eventCallbacks: Partial<EventCallbacks> = {}

describe('sessionIndexStore', () => {
  beforeEach(() => {
    sessionIndexStore.reset()
    listSessionsPageMock.mockReset()
    getSessionMock.mockReset()
    subscribeMock.mockReset()
    eventCallbacks = {}
    subscribeMock.mockImplementation((_serverId: string, callbacks: EventCallbacks) => {
      eventCallbacks = callbacks
      return vi.fn()
    })
  })

  afterEach(() => {
    sessionIndexStore.reset()
    vi.useRealTimers()
  })

  it('首屏只拉根会话，按更新时间倒序（子会话与归档不进索引）', async () => {
    listSessionsPageMock.mockResolvedValue(
      page([
        session('ses_old', { time: { created: 1, updated: 10 } }),
        session('ses_new', { time: { created: 1, updated: 99 } }),
        session('ses_child', { parentID: 'ses_new' }),
        session('ses_archived', { time: { created: 1, updated: 50, archived: 60 } }),
      ]),
    )

    await sessionIndexStore.ensure(SERVER)

    expect(listSessionsPageMock).toHaveBeenCalledWith({ parentID: null, order: 'desc', limit: 500 }, SERVER)
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_new', 'ses_old'])
    expect(sessionIndexStore.getSnapshot(SERVER).ready).toBe(true)
  })

  it('30s 内重复 ensure 不重复请求（切目录/重挂载零请求）', async () => {
    listSessionsPageMock.mockResolvedValue(page([session('ses_a')]))

    await sessionIndexStore.ensure(SERVER)
    await sessionIndexStore.ensure(SERVER)

    expect(listSessionsPageMock).toHaveBeenCalledTimes(1)
  })

  it('force 跳过 TTL 重新拉，旧数据在新数据到达前保留', async () => {
    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_a')]))
    await sessionIndexStore.ensure(SERVER)

    const next = page([session('ses_b')])
    listSessionsPageMock.mockResolvedValueOnce(next)
    const refreshing = sessionIndexStore.ensure(SERVER, { force: true })

    // 刷新期间仍是旧快照，不闪空态
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_a'])
    await refreshing

    expect(listSessionsPageMock).toHaveBeenCalledTimes(2)
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_b'])
  })

  it('cursor 续页只追加新的一页，到底后 hasMore=false', async () => {
    // 首轮自动翻两页（page1 → page2），第三页留给「显示更多」
    listSessionsPageMock
      .mockResolvedValueOnce(page([session('ses_1')], 'cursor-2'))
      .mockResolvedValueOnce(page([session('ses_2')], 'cursor-3'))
    await sessionIndexStore.ensure(SERVER)
    expect(listSessionsPageMock).toHaveBeenCalledTimes(2)
    expect(sessionIndexStore.getSnapshot(SERVER).hasMore).toBe(true)

    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_3')]))
    await sessionIndexStore.loadMore(SERVER)

    expect(listSessionsPageMock).toHaveBeenLastCalledWith(
      { parentID: null, order: 'desc', limit: 500, cursor: 'cursor-3' },
      SERVER,
    )
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual([
      'ses_1',
      'ses_2',
      'ses_3',
    ])
    expect(sessionIndexStore.getSnapshot(SERVER).hasMore).toBe(false)
  })

  it('续页去重（游标重复时不会出现重复行）', async () => {
    listSessionsPageMock
      .mockResolvedValueOnce(page([session('ses_1')], 'cursor-2'))
      .mockResolvedValueOnce(page([session('ses_1'), session('ses_2')], 'cursor-3'))
    await sessionIndexStore.ensure(SERVER)

    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_2')], null))
    await sessionIndexStore.loadMore(SERVER)

    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id).sort()).toEqual(['ses_1', 'ses_2'])
  })

  it('首屏失败按退避重试，最终成功不落 error', async () => {
    vi.useFakeTimers()
    listSessionsPageMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([session('ses_a')]))

    const request = sessionIndexStore.ensure(SERVER)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1500)
    await request

    expect(listSessionsPageMock).toHaveBeenCalledTimes(3)
    expect(sessionIndexStore.getSnapshot(SERVER).error).toBeNull()
    expect(sessionIndexStore.getSnapshot(SERVER).sessions).toHaveLength(1)
  })

  it('重试耗尽后 error 落定，ready 仍为 false（消费方显示失败态）', async () => {
    vi.useFakeTimers()
    listSessionsPageMock.mockRejectedValue(new Error('offline'))

    const request = sessionIndexStore.ensure(SERVER)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(3000)
    await request

    expect(listSessionsPageMock).toHaveBeenCalledTimes(4)
    expect(sessionIndexStore.getSnapshot(SERVER).error).toBeInstanceOf(Error)
    expect(sessionIndexStore.getSnapshot(SERVER).ready).toBe(false)
  })

  it('事件增量：改名就地更新、删除移除、根会话创建回读后插入', async () => {
    listSessionsPageMock.mockResolvedValue(page([session('ses_a')]))
    await sessionIndexStore.ensure(SERVER)

    eventCallbacks.onSessionRenamed?.({ sessionID: 'ses_a', title: '新标题' } as never)
    expect(sessionIndexStore.getSnapshot(SERVER).sessions[0].title).toBe('新标题')

    getSessionMock.mockResolvedValue(session('ses_new', { time: { created: 1, updated: 100 } }))
    eventCallbacks.onSessionCreated?.({ sessionID: 'ses_new', location: { directory: '/workspace/demo' } } as never)
    await vi.waitFor(() => {
      expect(sessionIndexStore.getSnapshot(SERVER).sessions[0].id).toBe('ses_new')
    })

    expect(getSessionMock).toHaveBeenCalledWith('ses_new', undefined, SERVER)

    eventCallbacks.onSessionDeleted?.({ sessionID: 'ses_new' } as never)
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_a'])
  })

  it('子会话创建不触发根索引回读', async () => {
    listSessionsPageMock.mockResolvedValue(page([session('ses_a')]))
    await sessionIndexStore.ensure(SERVER)

    eventCallbacks.onSessionCreated?.({ sessionID: 'ses_child', parentID: 'ses_a' } as never)
    await Promise.resolve()

    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('重连标脏并强制重拉，期间旧数据保留', async () => {
    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_a')]))
    await sessionIndexStore.ensure(SERVER)
    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_b')]))

    eventCallbacks.onReconnected?.('network')
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_a'])
    await vi.waitFor(() => {
      expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_b'])
    })

    expect(listSessionsPageMock).toHaveBeenCalledTimes(2)
  })

  it('刷新期间到达的新会话不会被整页替换覆盖', async () => {
    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_a')]))
    await sessionIndexStore.ensure(SERVER)

    let resolveRefresh!: (value: { data: Session[]; next: string | null }) => void
    listSessionsPageMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRefresh = resolve
        }),
    )
    const refreshing = sessionIndexStore.ensure(SERVER, { force: true })

    // 刷新还在飞：新建的会话先排队
    sessionIndexStore.upsert(SERVER, session('ses_new', { time: { created: 1, updated: 999 } }))
    resolveRefresh(page([session('ses_a')]))
    await refreshing

    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id)).toEqual(['ses_new', 'ses_a'])
  })

  it('并发 ensure 共享同一个请求（多个文件夹同时展开只打一次）', async () => {
    let resolvePage!: (value: { data: Session[]; next: string | null }) => void
    listSessionsPageMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePage = resolve
        }),
    )

    const first = sessionIndexStore.ensure(SERVER)
    const second = sessionIndexStore.ensure(SERVER)
    resolvePage(page([session('ses_a')]))
    await Promise.all([first, second])

    expect(listSessionsPageMock).toHaveBeenCalledTimes(1)
    expect(sessionIndexStore.getSnapshot(SERVER).sessions).toHaveLength(1)
  })

  it('同一服务器只建一次事件订阅', async () => {
    listSessionsPageMock.mockResolvedValue(page([]))
    await sessionIndexStore.ensure(SERVER)
    await sessionIndexStore.ensure(SERVER, { force: true })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
  })

  it('目录兜底补拉：把被挤出全局索引的目录并回来，30s 内不重复补', async () => {
    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_recent')]))
    await sessionIndexStore.ensure(SERVER)

    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_old')]))
    await sessionIndexStore.ensureDirectory(SERVER, '/workspace/demo')

    expect(listSessionsPageMock).toHaveBeenLastCalledWith(
      { directory: '/workspace/demo', parentID: null, order: 'desc', limit: 100 },
      SERVER,
    )
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id).sort()).toEqual([
      'ses_old',
      'ses_recent',
    ])

    // TTL 内再挂载一次（切目录来回）不再请求
    await sessionIndexStore.ensureDirectory(SERVER, '/workspace/demo')
    expect(listSessionsPageMock).toHaveBeenCalledTimes(2)
  })

  it('目录补拉与首屏并发时共享请求，目录之间互不影响', async () => {
    let resolveFirst!: (value: { data: Session[]; next: string | null }) => void
    listSessionsPageMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve
        }),
    )
    const first = sessionIndexStore.ensure(SERVER)

    listSessionsPageMock.mockResolvedValueOnce(page([session('ses_old')]))
    const dirA = sessionIndexStore.ensureDirectory(SERVER, '/workspace/a')
    const dirB = sessionIndexStore.ensureDirectory(SERVER, '/workspace/a')
    resolveFirst(page([session('ses_recent')]))
    await Promise.all([first, dirA, dirB])

    // 首屏一页 + 目录一页（同一个目录的并发调用合并）
    expect(listSessionsPageMock).toHaveBeenCalledTimes(2)
    expect(sessionIndexStore.getSnapshot(SERVER).sessions.map(item => item.id).sort()).toEqual([
      'ses_old',
      'ses_recent',
    ])
  })
})
