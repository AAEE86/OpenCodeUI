// 面板的重连自愈：断线窗口错过的 SSE 事件协议不补发，
// 面板必须实现 onReconnected 主动重拉，否则列表停在断线前，只能刷新整页。
//
// WorktreePanel / PluginsPanel / McpPanel / SkillPanel 原先都没有这条补偿 ——
// 本测试固化修复，防止回归。
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'

const {
  subscribeToEventsMock,
  getPluginsMock,
  getCurrentProjectMock,
  listWorktreesMock,
  refreshVcsMock,
  getVcsInfoMock,
  getMcpStatusMock,
  getMcpResourcesMock,
  getSkillsMock,
} = vi.hoisted(() => ({
  subscribeToEventsMock: vi.fn(),
  getPluginsMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  listWorktreesMock: vi.fn(),
  refreshVcsMock: vi.fn(),
  getVcsInfoMock: vi.fn(),
  getMcpStatusMock: vi.fn(),
  getMcpResourcesMock: vi.fn(),
  getSkillsMock: vi.fn(),
}))

vi.mock('../api/events', () => ({
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('../api/plugin', () => ({
  getPlugins: (...args: unknown[]) => getPluginsMock(...args),
  pluginLabel: (p: { name?: string }) => p?.name ?? 'plugin',
  updatePlugins: vi.fn(),
}))

vi.mock('../api/client', () => ({
  getCurrentProject: (...args: unknown[]) => getCurrentProjectMock(...args),
}))

vi.mock('../api/worktree', () => ({
  listWorktrees: (...args: unknown[]) => listWorktreesMock(...args),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  refreshWorktrees: vi.fn(),
}))

vi.mock('../api/pty', () => ({
  listPtySessions: vi.fn().mockResolvedValue([]),
  removePtySession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../api/vcs', () => ({
  getBranchList: vi.fn().mockResolvedValue([]),
  getVcsInfo: (...args: unknown[]) => getVcsInfoMock(...args),
}))

vi.mock('../api/mcp', () => ({
  getMcpStatus: (...args: unknown[]) => getMcpStatusMock(...args),
  getMcpResources: (...args: unknown[]) => getMcpResourcesMock(...args),
  connectMcpServer: vi.fn(),
  disconnectMcpServer: vi.fn(),
}))

vi.mock('../api/skill', () => ({
  getSkills: (...args: unknown[]) => getSkillsMock(...args),
}))

vi.mock('../hooks', () => ({
  useDirectory: () => ({
    currentDirectory: '/workspace/demo',
    addDirectory: vi.fn(),
    setCurrentDirectory: vi.fn(),
  }),
  useVcsInfo: () => ({ vcsInfo: null, isLoading: false, error: null, refresh: refreshVcsMock }),
}))

vi.mock('../hooks/useRouter', () => ({
  navigateByHash: vi.fn(),
}))

let latestCallbacks: Partial<EventCallbacks> = {}

beforeEach(() => {
  vi.clearAllMocks()
  latestCallbacks = {}
  subscribeToEventsMock.mockImplementation((cb: Partial<EventCallbacks>) => {
    latestCallbacks = cb
    return vi.fn()
  })
  getPluginsMock.mockResolvedValue([])
  getCurrentProjectMock.mockResolvedValue({ id: 'proj-1', vcs: 'git', canonical: '/workspace/demo' })
  listWorktreesMock.mockResolvedValue([])
  getVcsInfoMock.mockResolvedValue(null)
  getMcpStatusMock.mockResolvedValue([])
  getMcpResourcesMock.mockResolvedValue({})
  getSkillsMock.mockResolvedValue([])
})

describe('WorktreePanel reconnect self-heal', () => {
  it('reloads worktrees and vcs on reconnect', async () => {
    const { WorktreePanel } = await import('./WorktreePanel')
    render(<WorktreePanel />)

    // 初始加载
    await waitFor(() => {
      expect(getCurrentProjectMock).toHaveBeenCalled()
    })

    const callsBefore = getCurrentProjectMock.mock.calls.length
    const vcsBefore = refreshVcsMock.mock.calls.length

    // 订阅回调里必须有 onReconnected
    expect(typeof latestCallbacks.onReconnected).toBe('function')

    await act(async () => {
      latestCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    // 重连后 worktrees 与 vcs 都要重拉
    await waitFor(() => {
      expect(getCurrentProjectMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
    expect(refreshVcsMock.mock.calls.length).toBeGreaterThan(vcsBefore)
  })
})

describe('PluginsPanel reconnect self-heal', () => {
  it('reloads the plugin list on reconnect', async () => {
    const { PluginsPanel } = await import('./PluginsPanel')
    render(<PluginsPanel />)

    await waitFor(() => {
      expect(getPluginsMock).toHaveBeenCalled()
    })

    const callsBefore = getPluginsMock.mock.calls.length

    expect(typeof latestCallbacks.onReconnected).toBe('function')

    await act(async () => {
      latestCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(getPluginsMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})

describe('McpPanel reconnect self-heal', () => {
  it('reloads MCP status on reconnect', async () => {
    const { McpPanel } = await import('./McpPanel')
    render(<McpPanel />)

    await waitFor(() => {
      expect(getMcpStatusMock).toHaveBeenCalled()
    })

    const callsBefore = getMcpStatusMock.mock.calls.length

    expect(typeof latestCallbacks.onReconnected).toBe('function')

    await act(async () => {
      latestCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(getMcpStatusMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})

describe('SkillPanel reconnect self-heal', () => {
  it('reloads the skill list on reconnect', async () => {
    const { SkillPanel } = await import('./SkillPanel')
    render(<SkillPanel />)

    await waitFor(() => {
      expect(getSkillsMock).toHaveBeenCalled()
    })

    const callsBefore = getSkillsMock.mock.calls.length

    expect(typeof latestCallbacks.onReconnected).toBe('function')

    await act(async () => {
      latestCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(getSkillsMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})
