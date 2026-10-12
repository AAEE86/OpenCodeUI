import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// useAgents 共享缓存测试
//
// 对齐官方 location 级 sync store 的行为：
//   - 多消费者共享 (server, directory) 缓存，不重复拉取
//   - 失败后可被 ensure*Fresh 兜底补拉（server.connected 钩子）
//   - refreshServerAgents 应对 agent.updated / config.updated 事件
// ============================================

const { getSelectableAgentsMock } = vi.hoisted(() => ({
  getSelectableAgentsMock: vi.fn(),
}))

vi.mock('../api', () => ({
  getSelectableAgents: getSelectableAgentsMock,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'srv-1',
    subscribe: () => () => {},
  },
}))

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const AGENTS = [{ name: 'build', mode: 'primary', hidden: false }]

describe('useAgents shared catalog store', () => {
  beforeEach(() => {
    vi.resetModules()
    getSelectableAgentsMock.mockReset()
    getSelectableAgentsMock.mockResolvedValue(AGENTS)
  })

  it('dedupes concurrent fetches for the same server+directory', async () => {
    const { refreshAgents } = await import('./useAgents')

    await Promise.all([refreshAgents('srv-1', '/proj'), refreshAgents('srv-1', '/proj')])

    // force=true 各自发起（后者 supersede 前者），但目录键一致；
    // 非 force 的重复调用应复用在途请求
    getSelectableAgentsMock.mockClear()
    getSelectableAgentsMock.mockImplementation(() => new Promise(() => {}))
    const { ensureAgentsFresh } = await import('./useAgents')
    void refreshAgents('srv-1', '/proj')
    ensureAgentsFresh('srv-1', '/proj') // isLoading → 跳过
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(1)
  })

  it('ensureAgentsFresh refetches only when unhealthy', async () => {
    getSelectableAgentsMock.mockRejectedValueOnce(new Error('server not ready'))
    const { refreshAgents, ensureAgentsFresh } = await import('./useAgents')

    await refreshAgents('srv-1', '/proj')
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(1)

    // 上次失败 → ensure 补拉
    ensureAgentsFresh('srv-1', '/proj')
    await flush()
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(2)

    // 已健康 → 不再请求
    ensureAgentsFresh('srv-1', '/proj')
    await flush()
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(2)
  })

  it('refreshServerAgents refreshes every cached directory of that server only', async () => {
    const { refreshAgents, refreshServerAgents } = await import('./useAgents')

    await refreshAgents('srv-1', '/a')
    await refreshAgents('srv-1', '/b')
    await refreshAgents('srv-2', '/a')
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(3)

    getSelectableAgentsMock.mockClear()
    refreshServerAgents('srv-1')
    await flush()

    // 只刷 srv-1 的两个目录
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(2)
    const dirs = getSelectableAgentsMock.mock.calls.map(call => call[0])
    expect(dirs.sort()).toEqual(['/a', '/b'])
  })

  it('ensureServerAgentsFresh skips healthy directories', async () => {
    const { refreshAgents, ensureServerAgentsFresh } = await import('./useAgents')

    await refreshAgents('srv-1', '/healthy')
    getSelectableAgentsMock.mockRejectedValueOnce(new Error('boom'))
    await refreshAgents('srv-1', '/broken')
    getSelectableAgentsMock.mockResolvedValue(AGENTS)

    getSelectableAgentsMock.mockClear()
    ensureServerAgentsFresh('srv-1')
    await flush()

    // 只补拉失败的那个目录
    expect(getSelectableAgentsMock).toHaveBeenCalledTimes(1)
    expect(getSelectableAgentsMock.mock.calls[0][0]).toBe('/broken')
  })
})
