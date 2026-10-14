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
  return element instanceof HTMLElement && element.isContentEditable
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

    const setKeyboardInset = (keyboardInset: number) => {
      root.style.setProperty('--keyboard-inset-bottom', `${Math.round(keyboardInset)}px`)
    }

    // 把 --app-height 钉到真实的 window.innerHeight（px）。
    //
    // 为什么浏览器/PWA 不能只靠 CSS 100dvh：
    // iOS standalone（添加到主屏幕）下 WebKit 的视口高度计算有已知缺陷——
    // 软键盘弹收后 webview 高度偶尔不回弹、dvh 在 standalone 下也可能少算，
    // 表现为页面底部留出一条永久空隙（Android Chrome 无此问题）。
    // innerHeight 始终反映当前真实可用高度，键盘弹起时**不同步**
    // （此时 #root 高度不变、由 keyboard-inset padding 让位，避免双重收缩）。
    let keyboardOpen = false
    const syncAppHeight = () => {
      if (keyboardOpen) return
      root.style.setProperty('--app-height', `${window.innerHeight}px`)
    }

    const hasKeyboardFocus = () => isKeyboardEditableElement(document.activeElement)

    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport) return
      const rawInset = window.innerHeight - viewport.height - viewport.offsetTop
      // 减掉 safe-area phantom，再用阈值区分键盘与 iOS Safari 底部工具栏。
      // 真实软键盘通常远高于 100px，工具栏/phantom 误差一般低于这个值。
      const candidateInset = rawInset - safeAreaBottomPx
      const keyboardInset = candidateInset >= KEYBOARD_INSET_THRESHOLD ? candidateInset : 0
      keyboardOpen = keyboardInset > 0
      setKeyboardInset(keyboardInset)
      syncAppHeight()
    }

    const syncAfterFocusSettles = () => {
      clearKeyboardSettleTimers()
      keyboardSettleTimers = KEYBOARD_SETTLE_DELAYS_MS.map(delay =>
        window.setTimeout(() => {
          if (hasKeyboardFocus()) {
            updateViewport()
          } else {
            // iOS PWA 有时在键盘收起后不派发 visualViewport.resize，必须主动清掉旧 inset。
            keyboardOpen = false
            setKeyboardInset(0)
            syncAppHeight()
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
