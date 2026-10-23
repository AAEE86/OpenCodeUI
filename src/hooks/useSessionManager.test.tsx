import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionManager } from './useSessionManager'
import { sessionInfoCache } from '../store/sessionInfoCache'

const { getSessionMock, getSessionMessagesPageMock, messageStoreMock, sessionErrorHandlerMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionMessagesPageMock: vi.fn(),
  messageStoreMock: {
    getSessionState: vi.fn(),
    hasRenderableCache: vi.fn(() => false),
    setLoadState: vi.fn(),
    setLoadError: vi.fn(),
    setMessages: vi.fn(),
    updateSessionMetadata: vi.fn(),
    prependMessages: vi.fn(),
    setRevertState: vi.fn(),
  },
  sessionErrorHandlerMock: vi.fn(),
}))

vi.mock('../api', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionMessagesPage: (...args: unknown[]) => getSessionMessagesPageMock(...args),
  revertMessage: vi.fn(),
  unrevertSession: vi.fn(),
  extractUserMessageContent: vi.fn(),
}))

// messagePrefetch 直接依赖 ./message（绕过 api 桶），两处必须指向同一个 mock，
// 否则「复用预取」的断言会看到两个互不相干的函数
vi.mock('../api/message', () => ({
  getSessionMessagesPage: (...args: unknown[]) => getSessionMessagesPageMock(...args),
}))

vi.mock('../store', () => ({
  messageStore: messageStoreMock,
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
}))

