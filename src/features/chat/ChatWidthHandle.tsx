// ============================================
// ChatWidthHandle — 对话列 / 输入框左缘拖拽调宽把手
//
// 样式与交互直接抄 dsh ConversationWidthControls：
// - 10px 热区条带贴在内容列左缘外 24px 的 gutter（right: calc(50% + 宽/2 + 24px)）
// - 辉光是 2px 短条，跟随指针 Y（16px 实心核、两侧各 28px 渐隐），不是整条竖线
// - 平时 opacity 0 完全隐藏，hover / 拖拽中才显示
// 与 dsh 的差异（按需求收窄）：
// - 只有左缘把手（dsh 左右各一）；列居中，左缘外移 dx → 宽度变化 2|dx|
// - 对话列和输入框是两个独立把手，各写各的 CSS 变量、各存各的偏好
// - 只在桌面端单 panel / pane 全屏时由 ChatPane 挂载（分屏不调）
// - 拖拽期间直接写 pane 根上的 CSS 变量，零 React 渲染；松手才 onCommit 持久化
// - 恢复默认 = 设置里切换宽屏模式（开或关都会清掉两个自定义宽度）
// ============================================

import { useEffect, useRef, useState } from 'react'

/** pane 根上的 CSS 变量：对话列宽 / 输入框宽（ChatArea、InputBox 的 max-width 都引用它们） */
export const CHAT_COLUMN_WIDTH_VAR = '--oc-chat-column-width'
export const CHAT_INPUT_WIDTH_VAR = '--oc-chat-input-width'
/** 把手元素上的变量：辉光跟随的指针 Y（百分比），样式在 index.css */
const POINTER_Y_VAR = '--oc-width-handle-pointer-y'
/** 拖拽允许的最小宽度（px，对话列和输入框共用） */
export const MIN_CHAT_CONTENT_WIDTH = 480
/** 输入框默认宽度（px），未自定义时 = max-w-3xl */
export const DEFAULT_INPUT_WIDTH = 768

export interface ChatWidthHandleProps {
  /** pane 根元素：拖拽期间直接写 CSS 变量的目标 */
  rootRef: React.RefObject<HTMLElement | null>
  /** 当前生效的宽度（已解析默认值/自定义值并 clamp） */
  width: number
  /** 允许的最大宽度（pane 宽减去两侧 gutter） */
  maxWidth: number
  /** 松手提交最终宽度（持久化） */
  onCommit: (width: number) => void
  /** 拖拽期间写哪个 CSS 变量（对话列 / 输入框各传各的） */
  cssVar: string
  /** 悬浮提示 */
  title: string
  /** 纵向范围（对话列 top-10 bottom-0 避开头部；输入框 inset-y-0） */
  className?: string
  /** 定位（right: calc(50% + var(宽)/2 + 24px)，由调用方按目标宽度变量给出） */
  style?: React.CSSProperties
}

export function ChatWidthHandle({ rootRef, width, maxWidth, onCommit, cssVar, title, className, style }: ChatWidthHandleProps) {
  const [dragging, setDragging] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // 拖拽中途组件卸载（切会话/分屏）时摘掉全局监听
  useEffect(() => () => cleanupRef.current?.(), [])

  // 辉光跟随指针 Y（dsh 的 --dsh-width-handle-pointer-y 同款）：百分比写在自己身上
  const publishPointerY = (clientY: number) => {
    const el = stripRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    const pct = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100))
    el.style.setProperty(POINTER_Y_VAR, `${pct}%`)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const root = rootRef.current
    if (!root) return
    const startX = event.clientX
    const base = width
    let last = base
    setDragging(true)
    publishPointerY(event.clientY)

    const onMove = (ev: PointerEvent) => {
      // 列居中：左缘左移 dx（负值）→ 左右各让出 |dx| → 宽度 +2|dx|
      const dx = ev.clientX - startX
      last = Math.min(Math.max(base - dx * 2, MIN_CHAT_CONTENT_WIDTH), maxWidth)
      root.style.setProperty(cssVar, `${last}px`)
      publishPointerY(ev.clientY)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      cleanupRef.current = null
      setDragging(false)
      const finalWidth = Math.round(last)
      if (finalWidth !== Math.round(base)) onCommit(finalWidth)
    }
    cleanupRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      ref={stripRef}
      role="separator"
      aria-orientation="vertical"
      title={title}
      data-chat-width-handle="true"
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={e => publishPointerY(e.clientY)}
      className={`chat-width-handle ${className ?? ''}`}
      style={style}
    />
  )
}
