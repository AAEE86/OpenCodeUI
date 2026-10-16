import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '@opencode/client/promise'
import { BashRenderer } from './BashRenderer'
import { FullscreenProvider } from '../../../../contexts'
import { DirectoryContext, type DirectoryContextValue } from '../../../../contexts/DirectoryContext.shared'
import type { ToolViewPart } from '../index'

const { getShellOutputMock } = vi.hoisted(() => ({
  getShellOutputMock: vi.fn(),
}))

vi.mock('../../../../api/shell', () => ({
  getShellOutput: (...args: unknown[]) => getShellOutputMock(...args),
  listShells: vi.fn(),
  removeShell: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

function runningPart(metadata: Record<string, JsonValue>): ToolViewPart {
  return {
    type: 'tool',
    id: 'tool-1',
    name: 'shell',
    messageID: 'message-1',
    state: {
      status: 'running',
      input: { command: 'npm run dev' },
      metadata,
    },
    time: { created: 1_000 },
  }
}

const directoryValue = { currentDirectory: '/repo' } as unknown as DirectoryContextValue

function renderBash(part: ToolViewPart, data: Parameters<typeof BashRenderer>[0]['data']) {
  return render(
    <DirectoryContext.Provider value={directoryValue}>
      <FullscreenProvider>
        <BashRenderer part={part} data={data} />
      </FullscreenProvider>
    </DirectoryContext.Provider>,
  )
}

describe('BashRenderer 运行中流式输出（官方 followShellOutput 同款）', () => {
  beforeEach(() => {
    getShellOutputMock.mockReset()
  })

  it('running + metadata.shellID → 游标轮询实时输出并显示', async () => {
    getShellOutputMock.mockResolvedValue({ output: 'vite dev ready\nlistening on 5173\n', cursor: 34, size: 34, truncated: false })
    renderBash(runningPart({ shellID: 'sh-1' }), { input: 'npm run dev' })

    // 实时输出直接出现在输出区（不等工具结束）
    await screen.findByText(/listening on 5173/)
    expect(getShellOutputMock).toHaveBeenCalledWith('sh-1', 0, '/repo', undefined)
  })

  it('running 但没有 shellID → 不轮询（拿不到 shell 句柄，只能等结束）', async () => {
    renderBash(runningPart({}), { input: 'npm run dev' })
    // 给可能的轮询留时间（首轮是立即发起的）
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(getShellOutputMock).not.toHaveBeenCalled()
  })

  it('completed → 不轮询，显示 content 里的最终输出', async () => {
    const part: ToolViewPart = {
      type: 'tool',
      id: 'tool-1',
      name: 'bash',
      messageID: 'message-1',
      state: {
        status: 'completed',
        input: { command: 'echo done' },
        metadata: { shellID: 'sh-1', exit: 0 },
        content: [{ type: 'text', text: 'done' }],
      },
      time: { created: 1_000, completed: 2_000 },
    }
    renderBash(part, { input: 'echo done', output: 'done' })
    await screen.findByText('done')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(getShellOutputMock).not.toHaveBeenCalled()
  })
})
