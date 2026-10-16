import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageRenderer } from './MessageRenderer'
import type { AssistantContent, AssistantMessage } from '../../types/api/message'

/**
 * step 完成信息（tokens / cost / 耗时 / agent / model）的挂载位置。
 *
 * v2 一个助手消息 = 一个 step，数据全在消息上，所以固定挂在本消息内容末尾。
 * 这里刻意**保留真的 StepFinishPartView**（其它 part 都是空实现），
 * 旧代码把信息挂在「最后一个可见条目」上，末尾是正文时整块数据会跟着丢。
 */

vi.mock('motion/mini', () => ({
  animate: () => Promise.resolve(),
}))

vi.mock('../../hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false, canHover: true, hasCoarsePointer: false, hasTouch: false }),
}))

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    collapseUserMessages: false,
    renderUserMarkdown: false,
    stepFinishDisplay: {
      latestOnly: true,
      turnDuration: true,
      tokens: true,
      cache: true,
      cost: true,
      duration: true,
      agent: false,
      model: false,
      completedAt: false,
    },
    completedAtFormat: 'time',
    actionsOnLatestAssistantOnly: true,
    descriptiveToolSteps: false,
    inlineToolRequests: false,
    immersiveMode: false,
    processCollapseEnabled: false,
  }),
}))

vi.mock('../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('../../components/ui', () => ({
  CopyButton: ({ text }: { text: string }) => <button type="button">copy:{text}</button>,
  SmoothHeight: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./parts', async () => {
  const { StepFinishPartView } = await import('./parts/StepFinishPartView')
  return {
    TextPartView: ({ part }: { part: { text: string } }) => <div>{part.text}</div>,
    ReasoningPartView: () => null,
    ToolPartView: () => null,
    StepFinishPartView,
    RetryPartView: () => null,
    MessageErrorView: () => null,
    CompactionPartView: () => null,
  }
})

/** 133228 tokens → 展示成 133.2k；缓存命中 132480 → 132.5k */
const USAGE = { input: 477, output: 195, reasoning: 66, cache: { read: 132480, write: 10 } }

function assistant(content: AssistantContent[], usage = true): AssistantMessage {
  return {
    type: 'assistant',
    id: 'assistant-1',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content,
    time: { created: 1000, streamed: 9000, completed: 12000 },
    ...(usage ? { tokens: USAGE, cost: 0.0123 } : { tokens: undefined, cost: undefined }),
  } as AssistantMessage
}

const text = (value: string): AssistantContent => ({ type: 'text', text: value })
const reasoning = (value: string): AssistantContent => ({ type: 'reasoning', text: value })
const tool = (name: string): AssistantContent => ({
  type: 'tool',
  id: `tool-${name}`,
  name,
  state: {
    status: 'completed',
    input: { command: 'pwd' },
    content: [{ type: 'text', text: 'ok' }],
    metadata: { title: 'pwd' },
  },
  time: { created: 1, completed: 2 },
})

describe('step 完成信息挂载位置', () => {
  it('消息末尾是正文时照样渲染（旧代码会整块丢掉）', () => {
    render(<MessageRenderer message={assistant([reasoning('想想'), text('答案')])} turnDuration={11000} isTurnLatestAssistant />)

    expect(screen.getByText('答案')).toBeInTheDocument()
    expect(screen.getByText(/133\.2k/)).toBeInTheDocument()
    expect(screen.getByText(/11\.0s total/)).toBeInTheDocument()
  })

  it('只有正文、末尾没有工具组时也渲染', () => {
    render(<MessageRenderer message={assistant([text('答案')])} turnDuration={11000} isTurnLatestAssistant />)

    expect(screen.getByText(/133\.2k/)).toBeInTheDocument()
  })

  it('消息末尾是工具组时渲染', () => {
    render(<MessageRenderer message={assistant([reasoning('想想'), tool('bash')])} turnDuration={11000} isTurnLatestAssistant />)

    expect(screen.getByText(/133\.2k/)).toBeInTheDocument()
  })

  it('工具组在前、正文在末时渲染，且只渲染一次', () => {
    render(<MessageRenderer message={assistant([tool('bash'), text('答案')])} turnDuration={11000} isTurnLatestAssistant />)

    expect(screen.getAllByText(/133\.2k/)).toHaveLength(1)
  })

  it('壳内那截且壳外还有一份时（stepFinishVisible=false）不渲染，避免重复', () => {
    const { container } = render(
      <MessageRenderer
        message={assistant([tool('bash'), text('答案')])}
        processContentScope="process"
        stepFinishVisible={false}
        turnDuration={11000}
        isTurnLatestAssistant
      />,
    )

    expect(container.textContent).not.toContain('133.2k')
  })

  it('壳内那截没有壳外副本时照常渲染', () => {
    render(
      <MessageRenderer message={assistant([tool('bash')])} processContentScope="process" turnDuration={11000} isTurnLatestAssistant />,
    )

    expect(screen.getByText(/133\.2k/)).toBeInTheDocument()
  })

  it("壳外 final 正文渲染", () => {
    render(
      <MessageRenderer message={assistant([text('答案')])} processContentScope="final" turnDuration={11000} isTurnLatestAssistant />,
    )

    expect(screen.getByText(/133\.2k/)).toBeInTheDocument()
  })

  it('latestOnly 开启且不是整轮最后一条时不渲染', () => {
    const { container } = render(<MessageRenderer message={assistant([text('答案')])} turnDuration={11000} isTurnLatestAssistant={false} />)

    expect(container.textContent).not.toContain('133.2k')
  })

  it('没有 tokens/cost 时回落到回合耗时一行', () => {
    render(<MessageRenderer message={assistant([text('中断了')], false)} turnDuration={11000} isTurnLatestAssistant />)

    expect(screen.getByText('中断了')).toBeInTheDocument()
    expect(screen.getByText(/11\.0s total/)).toBeInTheDocument()
  })
})
