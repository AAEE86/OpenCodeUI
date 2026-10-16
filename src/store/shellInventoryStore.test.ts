import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellInfo } from '@opencode/client/promise'

const listShellsMock = vi.fn<() => Promise<ShellInfo[]>>()
vi.mock('../api/shell', () => ({
  listShells: () => listShellsMock(),
  removeShell: vi.fn(),
}))

import { runningShellsForSession, shellInventoryStore } from './shellInventoryStore'
import { serverStore } from './serverStore'

const ACTIVE = serverStore.getActiveServerId()

function makeShell(id: string, sessionID: string, status: ShellInfo['status'] = 'running'): ShellInfo {
  return {
    id,
    status,
    command: `cmd-${id}`,
    cwd: '/repo',
    shell: 'bash',
    file: '',
    metadata: { sessionID },
    time: { started: 1 },
  } as ShellInfo
}

describe('runningShellsForSession（挂载过滤）', () => {
  it('只留 running 且 metadata.sessionID 匹配的 shell', () => {
    const shells = [
      makeShell('a', 's1'),
      makeShell('b', 's1', 'exited'),
      makeShell('c', 's2'),
      { ...makeShell('d', 's1'), metadata: {} } as ShellInfo,
    ]
    expect(runningShellsForSession(shells, 's1').map(s => s.id)).toEqual(['a'])
    expect(runningShellsForSession(shells, 's2').map(s => s.id)).toEqual(['c'])
    expect(runningShellsForSession(shells, 's3')).toEqual([])
  })
})

describe('shellInventoryStore（事件驱动 + 兜底轮询）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listShellsMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('第一个订阅者出现时拉初始清单，退订干净后停止轮询', async () => {
    listShellsMock.mockResolvedValue([makeShell('a', 's1')])
    const spy = vi.fn()
    const unsubscribe = shellInventoryStore.subscribe(spy)

    await vi.advanceTimersByTimeAsync(0)
    expect(listShellsMock).toHaveBeenCalledTimes(1)
    expect(shellInventoryStore.getShells(ACTIVE).map(s => s.id)).toEqual(['a'])
    // 有数据（从无到有的变化）→ version bump 通知订阅者
    expect(spy).toHaveBeenCalled()

    unsubscribe()
    const callsBefore = listShellsMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    // 没有订阅者 → 兜底轮询不再打
    expect(listShellsMock.mock.calls.length).toBe(callsBefore)
  })

  it('requestRefresh 防抖合并连续事件；清单没变化不 bump version', async () => {
    listShellsMock.mockResolvedValue([makeShell('a', 's1')])
    const spy = vi.fn()
    const unsubscribe = shellInventoryStore.subscribe(spy)
    await vi.advanceTimersByTimeAsync(0)
    expect(listShellsMock).toHaveBeenCalledTimes(1)
    const versionAfterInit = shellInventoryStore.getVersion()
    spy.mockClear()

    // 连续 3 次事件 → 一次重取
    shellInventoryStore.requestRefresh()
    shellInventoryStore.requestRefresh()
    shellInventoryStore.requestRefresh()
    await vi.advanceTimersByTimeAsync(600)
    expect(listShellsMock).toHaveBeenCalledTimes(2)
    // 清单内容没变 → version 不涨、不通知
    expect(shellInventoryStore.getVersion()).toBe(versionAfterInit)
    expect(spy).not.toHaveBeenCalled()

    // 清单变了（新 shell 出现）→ version 涨 + 通知
    listShellsMock.mockResolvedValue([makeShell('a', 's1'), makeShell('b', 's1')])
    shellInventoryStore.requestRefresh()
    await vi.advanceTimersByTimeAsync(600)
    expect(shellInventoryStore.getVersion()).toBe(versionAfterInit + 1)
    expect(spy).toHaveBeenCalled()
    unsubscribe()
  })

  it('shell 状态流转（running → exited）也算变化', async () => {
    listShellsMock.mockResolvedValue([makeShell('a', 's1')])
    const unsubscribe = shellInventoryStore.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    const v0 = shellInventoryStore.getVersion()

    listShellsMock.mockResolvedValue([makeShell('a', 's1', 'exited')])
    shellInventoryStore.requestRefresh()
    await vi.advanceTimersByTimeAsync(600)
    expect(shellInventoryStore.getVersion()).toBe(v0 + 1)
    unsubscribe()
  })
})
