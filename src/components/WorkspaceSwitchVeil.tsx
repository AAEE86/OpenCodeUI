import { useLayoutEffect, useRef, useState } from 'react'
import { useCurrentDirectory } from '../contexts'
import { supportsViewTransition } from '../utils/viewTransition'

// ============================================
// WorkspaceSwitchVeil — iOS WebKit 白闪遮罩
//
// 背景：iOS 上所有浏览器都是 WebKit。它把溢出滚动容器和 GPU 合成层
// 的内容**异步光栅化**；当程序化滚动与 DOM 布局变化落在同一帧时，
// 这些层的 backing store 还没为新可视区域画好，WebKit 会延迟几帧
// 才绘制——期间露出 webview 的白色画布（无视页面背景色），表现为
// 全屏白闪。Chromium（安卓/PC）同步光栅，完全无此问题。
// 参考：WebKit Bug 253171 / 310087（官方修复 310864@main 尚未随
// iOS 发布）/ 311569（backing 缺失期间白画布忽略深色背景）。
//
// 切换工作区正好踩中触发模式：一个大 commit 同时重建会话列表 /
// 聊天区 / 文件树 DOM 并恢复滚动位置。
//
// 对策：常驻 DOM 的纯色（主题背景色）全屏层，切换瞬间 opacity→1
// （合成器只改透明度，纯色填充光栅成本≈0），等新内容光栅完成后
// 淡出。白色画布被这层深色彻底盖住。仅 iOS WebKit 启用。
// ============================================

/** 盖上后等待新内容光栅完成的时长（白闪一般持续 2~3 帧，但项目切换
 * 后列表/聊天区是异步数据到达才重建，遮盖期要覆盖到那次重绘） */
const SETTLE_MS = 500
/** 淡出动画时长（盖上是瞬时的，不能渐变，否则挡不住白闪） */
const FADE_OUT_MS = 180

function isIosWebKit(): boolean {
  // View Transitions 可用时（Safari 18.2+/iOS 18.2+）由路由层的
  // 快照交叉淡化接管，遮罩反而会把淡化盖住——这里只兜底更旧的 iOS
  if (supportsViewTransition()) return false
  // Tauri 桌面/安卓走 Chromium 系 WebView，不存在该问题
  if (document.documentElement.classList.contains('tauri-app')) return false
  const ua = navigator.userAgent
  // iPadOS 桌面模式 UA 伪装成 Mac，用 maxTouchPoints 兜底
  return (
    /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function WorkspaceSwitchVeil() {
  const directory = useCurrentDirectory()
  const veilRef = useRef<HTMLDivElement>(null)
  const settleTimerRef = useRef<number | undefined>(undefined)
  const isFirstRenderRef = useRef(true)
  const [enabled] = useState(isIosWebKit)

  // 直接操作 DOM 而不走 setState：盖上必须是同一帧内的瞬时变化，
  // 也避免为此多渲染一轮。
  // 必须用 useLayoutEffect：目录变化触发的大 commit 在提交后、绘制前
  // 同步盖上——useEffect 要等绘制后才跑，白闪那一帧 veil 还是透明的，
  // 根本盖不住（首版无效的原因）。
  useLayoutEffect(() => {
    if (!enabled) return
    // 首次挂载不盖（首屏有自己的加载态）
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    const veil = veilRef.current
    if (!veil) return

    // 工作区切换：立即盖上（无过渡）。连续切换时重置计时。
    veil.style.transition = 'none'
    veil.style.opacity = '1'
    // 遮盖期间拦截触摸，避免点到尚未重建完的界面
    veil.style.pointerEvents = 'auto'
    window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      veil.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`
      veil.style.opacity = '0'
      veil.style.pointerEvents = 'none'
    }, SETTLE_MS)
    return () => window.clearTimeout(settleTimerRef.current)
  }, [directory, enabled])

  if (!enabled) return null

  return (
    <div
      ref={veilRef}
      aria-hidden
      data-workspace-switch-veil="true"
      className="pointer-events-none fixed inset-0 z-[1200] bg-bg-100"
      style={{ opacity: 0 }}
    />
  )
}
