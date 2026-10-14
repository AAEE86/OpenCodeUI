import { useEffect } from 'react'

const KEYBOARD_INSET_THRESHOLD = 100
const KEYBOARD_SETTLE_DELAYS_MS = [0, 80, 180, 360, 700]

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

function isKeyboardEditableElement(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && !NON_TEXT_INPUT_TYPES.has(element.type)
  }
  // 注意必须返回严格 boolean：jsdom/部分浏览器 isContentEditable 可能是
  // undefined，而 classList.toggle(name, undefined) 是"切换"而非"移除"
  return element instanceof HTMLElement && element.isContentEditable === true
}

/**
 * 跟踪视口高度，处理移动端键盘弹出时的布局适配。
 *
 * - Tauri Android: 原生 setPadding 让 WebView 自动 resize，直接用 window.innerHeight
 * - Browser/PWA: 通过 visualViewport 计算键盘遮挡区域
 */
export function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement
    const isTauriApp = root.classList.contains('tauri-app')

    if (isTauriApp) {
      // Tauri: 原生层已处理键盘 resize，只需跟踪 innerHeight
      const updateAppHeight = () => {
        root.style.setProperty('--app-height', `${window.innerHeight}px`)
      }
      updateAppHeight()
      window.addEventListener('resize', updateAppHeight)
      return () => window.removeEventListener('resize', updateAppHeight)
    }
    // Browser/PWA: 用 visualViewport 检测键盘。
    //
    // 陷阱：iOS PWA standalone 下 window.innerHeight 包含 home indicator 区域，
    // 而 visualViewport.height 不包含。没键盘时两者差值 ≈ safe-area-inset-bottom（~34px），
    // 会被误判为“键盘弹出”。需减掉这部分才是真实键盘高度。
    // 不减的后果：#root 多出 34px padding-bottom + InputBox 自身又读一次
    // var(--safe-area-inset-bottom) → 双倍 safe-area 间距。
    //
    // env(safe-area-inset-bottom) 在 CSS 自定义属性里不会被 getComputedStyle 解析为像素，
    // 用临时 probe 元素把它赋给实际 padding 属性才能获得解析后的 px 值。
    let safeAreaBottomPx = 0
    let keyboardSettleTimers: number[] = []
    const measureSafeAreaBottom = () => {
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:fixed;left:-9999px;top:0;width:0;height:0;' +
        'padding-bottom:env(safe-area-inset-bottom,0px);' +
        'visibility:hidden;pointer-events:none'
      document.body.appendChild(probe)
      safeAreaBottomPx = parseFloat(getComputedStyle(probe).paddingBottom) || 0
      document.body.removeChild(probe)
    }
    measureSafeAreaBottom()

    const clearKeyboardSettleTimers = () => {
      keyboardSettleTimers.forEach(timer => window.clearTimeout(timer))
      keyboardSettleTimers = []
    }

    // iOS standalone（添加到主屏幕）判定：两种 API 都查，Tauri 排除在外
    const isStandalone =
      !isTauriApp &&
      (window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true)

    // iOS 判定（含 iPadOS 桌面 UA）。键盘会话/原生 reveal 方案只对 iOS 启用：
    // Android Chrome 的 interactive-widget=resizes-content 会真实收缩视口且
    // 度量准确，live innerHeight 就是正确行为——钉 screen.height + 放开滚动
    // 反而会和浏览器自己的收缩打架（实测安卓跳动退步）。
    const isIos =
      /iPad|iPhone|iPod/i.test(window.navigator.userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)

    // 把 --app-height 钉到可信高度（px），实时跟随。
    //
    // 真机数据（iPhone 16 Pro / iOS 26）最终结论：
    // - standalone 的窗口**永远全屏**，坏的是 WebKit 上报的视口度量——
    //   innerHeight 在不同启动间随机漂移（实测 874/834/812，sh 恒为 874，
    //   WebKit 有 bug 记录它缓存键盘态的错误度量），且与是否弹过键盘无关；
    // - 键盘弹起时所有度量都不可信：实测 ih=685 / vv.height=345（少报
    //   ~120px，把附件条/浏览器底栏都算进去了），而真实可见底边在 ~469。
    //   任何用这些度量推导输入框位置的方案都会把输入框顶飞。
    // - 因此键盘会话期间改用**原生 reveal**：--app-height 钉 screen.height
    //   （唯一恒定可信的常量），同时给根元素加 keyboard-session 类放开
    //   文档滚动——iOS 会像对待设置弹窗里的输入框一样，把聚焦的输入框
    //   scroll-into-view 到键盘上方，全程不需要知道键盘具体多高。
    // - 键盘收起、无焦点：standalone 钉 screen.height，浏览器钉 innerHeight。
    // - 非 iOS 不进入键盘会话：高度 live 跟随，浏览器原生 resize 行为已正确。
    let keyboardOpen = false
    const hasKeyboardFocus = () => isKeyboardEditableElement(document.activeElement)

    const syncLayoutMode = () => {
      const session = isIos && (keyboardOpen || hasKeyboardFocus())
      root.classList.toggle('keyboard-session', session)
      if (!session) {
        // 会话结束：文档可能被原生 reveal 滚动过，先复位再钉回常规高度
        try {
          window.scrollTo(0, 0)
        } catch {
          // jsdom 等无滚动实现的环境
        }
      }
      const useScreenHeight = (isStandalone || session) && window.screen.height > 0
      const height = useScreenHeight ? window.screen.height : window.innerHeight
      root.style.setProperty('--app-height', `${Math.round(height)}px`)
    }

    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport) return
      const rawInset = window.innerHeight - viewport.height - viewport.offsetTop
      // 减掉 safe-area phantom，再用阈值区分键盘与 iOS Safari 底部工具栏。
      // 真实软键盘通常远高于 100px，工具栏/phantom 误差一般低于这个值。
      // inset 只用于判定键盘是否弹起，不参与布局。
      keyboardOpen = rawInset - safeAreaBottomPx >= KEYBOARD_INSET_THRESHOLD
      syncLayoutMode()
    }

    const syncAfterFocusSettles = () => {
      clearKeyboardSettleTimers()
      keyboardSettleTimers = KEYBOARD_SETTLE_DELAYS_MS.map(delay =>
        window.setTimeout(() => {
          if (hasKeyboardFocus()) {
            updateViewport()
          } else {
            // iOS PWA 有时在键盘收起后不派发 visualViewport.resize，必须主动复位状态。
            keyboardOpen = false
            syncLayoutMode()
          }
        }, delay),
      )
    }

    // 旋转设备 / 窗口 resize 时 safe-area 可能变化，重测一次。
    const handleWindowResize = () => {
      measureSafeAreaBottom()
      updateViewport()
    }

    updateViewport()
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewport)
      window.visualViewport.addEventListener('scroll', updateViewport)
    }
    window.addEventListener('resize', handleWindowResize)
    window.addEventListener('pageshow', syncAfterFocusSettles)
    document.addEventListener('focusin', syncAfterFocusSettles)
    document.addEventListener('focusout', syncAfterFocusSettles)
    document.addEventListener('visibilitychange', syncAfterFocusSettles)
    return () => {
      clearKeyboardSettleTimers()
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewport)
        window.visualViewport.removeEventListener('scroll', updateViewport)
      }
      window.removeEventListener('resize', handleWindowResize)
      window.removeEventListener('pageshow', syncAfterFocusSettles)
      document.removeEventListener('focusin', syncAfterFocusSettles)
      document.removeEventListener('focusout', syncAfterFocusSettles)
      document.removeEventListener('visibilitychange', syncAfterFocusSettles)
    }
  }, [])
}
