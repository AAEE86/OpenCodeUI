import { useEffect, useState, useSyncExternalStore } from 'react'
import { CodeMirrorReadonly } from './CodeMirrorReadonly'
import { codeLineHeight, type TargetLineRange } from './codeMirrorReadonlyExtensions'
import { useSyntaxHighlightRef } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'

/** 编辑态高亮 debounce：每击键全量重高亮的代价太高 */
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
  /** 默认只读；false = 可编辑预览（需求三） */
  readOnly?: boolean
  onChange?: (value: string) => void
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
  readOnly = true,
  onChange,
}: CodePreviewProps) {
  const { codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap

  // 编辑态：高亮跟着 debounce 后的文本走，避免每敲一个字符整文件重高亮
  const [highlightCode, setHighlightCode] = useState(code)
  useEffect(() => {
    if (readOnly) return
    const timer = window.setTimeout(() => setHighlightCode(code), HIGHLIGHT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [code, readOnly])

  const { tokensRef, version } = useSyntaxHighlightRef(readOnly ? code : highlightCode, {
    lang: language,
    enabled: language !== 'text',
  })

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
      readOnly={readOnly}
      onChange={onChange}
    />
  )
}
