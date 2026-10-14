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

    // iOS standalone（添加到主屏幕）判定：两种 API 都查，Tauri 排除在外
    const isStandalone =
      !isTauriApp &&
      (window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true)

    // 把 --app-height 钉到可信高度（px），实时跟随。
    //
    // 真机数据（iPhone 16 Pro / iOS 26 standalone）最终结论：
    // - standalone 的窗口**永远全屏**，坏的是 WebKit 上报的视口度量——
    //   innerHeight 在不同启动间随机漂移（实测 874/834/812，sh 恒为 874，
    //   WebKit 有 bug 记录它缓存键盘态的错误度量），且与是否弹过键盘无关；
    // - 空隙区域渲染的是网页自己的背景色 → 该区域 webview **画得出来**，
    //   只是布局被错误度量限制了；
    // - 因此 standalone 且键盘未弹（无输入焦点）时，外壳高度直接钉
    //   screen.height（唯一恒定可信的值）；键盘弹起时 webview 真实收缩
    //   （实测 ih 874→478），钉 innerHeight 自然贴键盘。
    // - 浏览器模式（非 standalone）有工具栏，innerHeight 才是真实可视高，
    //   且 ki>0 时冻结高度、由 keyboard-inset padding 让位（避免双重收缩）。
    let keyboardOpen = false
    const isKeyboardActive = () => keyboardOpen || hasKeyboardFocus()
    const syncAppHeight = () => {
      if (keyboardOpen) return
      const useScreenHeight = isStandalone && !isKeyboardActive() && window.screen.height > 0
      const height = useScreenHeight ? window.screen.height : window.innerHeight
      root.style.setProperty('--app-height', `${Math.round(height)}px`)
    }

    // iOS standalone PWA 键盘 bug（WebKit：键盘弹出后 innerHeight /
    // visualViewport.height 全部缩水且**不回弹**，实测卡在 sh-62，缺口
    // 约等于键盘工具条高度），表现为底部永久黑带。此时 innerHeight 本身
    // 是坏的，单纯同步高度没用。
    // 已验证的恢复手段：对一个**全视口高度**的元素做一次
    // display:none → 恢复 + 同步 reflow，强制 WebKit 重新测量视口。
    // 参考：https://dev.to/cederhook/fixing-the-ios-standalone-pwa-keyboard-bug-that-shrinks-your-viewport-for-good-63d
    let maxInnerHeight = window.innerHeight
    let lastSeenInnerHeight = window.innerHeight
    let lastHealAt = 0
    let healAttempts = 0
    const HEAL_COOLDOWN_MS = 400
    const HEAL_ATTEMPT_MAX = 8

    const healStuckStandaloneViewport = () => {
      if (!isStandalone) return
      // 键盘还在弹（有输入焦点）时绝不翻动
      if (hasKeyboardFocus()) return
      // 只在确实卡住时翻动（innerHeight 小于物理屏高）
      if (window.screen.height - window.innerHeight <= 4) return
      // 冷却 + 次数上限：翻动会引发 resize 事件，无效时不能无限翻
      const now = Date.now()
      if (now - lastHealAt < HEAL_COOLDOWN_MS || healAttempts >= HEAL_ATTEMPT_MAX) return
      lastHealAt = now
      healAttempts += 1

      const el = document.getElementById('root')
      if (!el) return

      // display 翻动会重建布局盒，保存/恢复聊天滚动位置避免跳顶
      const scroller = el.querySelector<HTMLElement>('[data-chat-scroll-root="true"]')
      const scrollTop = scroller?.scrollTop ?? 0
      el.style.display = 'none'
      void el.offsetHeight // 同步 reflow：两次布局之间无绘制
      el.style.display = ''
      if (scroller) scroller.scrollTop = scrollTop
      // 视口恢复后重新钉高度
      maxInnerHeight = Math.max(maxInnerHeight, window.innerHeight)
      syncAppHeight()
    }

    const hasKeyboardFocus = () => isKeyboardEditableElement(document.activeElement)

    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport) return
      // innerHeight 有变化（恢复或新的收缩）→ 重置 heal 次数，允许新一轮尝试
      if (window.innerHeight !== lastSeenInnerHeight) {
        lastSeenInnerHeight = window.innerHeight
        healAttempts = 0
      }
      const rawInset = window.innerHeight - viewport.height - viewport.offsetTop
      // 减掉 safe-area phantom，再用阈值区分键盘与 iOS Safari 底部工具栏。
      // 真实软键盘通常远高于 100px，工具栏/phantom 误差一般低于这个值。
      const candidateInset = rawInset - safeAreaBottomPx
      const keyboardInset = candidateInset >= KEYBOARD_INSET_THRESHOLD ? candidateInset : 0
      keyboardOpen = keyboardInset > 0
      setKeyboardInset(keyboardInset)
      // 自动修复：键盘没弹（heal 内部还会查输入焦点）而视口卡住时，
      // 任何视口事件都顺手尝试一次；不依赖 focusout/键盘转换等特定路径
      // （滑动收起键盘不触发 focusout，且本设备 ki 恒为 0 无转换可探测）
      if (!keyboardOpen) {
        healStuckStandaloneViewport()
      }
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
            // 键盘已收起：standalone 卡住的视口在这里强制重测恢复
            healStuckStandaloneViewport()
            syncAppHeight()
          }
        }, delay),
      )
    }

    // 旋转设备 / 窗口 resize 时 safe-area 可能变化，重测一次。
    const handleWindowResize = () => {
      if (!keyboardOpen) {
        maxInnerHeight = Math.max(maxInnerHeight, window.innerHeight)
      }
      measureSafeAreaBottom()
      updateViewport()
    }

    // 兜底心跳：滑动收键盘等零事件场景下也能自愈（heal 自带焦点/冷却/次数守卫）
    const healHeartbeat = isStandalone
      ? window.setInterval(() => {
          if (!keyboardOpen) healStuckStandaloneViewport()
        }, 2000)
      : null

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
      if (healHeartbeat !== null) window.clearInterval(healHeartbeat)
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
