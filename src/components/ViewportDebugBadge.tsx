// ============================================
// 临时诊断：键盘弹起时的视口度量角标
//
// 仅在「有输入焦点（疑似键盘弹起）」时显示，用于定位 iOS 上
// 输入框被顶到屏幕顶部的问题。修好后整个文件删除。
// ============================================

import { useEffect, useState } from 'react'
import { isTauri } from '../utils/tauri'

interface Snapshot {
  ih: number
  vvH: number
  vvT: number
  sh: number
  ah: string
  rootH: number
  taT: number | null
  taB: number | null
}

function takeSnapshot(): Snapshot {
  const vv = window.visualViewport
  const root = document.getElementById('root')
  const textarea = document.querySelector('textarea')
  const taRect = textarea?.getBoundingClientRect()
  return {
    ih: window.innerHeight,
    vvH: vv ? Math.round(vv.height) : -1,
    vvT: vv ? Math.round(vv.offsetTop) : -1,
    sh: window.screen.height,
    ah: document.documentElement.style.getPropertyValue('--app-height') || 'unset',
    rootH: root ? Math.round(root.getBoundingClientRect().height) : -1,
    taT: taRect ? Math.round(taRect.top) : null,
    taB: taRect ? Math.round(taRect.bottom) : null,
  }
}

function hasEditableFocus() {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'TEXTAREA' || tag === 'INPUT' || (el as HTMLElement).isContentEditable
}

export function ViewportDebugBadge() {
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    if (isTauri()) return
    const tick = () => {
      setSnap(hasEditableFocus() ? takeSnapshot() : null)
    }
    const timer = window.setInterval(tick, 300)
    document.addEventListener('focusin', tick)
    document.addEventListener('focusout', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('focusin', tick)
      document.removeEventListener('focusout', tick)
    }
  }, [])

  if (!snap) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 4px)',
        left: 4,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        color: '#7fff7f',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.5,
        padding: '4px 8px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {`ih:${snap.ih} vv:${snap.vvH}+${snap.vvT} sh:${snap.sh}\nah:${snap.ah} root:${snap.rootH}\nta:${snap.taT}~${snap.taB}`}
    </div>
  )
}
