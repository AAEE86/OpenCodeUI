import { flushSync } from 'react-dom'

// ============================================
// View Transitions 包装器
//
// 用途：路由/工作区切换时的大 DOM 重建 + 滚动恢复，在 iOS WebKit 上会
// 触发合成层异步光栅空窗（白闪，bugs.webkit.org 253171/310087）。
// startViewTransition 把旧画面和新画面都先光栅化成位图快照再交叉淡入
// 淡出，用户看到的永远是已完成的快照，白屏空窗在结构上不存在。
//
// flushSync 迫使 React 在回调内同步提交 DOM，保证新快照包含更新后的
// 内容。不支持的浏览器（含 prefers-reduced-motion）直接执行更新，
// 行为与现状一致。
// ============================================

type ViewTransitionCapableDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

export function supportsViewTransition(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as ViewTransitionCapableDocument).startViewTransition === 'function'
  )
}

/** 在 View Transition 中执行 UI 更新；不支持时同步直跑 */
export function withViewTransition(update: () => void): void {
  if (!supportsViewTransition()) {
    update()
    return
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  const doc = document as ViewTransitionCapableDocument
  doc.startViewTransition!(() => {
    // 同步提交，确保浏览器捕获的新快照已是更新后的 DOM
    flushSync(update)
  })
}