describe('useSessionManager', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMessagesPageMock.mockReset()
    messageStoreMock.getSessionState.mockReset()
    messageStoreMock.setLoadState.mockReset()
    messageStoreMock.setLoadError.mockReset()
    messageStoreMock.setMessages.mockReset()
    messageStoreMock.updateSessionMetadata.mockReset()
    messageStoreMock.prependMessages.mockReset()
    messageStoreMock.setRevertState.mockReset()
    sessionErrorHandlerMock.mockReset()
    sessionInfoCache.clear()

    messageStoreMock.getSessionState.mockReturnValue(null)
    getSessionMock.mockResolvedValue({ id: 'session-1', directory: '/workspace/demo' })
    getSessionMessagesPageMock.mockResolvedValue({ messages: [], nextCursor: null })
  })

  it('reports missing route sessions when loading returns not found', async () => {
    const onSessionMissing = vi.fn()
    const notFoundError = Object.assign(new Error('session not found'), { status: 404 })
    getSessionMock.mockRejectedValue(notFoundError)
    getSessionMessagesPageMock.mockRejectedValue(notFoundError)

    renderHook(() =>
      useSessionManager({
        sessionId: 'missing-session',
        directory: '/workspace/demo',
        onSessionMissing,
      }),
    )

    await waitFor(() => {
      expect(onSessionMissing).toHaveBeenCalledWith('missing-session')
    })

    expect(messageStoreMock.setLoadState).toHaveBeenCalledWith('missing-session', 'loading')
    expect(messageStoreMock.setLoadError).toHaveBeenCalledWith(
      'missing-session',
      expect.objectContaining({ type: 'APIError' }),
    )
  })

  it('历史翻页：游标自指（服务端异常）视为到头，hasMoreHistory=false', async () => {
    // 真机复现：v2.0.14 服务端偶发连续返回同一 next 值，「加载更多」死循环
    const state = {
      messages: [{ id: 'msg-2', time: { created: 2 } }],
      historyCursor: 'cursor-A',
    }
    messageStoreMock.getSessionState.mockReturnValue(state)
    getSessionMessagesPageMock.mockResolvedValue({
      messages: [{ id: 'msg-1', time: { created: 1 } }],
      nextCursor: 'cursor-A', // 与入参相同 = 不前进
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    await result.current.loadMoreHistory()

    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith(
      'local::session-1',
      [{ id: 'msg-1', time: { created: 1 } }],
      false,
      null,
    )
  })

  it('历史翻页：游标前进则继续（hasMoreHistory=true + 新游标）', async () => {
    const state = {
      messages: [{ id: 'msg-2', time: { created: 2 } }],
      historyCursor: 'cursor-A',
    }
    messageStoreMock.getSessionState.mockReturnValue(state)
    getSessionMessagesPageMock.mockResolvedValue({
      messages: [{ id: 'msg-1', time: { created: 1 } }],
      nextCursor: 'cursor-B',
    })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    await result.current.loadMoreHistory()

    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith(
      'local::session-1',
      [{ id: 'msg-1', time: { created: 1 } }],
      true,
      'cursor-B',
    )
  })

  it('历史翻页：historyCursor 为 null 不再请求', async () => {
    messageStoreMock.getSessionState.mockReturnValue({ messages: [], historyCursor: null })

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    // 挂载时的初始加载也会调一次首页（不带 cursor）——等它完成后清零再断言
    await waitFor(() => {
      expect(getSessionMessagesPageMock).toHaveBeenCalled()
    })
    getSessionMessagesPageMock.mockClear()

    await result.current.loadMoreHistory()

    expect(getSessionMessagesPageMock).not.toHaveBeenCalled()
  })

  it('列表交接命中：进入会话不再发 session.get', async () => {
    sessionInfoCache.remember('local', {
      id: 'session-1',
      title: '来自列表',
      location: { directory: '/workspace/demo' },
      time: { created: 1, updated: 2 },
    } as never)

    renderHook(() => useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(messageStoreMock.setMessages).toHaveBeenCalled()
    })

    expect(getSessionMock).not.toHaveBeenCalled()
    expect(messageStoreMock.setMessages).toHaveBeenCalledWith(
      'local::session-1',
      [],
      expect.objectContaining({ title: '来自列表', directory: '/workspace/demo' }),
    )
  })

  it('交接缓存命中被 force（重连恢复）显式跳过，仍回读服务端', async () => {
    sessionInfoCache.remember('local', {
      id: 'session-1',
      title: '旧标题',
      location: { directory: '/workspace/demo' },
      time: { created: 1, updated: 2 },
    } as never)

    const { result } = renderHook(() =>
      useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }),
    )

    // 首次进入命中缓存，不发请求
    await waitFor(() => {
      expect(messageStoreMock.setMessages).toHaveBeenCalled()
    })
    getSessionMock.mockClear()

    await result.current.loadSession('local::session-1', { force: true })

    expect(getSessionMock).toHaveBeenCalledWith('local::session-1', '/workspace/demo', 'local')
  })

  it('交接缓存命中时，本地已有的回退边界不能被旧快照抹掉', async () => {
    sessionInfoCache.remember('local', {
      id: 'session-1',
      title: '来自列表',
      location: { directory: '/workspace/demo' },
      time: { created: 1, updated: 2 },
    } as never)
    // 本端刚 undo 过，列表快照还没有 revert 字段
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [],
      loadState: 'idle',
      isStale: false,
      revertState: { messageId: 'msg_revert', history: [] },
    })

    renderHook(() => useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(messageStoreMock.setMessages).toHaveBeenCalled()
    })

    expect(messageStoreMock.setMessages).toHaveBeenCalledWith(
      'local::session-1',
      [],
      expect.objectContaining({ revertState: { messageID: 'msg_revert' } }),
    )
  })

  it('服务端回读的 revert 优先于本地（权威数据覆盖）', async () => {
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      location: { directory: '/workspace/demo' },
      revert: { messageID: 'msg_server' },
    })
    // 缓存未命中，走服务端；本地还留着旧边界
    messageStoreMock.getSessionState.mockReturnValue({
      messages: [],
      loadState: 'idle',
      isStale: false,
      revertState: { messageId: 'msg_local', history: [] },
    })

    renderHook(() => useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(messageStoreMock.setMessages).toHaveBeenCalled()
    })

    expect(messageStoreMock.setMessages).toHaveBeenCalledWith(
      'local::session-1',
      [],
      expect.objectContaining({ revertState: { messageID: 'msg_server' } }),
    )
  })

  it('导航入口已预取消息时复用同一请求，不重复拉首屏', async () => {
    const { prefetchSessionMessages } = await import('../api/messagePrefetch')
    prefetchSessionMessages('local', 'session-1', 50)

    renderHook(() => useSessionManager({ sessionId: 'local::session-1', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(messageStoreMock.setMessages).toHaveBeenCalled()
    })

    // 预取过一次就够：加载路径取走它，而不是再发一次
    expect(getSessionMessagesPageMock).toHaveBeenCalledTimes(1)
  })
})
