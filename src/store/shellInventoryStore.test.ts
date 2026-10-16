import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellInfo } from '@opencode/client/promise'

const listShellsMock = vi.fn<(directory: string) => Promise<ShellInfo[]>>()
vi.mock('../api/shell', () => ({
  listShells: (directory: string) => listShellsMock(directory),
  removeShell: vi.fn(),
}))

import { runningShellsForSession, shellInventoryStore } from './shellInventoryStore'

const DIR = '/repo'

function makeShell(id: string, sessionID: string, status: ShellInfo['status'] = 'running'): ShellInfo {
  return {
    id,
    status,
    command: `cmd-${id}`,
    cwd: DIR,
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

describe('shellInventoryStore（按目录登记 + 事件驱动 + 兜底轮询）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listShellsMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('目录首次登记立即拉取；退订干净后停止轮询并丢弃目录数据', async () => {
    listShellsMock.mockResolvedValue([makeShell('a', 's1')])
    const spy = vi.fn()
    const unsubscribe = shellInventoryStore.subscribe(spy)
    const untrack = shellInventoryStore.trackDirectory(DIR)

    await vi.advanceTimersByTimeAsync(0)
    expect(listShellsMock).toHaveBeenCalledWith(DIR)
    expect(shellInventoryStore.getShellsForDir(DIR).map(s => s.id)).toEqual(['a'])
    // 有数据（从无到有的变化）→ version bump 通知订阅者
    expect(spy).toHaveBeenCalled()

    untrack()
    unsubscribe()
    // 目录引用归零 → 数据丢弃
    expect(shellInventoryStore.getShellsForDir(DIR)).toEqual([])

    const callsBefore = listShellsMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    // 没有订阅者 → 兜底轮询不再打
    expect(listShellsMock.mock.calls.length).toBe(callsBefore)
  })

  it('requestRefresh 防抖合并连续事件；清单没变化不 bump version', async () => {
    listShellsMock.mockResolvedValue([makeShell('a', 's1')])
    const spy = vi.fn()
    const unsubscribe = shellInventoryStore.subscribe(spy)
    const untrack = shellInventoryStore.trackDirectory(DIR)
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

    untrack()
    unsubscribe()
  })

  it('shell 状态流转（running → exited）也算变化', async () => {
    listShellsMock.mockResolvedValue([makeShell('a', 's1')])
    const unsubscribe = shellInventoryStore.subscribe(() => {})
    const untrack = shellInventoryStore.trackDirectory(DIR)
    await vi.advanceTimersByTimeAsync(0)
    const v0 = shellInventoryStore.getVersion()

    listShellsMock.mockResolvedValue([makeShell('a', 's1', 'exited')])
    shellInventoryStore.requestRefresh()
    await vi.advanceTimersByTimeAsync(600)
    expect(shellInventoryStore.getVersion()).toBe(v0 + 1)

    untrack()
    unsubscribe()
  })

  it('多个目录各自隔离拉取（serve --service 按目录隔离的现实）', async () => {
    listShellsMock.mockImplementation(async (directory: string) =>
      directory === '/a' ? [makeShell('sh-a', 's1')] : [makeShell('sh-b', 's2')],
    )
    const unsubscribe = shellInventoryStore.subscribe(() => {})
    const untrackA = shellInventoryStore.trackDirectory('/a')
    const untrackB = shellInventoryStore.trackDirectory('/b')
    await vi.advanceTimersByTimeAsync(0)

    expect(shellInventoryStore.getShellsForDir('/a').map(s => s.id)).toEqual(['sh-a'])
    expect(shellInventoryStore.getShellsForDir('/b').map(s => s.id)).toEqual(['sh-b'])

    untrackA()
    untrackB()
    unsubscribe()
  })
})
