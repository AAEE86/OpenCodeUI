import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellInfo } from '@opencode/client/promise'
import { createSessionPlaceholder } from '../../../utils/sessionPlaceholder'
import { serverStore } from '../../../store/serverStore'

const { listShellsMock, removeShellMock, getShellOutputMock } = vi.hoisted(() => ({
  listShellsMock: vi.fn(),
  removeShellMock: vi.fn(),
  getShellOutputMock: vi.fn(),
}))

vi.mock('../../../api/shell', () => ({
  listShells: () => listShellsMock(),
  removeShell: (...args: unknown[]) => removeShellMock(...args),
  getShellOutput: (...args: unknown[]) => getShellOutputMock(...args),
}))

import { shellInventoryStore } from '../../../store/shellInventoryStore'
import { SessionShellsSlot } from './SessionShellsSlot'

const ACTIVE = serverStore.getActiveServerId()

function makeShell(id: string, sessionID: string, command = `cmd-${id}`): ShellInfo {
  return {
    id,
    status: 'running',
    command,
    cwd: '/repo',
    shell: 'bash',
    file: '',
    metadata: { sessionID },
    time: { started: 1 },
  } as ShellInfo
}

const parent = createSessionPlaceholder({ id: 'session-1', title: 'Parent', directory: '/workspace' })

describe('SessionShellsSlot（后台 shell 挂载）', () => {
  beforeEach(() => {
    listShellsMock.mockReset()
    removeShellMock.mockReset()
    removeShellMock.mockResolvedValue(undefined)
  })

  it('父会话下有 running shell → 挂载行；别的会话的 shell 不出现', async () => {
    listShellsMock.mockResolvedValue([
      makeShell('sh-1', 'session-1', 'npm run dev'),
      makeShell('sh-2', 'session-1', 'pytest'),
      makeShell('sh-3', 'session-2', 'other'),
      { ...makeShell('sh-4', 'session-1'), status: 'exited' } as ShellInfo,
    ])

    render(<SessionShellsSlot parentSession={parent} serverId={ACTIVE} />)

    await waitFor(() => expect(screen.getByText('npm run dev')).toBeInTheDocument())
    expect(screen.getByText('pytest')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
    expect(screen.queryByText('cmd-sh-4')).not.toBeInTheDocument()
  })

  it('没有 running shell → 什么都不渲染', async () => {
    listShellsMock.mockResolvedValue([makeShell('sh-9', 'session-2')])
    const { container } = render(<SessionShellsSlot parentSession={parent} serverId={ACTIVE} />)
    await waitFor(() => expect(listShellsMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('行尾 × 停止：调 removeShell 并请求库存重取', async () => {
    listShellsMock.mockResolvedValue([makeShell('sh-1', 'session-1', 'npm run dev')])
    render(<SessionShellsSlot parentSession={parent} serverId={ACTIVE} />)

    const stopButton = await screen.findByTitle('Stop this shell')
    const callsBefore = listShellsMock.mock.calls.length
    fireEvent.click(stopButton)

    await waitFor(() => expect(removeShellMock).toHaveBeenCalledWith('sh-1', undefined, ACTIVE))
    // 停止后请求重取库存（500ms 防抖后触发）
    await waitFor(() => expect(listShellsMock.mock.calls.length).toBeGreaterThan(callsBefore), { timeout: 2000 })
  })

  it('点击行打开输出弹窗（打开时存快照，shell 退出列表后弹窗不闪关）', async () => {
    getShellOutputMock.mockResolvedValue({ output: 'hello\n', cursor: 6, size: 6, truncated: false })
    listShellsMock.mockResolvedValue([makeShell('sh-1', 'session-1', 'npm run dev')])
    render(<SessionShellsSlot parentSession={parent} serverId={ACTIVE} />)

    fireEvent.click(await screen.findByText('npm run dev'))
    // 弹窗打开：状态行出现「运行中」
    await screen.findByText('Running')

    // shell 退出 → 离开 running 列表（挂载行消失），但弹窗靠快照继续开着
    listShellsMock.mockResolvedValue([{ ...makeShell('sh-1', 'session-1'), status: 'exited', exit: 0 } as ShellInfo])
    shellInventoryStore.requestRefresh()
    await waitFor(() => expect(screen.queryByTitle('Stop this shell')).not.toBeInTheDocument(), { timeout: 2000 })
    // 弹窗仍在，状态随后续库存刷新翻成 Exited
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await screen.findByText('Exited', {}, { timeout: 2000 })
  })
})
