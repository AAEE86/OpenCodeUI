import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CompactionPartView } from './SystemPartViews'
import type { SessionMessageCompaction } from '@opencode/client/promise'

// 隔离滚动锁定（jsdom 不需要），但保留 useDelayedRender 真实以还原收起/展开行为
vi.mock('../../../hooks', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks')>()
  return {
    ...actual,
    useDisclosureScrollLock: () => ({
      rootRef: () => undefined,
      headerRef: () => undefined,
      withScrollLock: (action: () => void) => action(),
    }),
  }
})

function compaction(overrides: Record<string, unknown>): SessionMessageCompaction {
  return {
    id: 'msg-c1',
    type: 'compaction',
    reason: 'manual',
    time: { created: Date.now() },
    ...overrides,
  } as unknown as SessionMessageCompaction
}

// 每个用例用独立 id，避免 disclosure 缓存跨用例泄漏
describe('CompactionPartView（单标识 + 可收起）', () => {
  it('running：started 标识 + 流式摘要，不再有转圈指示', () => {
    render(<CompactionPartView message={compaction({ id: 'c-run', status: 'running', summary: '正在总结前半段…', recent: '' })} />)
    expect(screen.getByText('Compacting context', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('正在总结前半段…')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('completed：标识变成结果+用量，摘要默认收起、点击展开', () => {
    render(
      <CompactionPartView
        message={compaction({
          id: 'c-done',
          status: 'completed',
          summary: '压缩完成',
          recent: '',
          tokens: { input: 1000, output: 200, reasoning: 100, cache: { read: 2000, write: 500 } },
        })}
      />,
    )
    // input = 1000+2000+500=3500 → 3.5K；output = 200+100=300
    expect(screen.getByText(/History compacted · 3\.5K in · 300 out/)).toBeInTheDocument()
    // 默认自动收起：摘要不在 DOM
    expect(screen.queryByText('压缩完成')).not.toBeInTheDocument()
    // 点击标识展开
    fireEvent.click(screen.getByRole('button', { name: /History compacted/ }))
    expect(screen.getByText('压缩完成')).toBeInTheDocument()
  })

  it('completed + providerContext → 服务商压缩标签', () => {
    render(
      <CompactionPartView
        message={compaction({
          id: 'c-provider',
          status: 'completed',
          summary: 'x',
          recent: '',
          providerContext: { version: 1, provenance: {}, messages: [] },
        })}
      />,
    )
    expect(screen.getByText('Provider compaction')).toBeInTheDocument()
  })

  it('failed：失败标签，点击展开看错误详情，不显示摘要', () => {
    render(
      <CompactionPartView
        message={compaction({
          id: 'c-fail',
          status: 'failed',
          error: { type: 'compaction.failed', message: 'provider 503' },
        })}
      />,
    )
    expect(screen.getByText(/Compaction failed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Compaction failed/ }))
    expect(screen.getByText('provider 503')).toBeInTheDocument()
  })

  it('failed + aborted → 已取消，无内容为纯分隔线（不可点）', () => {
    render(
      <CompactionPartView
        message={compaction({
          id: 'c-abort',
          status: 'failed',
          error: { type: 'aborted', message: 'user cancelled' },
        })}
      />,
    )
    expect(screen.getByText('Compaction cancelled')).toBeInTheDocument()
    expect(screen.queryByText('user cancelled')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('failed + interrupted → 被中断标签', () => {
    render(
      <CompactionPartView
        message={compaction({
          id: 'c-interrupt',
          status: 'failed',
          error: { type: 'compaction.interrupted', message: 'interrupted' },
        })}
      />,
    )
    expect(screen.getByText('Compaction interrupted')).toBeInTheDocument()
  })

  it('completed：展开后底部有 undo/分叉/复制操作条，undo 回传消息 id', () => {
    const onUndo = vi.fn()
    const onFork = vi.fn()
    render(
      <CompactionPartView
        message={compaction({ id: 'c-actions', status: 'completed', summary: '压缩完成', recent: '' })}
        onUndo={onUndo}
        onFork={onFork}
        canUndo
      />,
    )
    // 展开后才渲染操作条
    fireEvent.click(screen.getByRole('button', { name: /History compacted/ }))
    const undoBtn = screen.getByRole('button', { name: 'Undo from here' })
    fireEvent.click(undoBtn)
    expect(onUndo).toHaveBeenCalledWith('c-actions')
    expect(screen.getByRole('button', { name: 'Fork from here' })).toBeInTheDocument()
  })

  it('collapsed 时不渲染 undo 按钮（操作条随内容收起）', () => {
    render(
      <CompactionPartView
        message={compaction({ id: 'c-collapsed', status: 'completed', summary: '压缩完成', recent: '' })}
        onUndo={vi.fn()}
        canUndo
      />,
    )
    expect(screen.queryByRole('button', { name: 'Undo from here' })).not.toBeInTheDocument()
  })
})
