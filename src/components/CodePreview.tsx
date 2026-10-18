import { useEffect, useState, useSyncExternalStore } from 'react'
import { CodeMirrorReadonly } from './CodeMirrorReadonly'
import { CodeMirrorEditable, type CodeMirrorEditableHandle } from './CodeMirrorEditable'
import { codeLineHeight, type TargetLineRange } from './codeMirrorReadonlyExtensions'
import { useSyntaxHighlightRef } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'

/** 编辑态高亮 debounce：每击键全量重高亮的代价太高（P2.1） */
const HIGHLIGHT_DEBOUNCE_MS = 200

interface CodePreviewProps {
  code: string
  language: string
  maxHeight?: number
  isResizing?: boolean
  isVisible?: boolean
  layoutVersion?: number
  wordWrap?: boolean
  targetLine?: number | null
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
  /** 可编辑（需求三 P2.1）：保存事务尚未接入，父层负责暂存草稿 */
  editable?: boolean
  onChange?: (code: string) => void
  onSave?: () => void
  handleRef?: React.RefObject<CodeMirrorEditableHandle | null>
}

export function CodePreview({
  code,
  language,
  maxHeight,
  isResizing = false,
  isVisible = true,
  layoutVersion,
  wordWrap,
  targetLine,
  targetKey,
  targetRanges,
  editable = false,
  onChange,
  onSave,
  handleRef,
}: CodePreviewProps) {
  const { codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap

  // 编辑态：高亮跟着 debounce 后的文本走，避免每敲一个字符整文件重高亮
  const [highlightCode, setHighlightCode] = useState(code)
  useEffect(() => {
    if (!editable) return
    const timer = window.setTimeout(() => setHighlightCode(code), HIGHLIGHT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [code, editable])

  const { tokensRef, version } = useSyntaxHighlightRef(editable ? highlightCode : code, {
    lang: language,
    enabled: language !== 'text',
  })

  if (editable) {
    return (
      <CodeMirrorEditable
        value={code}
        tokensRef={tokensRef}
        tokensVersion={version}
        wordWrap={resolvedWordWrap}
        lineHeight={codeLineHeight(codeFontScale)}
        maxHeight={maxHeight}
        className={isResizing ? 'pointer-events-none' : ''}
        onChange={onChange}
        onSave={onSave}
        handleRef={handleRef}
      />
    )
  }

  return (
    <CodeMirrorReadonly
      code={code}
      tokensRef={tokensRef}
      tokensVersion={version}
      wordWrap={resolvedWordWrap}
      lineHeight={codeLineHeight(codeFontScale)}
      maxHeight={maxHeight}
      isResizing={isResizing}
      isVisible={isVisible}
      layoutVersion={layoutVersion}
      targetLine={targetLine}
      targetKey={targetKey}
      targetRanges={targetRanges}
    />
  )
}
