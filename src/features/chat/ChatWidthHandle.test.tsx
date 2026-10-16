import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import {
  ChatWidthHandle,
  CHAT_COLUMN_WIDTH_VAR,
  CHAT_INPUT_WIDTH_VAR,
  MIN_CHAT_CONTENT_WIDTH,
} from './ChatWidthHandle'

function Harness({
  onCommit,
  width = 672,
  maxWidth = 1000,
  cssVar = CHAT_COLUMN_WIDTH_VAR,
}: {
  onCommit: (w: number) => void
  width?: number
  maxWidth?: number
  cssVar?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={rootRef} data-testid="root">
      <ChatWidthHandle
        rootRef={rootRef}
        width={width}
        maxWidth={maxWidth}
        onCommit={onCommit}
        cssVar={cssVar}
        title="drag"
      />
    </div>
  )
}

// jsdom 没有 PointerEvent 构造器；React 的根监听按事件类型名分发，
// 用 MouseEvent 造 'pointerdown/move/up' 一样能走通整条链路
function pointer(type: string, init: MouseEventInit = {}) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
}

describe('ChatWidthHandle（左缘拖拽调宽）', () => {
  it('拖拽左缘外移 → 宽度按 2|dx| 变大，写 CSS 变量，松手提交', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const root = screen.getByTestId('root')
    const handle = screen.getByRole('separator')

    handle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 500, clientY: 100 }))
    // 向左拖 50px → 宽度 672 + 100 = 772
    window.dispatchEvent(pointer('pointermove', { clientX: 450, clientY: 120 }))
    expect(root.style.getPropertyValue(CHAT_COLUMN_WIDTH_VAR)).toBe('772px')
    expect(onCommit).not.toHaveBeenCalled()

    window.dispatchEvent(pointer('pointerup'))
    expect(onCommit).toHaveBeenCalledWith(772)
  })

  it('向右拖变窄，并分别 clamp 到下限 MIN 和上限 maxWidth', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const root = screen.getByTestId('root')
    const handle = screen.getByRole('separator')

    // 向右拖 400px → 672 - 800 = -128 → clamp 到 MIN
    handle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 500 }))
    window.dispatchEvent(pointer('pointermove', { clientX: 900 }))
    expect(root.style.getPropertyValue(CHAT_COLUMN_WIDTH_VAR)).toBe(`${MIN_CHAT_CONTENT_WIDTH}px`)
    window.dispatchEvent(pointer('pointerup'))
    expect(onCommit).toHaveBeenCalledWith(MIN_CHAT_CONTENT_WIDTH)

    // 向左拖 1000px → 672 + 2000 = 2672 → clamp 到 maxWidth 1000
    handle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 500 }))
    window.dispatchEvent(pointer('pointermove', { clientX: -500 }))
    expect(root.style.getPropertyValue(CHAT_COLUMN_WIDTH_VAR)).toBe('1000px')
    window.dispatchEvent(pointer('pointerup'))
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(onCommit).toHaveBeenLastCalledWith(1000)
  })

  it('只点不拖（宽度没变化）不提交', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const handle = screen.getByRole('separator')

    handle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 500 }))
    window.dispatchEvent(pointer('pointerup'))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('右键按下不启动拖拽', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const root = screen.getByTestId('root')
    const handle = screen.getByRole('separator')

    handle.dispatchEvent(pointer('pointerdown', { button: 2, clientX: 500 }))
    window.dispatchEvent(pointer('pointermove', { clientX: 400 }))
    expect(root.style.getPropertyValue(CHAT_COLUMN_WIDTH_VAR)).toBe('')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('两个把手各写各的变量（对话列 / 输入框独立调整）', () => {
    const onCommitChat = vi.fn()
    const onCommitInput = vi.fn()

    function TwoHandles() {
      const rootRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={rootRef} data-testid="root">
          <ChatWidthHandle
            rootRef={rootRef}
            width={672}
            maxWidth={1000}
            onCommit={onCommitChat}
            cssVar={CHAT_COLUMN_WIDTH_VAR}
            title="chat"
          />
          <ChatWidthHandle
            rootRef={rootRef}
            width={768}
            maxWidth={1000}
            onCommit={onCommitInput}
            cssVar={CHAT_INPUT_WIDTH_VAR}
            title="input"
          />
        </div>
      )
    }
    render(<TwoHandles />)
    const root = screen.getByTestId('root')
    const [chatHandle, inputHandle] = screen.getAllByRole('separator')

    // 拖输入框把手：只写输入框变量、只提交输入框宽度
    inputHandle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 500 }))
    window.dispatchEvent(pointer('pointermove', { clientX: 450 }))
    expect(root.style.getPropertyValue(CHAT_INPUT_WIDTH_VAR)).toBe('868px')
    expect(root.style.getPropertyValue(CHAT_COLUMN_WIDTH_VAR)).toBe('')
    window.dispatchEvent(pointer('pointerup'))
    expect(onCommitInput).toHaveBeenCalledWith(868)
    expect(onCommitChat).not.toHaveBeenCalled()

    // 拖对话列把手：只写对话列变量
    chatHandle.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 500 }))
    window.dispatchEvent(pointer('pointermove', { clientX: 520 }))
    expect(root.style.getPropertyValue(CHAT_COLUMN_WIDTH_VAR)).toBe('632px')
    expect(root.style.getPropertyValue(CHAT_INPUT_WIDTH_VAR)).toBe('868px')
    window.dispatchEvent(pointer('pointerup'))
    expect(onCommitChat).toHaveBeenCalledWith(632)
    expect(onCommitInput).toHaveBeenCalledTimes(1)
  })
})
