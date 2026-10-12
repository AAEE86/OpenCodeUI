import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// useModels 缓存自愈测试
//
// 核心场景：App 启动先于服务器就绪时模块级预取必然失败，此前没有任何
// 重试路径，输入框的模型/agent/思考等级会一直空着只能手动刷新。
// ensureModelsFresh 在 SSE server.connected 时补拉不健康的缓存。
// ============================================

const { getActiveModelsMock, getProvidersMock, getSDKClientAsyncMock, serverChangeHandlers } = vi.hoisted(() => ({
  getActiveModelsMock: vi.fn(),
  getProvidersMock: vi.fn(),
  getSDKClientAsyncMock: vi.fn(() => Promise.resolve({})),
  serverChangeHandlers: [] as Array<(serverId: string, reason?: string) => void>,
}))

vi.mock('../api', () => ({
  getActiveModels: getActiveModelsMock,
  getProviders: getProvidersMock,
}))

vi.mock('../api/sdk', () => ({
  getSDKClientAsync: getSDKClientAsyncMock,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'srv-1',
    onServerChange: (fn: (serverId: string, reason?: string) => void) => {
      serverChangeHandlers.push(fn)
      return () => {}
    },
    subscribe: () => () => {},
  },
}))

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useModels cache self-healing', () => {
  beforeEach(() => {
    vi.resetModules()
    getActiveModelsMock.mockReset()
    getProvidersMock.mockReset()
    getSDKClientAsyncMock.mockClear()
    serverChangeHandlers.length = 0
  })

  it('refetches on ensureModelsFresh after the initial fetch failed', async () => {
    getActiveModelsMock.mockRejectedValueOnce(new Error('server not ready'))
    getProvidersMock.mockResolvedValue([])

    const { ensureModelsFresh } = await import('./useModels')
    await flush()

    // 模块级预取失败
    expect(getActiveModelsMock).toHaveBeenCalledTimes(1)

    // 连接建立（server.connected）→ 补拉
    getActiveModelsMock.mockResolvedValue([{ id: 'm1', providerID: 'p1' }])
    ensureModelsFresh('srv-1')
    await flush()

    expect(getActiveModelsMock).toHaveBeenCalledTimes(2)
  })

  it('does not refetch when the cache is already healthy', async () => {
    getActiveModelsMock.mockResolvedValue([{ id: 'm1', providerID: 'p1' }])
    getProvidersMock.mockResolvedValue([])

    const { ensureModelsFresh } = await import('./useModels')
    await flush()
    expect(getActiveModelsMock).toHaveBeenCalledTimes(1)

    ensureModelsFresh('srv-1')
    await flush()

    // 数据健康：不重复请求
    expect(getActiveModelsMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes on server-switch server change events', async () => {
    getActiveModelsMock.mockResolvedValue([{ id: 'm1', providerID: 'p1' }])
    getProvidersMock.mockResolvedValue([])

    await import('./useModels')
    await flush()
    expect(getActiveModelsMock).toHaveBeenCalledTimes(1)

    for (const handler of serverChangeHandlers) handler('srv-2', 'server-switch')
    await flush()

    expect(getActiveModelsMock).toHaveBeenCalledTimes(2)
  })
})
