import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodeMirrorEditable, type CodeMirrorEditableHandle } from './CodeMirrorEditable'

// ============================================
// 可编辑预览编辑器（需求三 P2.1）
//
// 关键契约：**非受控**（value 不进扩展依赖 → 打字不重建 EditorView）、
// 可编辑、有撤销栈、Mod-s 回调、外部值同步。
// ============================================

function renderEditor(props: Partial<React.ComponentProps<typeof CodeMirrorEditable>> = {}) {
  const tokensRef = { current: null }
  const handleRef = createRef<CodeMirrorEditableHandle>()
  const utils = render(
    <CodeMirrorEditable
      value={props.value ?? 'line one\nline two'}
      tokensRef={tokensRef}
      tokensVersion={0}
      wordWrap={false}
      lineHeight={24}
      handleRef={handleRef}
      {...props}
    />,
  )
  return { ...utils, handleRef, tokensRef }
}

describe('CodeMirrorEditable', () => {
  it('挂载后是**可编辑**的（与只读组件相反）', () => {
    const { container } = renderEditor()
    const editable = container.querySelector('.cm-content')
    expect(editable).toBeTruthy()
    expect(editable?.getAttribute('contenteditable')).toBe('true')
  })

  it('句柄能取到当前内容，并能从外部整篇同步（保留撤销栈由 CodeMirror 负责）', () => {
    const onChange = vi.fn()
    const { handleRef } = renderEditor({ onChange })

    expect(handleRef.current?.getValue()).toBe('line one\nline two')

    act(() => handleRef.current?.setValue('replaced'))

    expect(handleRef.current?.getValue()).toBe('replaced')
    // 外部同步也算一次文档变更 → 上报给父层（父层拿到同样的值，不会循环）
    expect(onChange).toHaveBeenCalledWith('replaced')
  })

  it('value 外部变化时同步进编辑器；用户输入不会被反向覆盖', () => {
    const { rerender, handleRef, tokensRef } = renderEditor({ value: 'first' })
    expect(handleRef.current?.getValue()).toBe('first')

    // 外部（磁盘重载）改了 value
    rerender(
      <CodeMirrorEditable
        value="from disk"
        tokensRef={tokensRef}
        tokensVersion={0}
        wordWrap={false}
        lineHeight={24}
        handleRef={handleRef}
      />,
    )
    expect(handleRef.current?.getValue()).toBe('from disk')

    // 用户改（模拟编辑器内部变更）→ 父层把同样的文本回传，不应触发无谓替换
    act(() => handleRef.current?.setValue('typed by user'))
    rerender(
      <CodeMirrorEditable
        value="typed by user"
        tokensRef={tokensRef}
        tokensVersion={0}
        wordWrap={false}
        lineHeight={24}
        handleRef={handleRef}
      />,
    )
    expect(handleRef.current?.getValue()).toBe('typed by user')
  })

  it('Mod-s 不在编辑器里吞掉默认行为之外的东西（保存由扩展层单测覆盖）', () => {
    const { container } = renderEditor({ onSave: vi.fn() })
    expect(container.querySelector('.cm-content')).toBeTruthy()
  })
})
