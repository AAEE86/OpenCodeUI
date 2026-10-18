import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'
import { createEditableCodeMirrorExtensions, dispatchShikiTokens } from './codeMirrorReadonlyExtensions'
import { getLineCount, getLineNumberColumnWidth } from '../utils/lineNumberUtils'

// ============================================
// CodeMirrorEditable — 可编辑的预览编辑器（需求三 P2.1）
//
// 与 CodeMirrorReadonly 的关键差别：**非受控**。
// EditorView 自己持有文档，React 只负责初始化 + 外部同步；`value` 不进
// useLayoutEffect 的依赖，所以每次按键不会重建 EditorView（只读那个组件
// 重建一次无感，编辑时重建会丢光标/选区/撤销栈）。
//
// 保存事务（基线比对 / 冲突决策 / 保真写回）在 P2.2，由父层负责；
// 这里只提供编辑器能力：撤销栈、Mod-s 回调、外部值同步、变更回调。
// ============================================

export interface CodeMirrorEditableHandle {
  getValue(): string
  /** 外部同步（磁盘重载 / 放弃改动）：整篇替换，保留撤销栈 */
  setValue(code: string): void
  focus(): void
}

interface CodeMirrorEditableProps {
  /**
   * 外部值。与编辑器当前内容不同时整篇同步进来；
   * 用户输入只通过 onChange 上报，不会反向触发同步。
   */
  value: string
  tokensRef: React.RefObject<HighlightTokens | null>
  tokensVersion: number
  wordWrap: boolean
  lineHeight: number
  maxHeight?: number
  showLineNumbers?: boolean
  className?: string
  onChange?: (code: string) => void
  /** Mod-s（Ctrl/Cmd+S）；P2.1 里可能为空（保存事务未接入） */
  onSave?: () => void
  handleRef?: React.RefObject<CodeMirrorEditableHandle | null>
}

export function CodeMirrorEditable({
  value,
  tokensRef,
  tokensVersion,
  wordWrap,
  lineHeight,
  maxHeight,
  showLineNumbers = true,
  className = '',
  onChange,
  onSave,
  handleRef,
}: CodeMirrorEditableProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const constrainedHeight = maxHeight !== undefined

  // 回调与初始值放 ref：扩展只建一次，不能因为回调变化而重建视图
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  /** 编辑器最后一次产出的文本（含外部同步写入），用于判断 value 是否为"外部变更" */
  const lastValueRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  }, [onChange, onSave])

  // 初始内容只取挂载时的值（非受控：之后由编辑器自己持有文档）
  const [initialCode] = useState(value)

  // 行号宽度按初始内容估算（编辑中不重算，避免每次按键重建扩展）
  const lineNumberWidth = useMemo(() => getLineNumberColumnWidth(getLineCount(initialCode)), [initialCode])

  // 视图与扩展一起建：扩展里的 updateListener / onSave 都要读 ref，
  // 读 ref 必须发生在 effect/回调里（不能在 render 期间），所以放在这里而不是 useMemo。
  // 依赖是排版/外观参数：它们变化时重建视图（与只读组件同款行为）。
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    const extensions = createEditableCodeMirrorExtensions({
      wordWrap,
      lineHeight,
      showLineNumbers,
      maxHeight,
      lineNumberWidth,
      extraExtensions: [
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          lastValueRef.current = text
          onChangeRef.current?.(text)
        }),
      ],
      onSave: () => onSaveRef.current?.(),
    })

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: initialCode, extensions }),
    })

    viewRef.current = view
    dispatchShikiTokens(view, tokensRef.current)

    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [initialCode, lineNumberWidth, wordWrap, lineHeight, showLineNumbers, maxHeight, tokensRef])

  // 外部值同步（磁盘重载、放弃改动等）
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === lastValueRef.current) return

    lastValueRef.current = value
    if (view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    dispatchShikiTokens(view, tokensRef.current)
  }, [tokensRef, tokensVersion])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    let secondFrameId: number | null = null
    const firstFrameId = requestAnimationFrame(() => {
      view.requestMeasure()
      secondFrameId = requestAnimationFrame(() => view.requestMeasure())
    })
    const transitionTimerId = window.setTimeout(() => view.requestMeasure(), 320)

    return () => {
      cancelAnimationFrame(firstFrameId)
      if (secondFrameId !== null) cancelAnimationFrame(secondFrameId)
      clearTimeout(transitionTimerId)
    }
  }, [constrainedHeight])

  // 对外句柄
  useEffect(() => {
    if (!handleRef) return
    handleRef.current = {
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (code: string) => {
        const view = viewRef.current
        if (!view || view.state.doc.toString() === code) return
        lastValueRef.current = code
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } })
      },
      focus: () => viewRef.current?.focus(),
    }
    return () => {
      handleRef.current = null
    }
  }, [handleRef])

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      const view = viewRef.current
      if (!view) return
      event.preventDefault()
      openSearchPanel(view)
    }
  }, [])

  return (
    <div
      className={`${constrainedHeight ? 'w-full overflow-hidden' : 'h-full min-h-0 w-full overflow-hidden'} font-mono text-[length:var(--fs-code)] ${className}`}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <div ref={hostRef} className={constrainedHeight ? '' : 'h-full min-h-0'} />
    </div>
  )
}
