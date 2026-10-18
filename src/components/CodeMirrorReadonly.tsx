import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Annotation, EditorState, Compartment, type Extension } from '@codemirror/state'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'
import {
  clearTargetLine,
  createReadonlyCodeMirrorExtensions,
  dispatchShikiTokens,
  dispatchTargetLine,
  type TargetLineRange,
} from './codeMirrorReadonlyExtensions'
import { getLineCount, getLineNumberColumnWidth } from '../utils/lineNumberUtils'

interface CodeMirrorReadonlyProps {
  code: string
  tokensRef: React.RefObject<HighlightTokens | null>
  tokensVersion: number
  wordWrap: boolean
  lineHeight: number
  maxHeight?: number
  isResizing?: boolean
  isVisible?: boolean
  layoutVersion?: number
  showLineNumbers?: boolean
  className?: string
  extraExtensions?: Extension[]
  targetLine?: number | null
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
  /** false = 可编辑（需求三：预览编辑器）。默认只读 */
  readOnly?: boolean
  onChange?: (value: string) => void
}

const EMPTY_TARGET_RANGES: readonly TargetLineRange[] = []
const EMPTY_EXTENSIONS: Extension[] = []
/** 标记"这次文档变更是外部同步进来的"，便于将来区分用户输入与磁盘重载 */
const externalCodeUpdate = Annotation.define<boolean>()

/** 变更监听：放在 Compartment 里，回调变化时 reconfigure 而不是重建视图 */
function changeListener(onChange?: (value: string) => void): Extension {
  return EditorView.updateListener.of(update => {
    if (!update.docChanged) return
    if (update.transactions.some(tr => tr.annotation(externalCodeUpdate))) return
    onChange?.(update.state.doc.toString())
  })
}

export function CodeMirrorReadonly({
  code,
  tokensRef,
  tokensVersion,
  wordWrap,
  lineHeight,
  maxHeight,
  isResizing = false,
  isVisible = true,
  layoutVersion = 0,
  showLineNumbers = true,
  className = '',
  extraExtensions = EMPTY_EXTENSIONS,
  targetLine,
  targetKey,
  targetRanges = EMPTY_TARGET_RANGES,
  readOnly = true,
  onChange,
}: CodeMirrorReadonlyProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const constrainedHeight = maxHeight !== undefined
  const lineNumberWidth = useMemo(() => getLineNumberColumnWidth(getLineCount(code)), [code])

  // 只在**挂载时**用的初值：view 创建后由编辑器自己持有文档（非受控），
  // 外部变更走下面的 dispatch 同步，避免每次按键重建视图（会丢光标/选区/撤销栈）
  const initialCodeRef = useRef(code)
  const initialTokensRef = useRef<HighlightTokens | null>(null)
  const initialOnChangeRef = useRef(onChange)
  const changeCompartment = useMemo(() => new Compartment(), [])

  const extensions = useMemo(
    () =>
      createReadonlyCodeMirrorExtensions({
        wordWrap,
        lineHeight,
        showLineNumbers,
        maxHeight,
        editable: !constrainedHeight,
        readOnly,
        lineNumberWidth,
        extraExtensions,
      }),
    [wordWrap, lineHeight, showLineNumbers, maxHeight, constrainedHeight, lineNumberWidth, extraExtensions, readOnly],
  )

  // 同步创建 view 需要的初值（这个 effect 排在创建 view 的 layout effect 之前）
  useLayoutEffect(() => {
    initialCodeRef.current = code
    initialTokensRef.current = tokensRef.current
    initialOnChangeRef.current = onChange
  }, [code, onChange, tokensRef])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialCodeRef.current,
        extensions: [extensions, changeCompartment.of(changeListener(initialOnChangeRef.current))],
      }),
    })

    viewRef.current = view
    dispatchShikiTokens(view, initialTokensRef.current)

    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [changeCompartment, extensions])

  // 回调变化只 reconfigure 这个 Compartment，不重建视图
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: changeCompartment.reconfigure(changeListener(onChange)) })
  }, [changeCompartment, onChange])

  // 外部值同步（磁盘重载 / 放弃改动）
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === code) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
      annotations: externalCodeUpdate.of(true),
    })
  }, [code])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    dispatchShikiTokens(view, tokensRef.current)
  }, [tokensRef, tokensVersion])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || !isVisible || !targetLine) return

    let disposed = false
    let frameId: number | null = null
    let clearTimerId: number | null = null

    frameId = requestAnimationFrame(() => {
      if (disposed || !view.dom.isConnected) return

      dispatchTargetLine(view, targetLine, targetRanges)
      clearTimerId = window.setTimeout(() => {
        if (!disposed) clearTargetLine(view)
      }, 1600)
    })

    return () => {
      disposed = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      if (clearTimerId !== null) clearTimeout(clearTimerId)
      if (viewRef.current === view) clearTargetLine(view)
    }
  }, [code, isVisible, targetKey, targetLine, targetRanges])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !isVisible) return

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
  }, [isVisible, layoutVersion])

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
      data-resizing={isResizing ? 'true' : undefined}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <div ref={hostRef} className={constrainedHeight ? '' : 'h-full min-h-0'} />
    </div>
  )
}
