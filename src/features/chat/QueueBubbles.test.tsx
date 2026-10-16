import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueueBubbles } from './QueueBubbles'
import { setUiDisclosureState } from '../../utils/uiDisclosureState'
import { themeStore } from '../../store/themeStore'
import type { QueuedUserPrompt } from '../../store/inboxStore'

function makeItem(id: string, text: string): QueuedUserPrompt {
  return {
    id,
    type: 'user',
    delivery: 'queue',
    payload: { text },
  } as unknown as QueuedUserPrompt
}

/** 内容用例共用的展开态 key（折叠状态是模块级缓存，显式归位避免用例间串扰） */
const EXPANDED_KEY = 'queue-bubbles:test-expanded'

describe('QueueBubbles（下轮队列虚线气泡）', () => {
  beforeEach(() => {
    themeStore.setQueueAutoCollapse(true)
    setUiDisclosureState(EXPANDED_KEY, true)
  })

  it('renders nothing when the queue is empty', () => {
    const { container } = render(<QueueBubbles items={[]} />)
    expect(container.querySelector('[data-message-queue]')).not.toBeInTheDocument()
  })

  it('renders one dashed bubble per queued item with the group label', () => {
    render(<QueueBubbles stateKey={EXPANDED_KEY} items={[makeItem('q1', '排队这条'), makeItem('q2', '再排一条')]} />)
    expect(screen.getByText('排队这条')).toBeInTheDocument()
    expect(screen.getByText('再排一条')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-message-queue="queued"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-message-queue="queued"] .border-dashed')).toHaveLength(2)
  })

  it('prefers metadata.displayText over payload.text（官方 queuedPromptText）', () => {
    const item = makeItem('q1', 'raw text')
    ;(item.payload as Record<string, unknown>).metadata = { displayText: '展示文本' }
    render(<QueueBubbles stateKey={EXPANDED_KEY} items={[item]} />)
    expect(screen.getByText('展示文本')).toBeInTheDocument()
    expect(screen.queryByText('raw text')).not.toBeInTheDocument()
  })

  it('fires steer / edit / remove callbacks with the item', () => {
    const onSteer = vi.fn()
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const item = makeItem('q1', '排队这条')
    render(<QueueBubbles stateKey={EXPANDED_KEY} items={[item]} onSteer={onSteer} onEdit={onEdit} onRemove={onRemove} />)
    fireEvent.click(screen.getByTitle('Inject into current turn'))
    expect(onSteer).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByTitle('Retract to edit'))
    expect(onEdit).toHaveBeenCalledWith(item)
    fireEvent.click(screen.getByTitle('Remove from queue'))
    expect(onRemove).toHaveBeenCalledWith(item)
  })

  it('collapses bubbles by default and toggles on header click（compact 同款）', async () => {
    render(<QueueBubbles stateKey="queue-bubbles:test-collapse" items={[makeItem('q1', '排队这条')]} />)

    // 默认折叠：只有标题行，气泡不渲染
    expect(screen.queryByText('排队这条')).not.toBeInTheDocument()
    const header = screen.getByRole('button', { name: 'Next turn (1)' })
    expect(header).toHaveAttribute('aria-expanded', 'false')

    // 点击标题展开
    fireEvent.click(header)
    expect(screen.getByText('排队这条')).toBeInTheDocument()
    expect(header).toHaveAttribute('aria-expanded', 'true')

    // 再点收起（卸载有延迟，等它结束）
    fireEvent.click(header)
    await waitFor(() => {
      expect(screen.queryByText('排队这条')).not.toBeInTheDocument()
    })
  })

  it('expands by default when the collapse setting is off（默认展开开关）', () => {
    themeStore.setQueueAutoCollapse(false)
    render(<QueueBubbles stateKey="queue-bubbles:test-setting-off" items={[makeItem('q1', '排队这条')]} />)
    expect(screen.getByText('排队这条')).toBeInTheDocument()
  })
})
