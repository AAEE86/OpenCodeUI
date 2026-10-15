/**
 * useAutoScroll — React 移植自 oc 的 createAutoScroll
 *
 * 核心机制：
 * - userScrolled: 用户离开底部后置 true，阻止程序拉回底部
 * - markAuto/isAuto: 程序滚动时打标记（1500ms TTL, 2px 容差点匹配），
 *   防止自己的 scrollToBottom 被误判为用户滚动；错过标记的中间帧/迟到
 *   事件由下方的布局守卫 + 意图感知归因兜底
 * - handleScroll 可无手势门控调用：靠 isAuto 区分程序滚动
 * - 用户滚动意图（滚动权裁决：following 只被真实用户输入改变）：
 *   wheel/touch/keyboard/自绘滚动条 pointer 在 capture 阶段同步登记意图，
 *   awayFromBottom 立即解除跟随——不等 scroll 事件，RO/commit 竞帧再也
 *   无法抢在用户手势之前把视图拽回底部。
 * - 布局守卫 + 意图感知归因（ackTop 方向归因的演进）：
 *   scrollTop 上移只分两种结局——
 *   a) 有活跃用户意图（或守卫窗口外的未分类来源，如辅助技术）→ 解除跟随；
 *   b) 无用户输入且程序滚动守卫新鲜 → 布局/程序竞帧（浏览器 clamp 先于
 *      RO 入账导致 virtual-core wasAtEnd 相对调整二次叠加、生长/折叠动画
 *      中间帧、内容收缩再回长的跨帧组合等），贴底意图保留并自愈回贴。
 *   旧实现「无输入上移即读者手势」的几何猜测是概率性失贴的根源，已废弃。
 * - 所有回调稳定（useCallback + useMemo），避免 ref 回调重挂载
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const AUTO_TTL = 1500
const AUTO_TOLERANCE = 2
/** 读者滚动归因容差（px）：与 dsh sample() 的 0.5 同款语义，略放宽吸收亚像素抖动 */
const READER_TOLERANCE = 1
/** 用户滚动意图保鲜期：覆盖 touch 惯性滚动、连续 wheel 等事件间隔 */
const USER_INTENT_TTL = 1200

/** 用户滚动意图：方向明确（away/toward）或仅知在交互（unknown，由落点裁决） */
type UserScrollIntent = 'none' | 'awayFromBottom' | 'towardBottom' | 'unknown'

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

export function useAutoScroll(bottomThreshold = 10) {
  const scrollElRef = useRef<HTMLElement | undefined>(undefined)
  const contentElRef = useRef<HTMLElement | undefined>(undefined)
  const userScrolledRef = useRef(false)
  const [userScrolled, setUserScrolled] = useState(false)
  // 上一次确认的滚动位置（程序滚动、已处理的 scroll 事件都会更新）
  const ackTopRef = useRef<number | undefined>(undefined)

  const autoMark = useRef<{ top: number; time: number } | undefined>(undefined)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── 用户滚动意图（capture 阶段同步登记） ──
  const intentRef = useRef<{ intent: UserScrollIntent; time: number }>({ intent: 'none', time: 0 })
  /** touch 拖拽中的上一次手指 Y（非 null 表示触摸进行中） */
  const touchYRef = useRef<number | null>(null)
  /** 正在拖拽自绘滚动条 thumb / 中键 autoscroll 的 pointerId */
  const scrollbarPointerRef = useRef<number | null>(null)

  const setScrolled = useCallback((v: boolean) => {
    userScrolledRef.current = v
    setUserScrolled(v)
  }, [])

  const markIntent = useCallback((intent: UserScrollIntent) => {
    if (intent === 'none') return
    intentRef.current = { intent, time: Date.now() }
  }, [])

  /** 当前活跃的用户滚动意图；交互进行中无方向记录时按 unknown（落点裁决） */
  const getActiveIntent = useCallback((): UserScrollIntent => {
    if (touchYRef.current !== null || scrollbarPointerRef.current !== null) {
      return intentRef.current.intent === 'none' ? 'unknown' : intentRef.current.intent
    }
    return Date.now() - intentRef.current.time <= USER_INTENT_TTL ? intentRef.current.intent : 'none'
  }, [])

  /**
   * 布局守卫：最近一次程序滚动是否仍在保鲜期。
   * 跟随中每次 SSE chunk / resizeItem 贴底都会刷新 mark，流式期间守卫恒新鲜；
   * 守卫新鲜时的无输入上移一律视为布局/程序竞帧。
   */
  const layoutGuardFresh = useCallback(() => {
    const a = autoMark.current
    return !!a && Date.now() - a.time <= AUTO_TTL
  }, [])

  const markAuto = useCallback((el?: HTMLElement | null) => {
    const target = el ?? scrollElRef.current
    if (!target) return
    autoMark.current = { top: target.scrollHeight - target.clientHeight, time: Date.now() }
    ackTopRef.current = target.scrollTop
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => { autoMark.current = undefined }, AUTO_TTL)
  }, [])

  const isAuto = useCallback((el: HTMLElement) => {
    const a = autoMark.current
    if (!a) return false
    if (Date.now() - a.time > AUTO_TTL) { autoMark.current = undefined; return false }
    // 点匹配（2px 容差）：不能用「起点→目标区间」的路径匹配——程序从远处
    // 跳到贴底时区间会覆盖整个可滚动范围，读者的上滚手势也会被吞掉。
    // 中间帧/迟到事件由下方的守卫 + 意图感知归因兜底。
    return Math.abs(el.scrollTop - a.top) < AUTO_TOLERANCE
  }, [])

  const scrollToBottom = useCallback((force: boolean) => {
    const el = scrollElRef.current
    if (!el) return
    if (force && userScrolledRef.current) setScrolled(false)
    if (!force && userScrolledRef.current) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    if (max - el.scrollTop < 2) {
      markAuto(el)
      return
    }
    markAuto(el)
    el.scrollTop = max
    ackTopRef.current = max
  }, [markAuto, setScrolled])

  const stop = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight <= 1) {
      if (userScrolledRef.current) setScrolled(false)
      return
    }
    if (userScrolledRef.current) return
    setScrolled(true)
  }, [setScrolled])

  const handleScroll = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 1) {
      // isAuto 守卫：程序滚动（applyScrollAdjustment 经 scrollToFn→markAuto）
      // 不清 userScrolled，只有真实用户滚动到无溢出时才清。
      if (userScrolledRef.current && !isAuto(el)) setScrolled(false)
      ackTopRef.current = el.scrollTop
      return
    }
    if (max - el.scrollTop < bottomThreshold) {
      // 用户已离底时，只有用户主动滚回底才清 userScrolled。
      // 程序滚动路径（resizeItem → queueMicrotask）受 shouldAnchorBottom 守卫，
      // 用户离底时不会产生自动回底滚动——所以 isAuto 标记的 scroll 事件到达
      // 这里只能是用户真实手势，直接清。
      if (userScrolledRef.current) setScrolled(false)
      ackTopRef.current = el.scrollTop
      return
    }
    if (!userScrolledRef.current && isAuto(el)) {
      scrollToBottom(false)
      return
    }
    if (!userScrolledRef.current) {
      // 上移裁决（following 只能被真实用户输入解除）：
      // following 只能被真实用户输入解除。向下/原地移动是程序跟随、生长动画
      // 竞帧或橡皮筋过冲等布局产物，自愈回贴；向上偏离确认点时——
      // · 有活跃意图（wheel/touch/key 方向、scrollbar/autoscroll 的 unknown）
      //   → 真实用户手势，解除跟随；
      // · 无活跃意图且布局守卫新鲜 → 程序竞帧（clamp 先于 RO 入账导致的
      //   wasAtEnd 二次叠加、内容收缩再回长的跨帧组合等），自愈回贴；
      // · 无活跃意图且守卫过期 → 未分类来源（辅助技术等），按真实用户滚动处理。
      const ack = ackTopRef.current
      if (ack === undefined) {
        // 首次观测：只建立基线，不做判定
        ackTopRef.current = el.scrollTop
        return
      }
      const movedUp = el.scrollTop < Math.min(ack, max) - READER_TOLERANCE
      if (!movedUp) {
        ackTopRef.current = el.scrollTop
        scrollToBottom(false)
        return
      }
      const intent = getActiveIntent()
      if ((intent === 'none' || intent === 'towardBottom') && layoutGuardFresh()) {
        ackTopRef.current = el.scrollTop
        scrollToBottom(false)
        return
      }
    }
    stop()
    ackTopRef.current = el.scrollTop
  }, [bottomThreshold, getActiveIntent, isAuto, layoutGuardFresh, scrollToBottom, setScrolled, stop])

  const handleWheel = useCallback((e: WheelEvent) => {
    const el = scrollElRef.current
    if (!el) return
    // 触控板捏合缩放（ctrl+wheel）不是滚动意图
    if (e.ctrlKey) return
    const max = el.scrollHeight - el.clientHeight
    // 容器无溢出时忽略所有 wheel 事件——空白页 spacer 产生的小溢出不该触发折叠
    if (max <= 1) return
    const nested = (e.target instanceof Element ? e.target : undefined)?.closest('[data-scrollable]')
    const isNested = !!nested && nested !== el
    if (e.deltaY < 0) {
      // 上滚 = 离底意图。嵌套滚动容器到达自身边缘后会把滚动链到主容器，
      // 意图照记（供后续 scroll 事件归因）；但立即解除跟随只针对直接
      // 作用于主容器的手势，嵌套消费掉的 wheel 不影响贴底。
      markIntent('awayFromBottom')
      // 清除 auto 标记避免后续 scroll 事件被误判为程序滚动。
      autoMark.current = undefined
      if (isNested) return
      // 直接写 ref，不等 React re-render——同帧的 RO/measure 必须立刻看到离底
      if (!userScrolledRef.current) setScrolled(true)
      return
    }
    if (e.deltaY > 0) {
      markIntent('towardBottom')
      // 下滚回底时恢复贴底跟随：用户主动下滚到阈值内才清 userScrolled。
      // 流式增长推回不会走这里（不是 wheel 事件）。
      if (!isNested && userScrolledRef.current && max - el.scrollTop < bottomThreshold) {
        setScrolled(false)
      }
    }
  }, [bottomThreshold, markIntent, setScrolled])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchYRef.current = e.touches[0]?.clientY ?? null
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const el = scrollElRef.current
    const y = e.touches[0]?.clientY
    const prev = touchYRef.current
    if (y === undefined) return
    touchYRef.current = y
    if (!el || prev === null) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 1) return
    // 手指位移与 scrollTop 反向：手指下移 = 读更早内容（scrollTop 减小）
    if (y > prev) {
      markIntent('awayFromBottom')
      autoMark.current = undefined
      const nested = (e.target instanceof Element ? e.target : undefined)?.closest('[data-scrollable]')
      if (nested && nested !== el) return
      if (!userScrolledRef.current) setScrolled(true)
    } else if (y < prev) {
      markIntent('towardBottom')
      if (userScrolledRef.current && max - el.scrollTop < bottomThreshold) setScrolled(false)
    }
  }, [bottomThreshold, markIntent, setScrolled])

  const handleTouchEnd = useCallback(() => {
    touchYRef.current = null
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const el = scrollElRef.current
    if (!el) return
    if (isEditableTarget(e.target)) return
    let intent: UserScrollIntent = 'none'
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') intent = 'awayFromBottom'
    else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'End') intent = 'towardBottom'
    else if (e.key === ' ') intent = e.shiftKey ? 'awayFromBottom' : 'towardBottom'
    if (intent === 'none') return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 1) return
    markIntent(intent)
    if (intent === 'awayFromBottom') {
      autoMark.current = undefined
      if (!userScrolledRef.current) setScrolled(true)
    }
  }, [markIntent, setScrolled])

  /**
   * 绑定在滚动容器的**父元素**上（capture 阶段）：
   * - 自绘滚动条 thumb 挂在容器父元素上且 pointerdown stopPropagation，
   *   容器自身永远收不到该事件；拖拽期间按 unknown 意图记账，由 scroll 落点裁决；
   * - 中键 autoscroll（button=1）滚动期间没有持续输入事件，同样按 unknown 记账；
   * - 原生滚动条（target === 容器自身）兜底。
   */
  const handlePointerDown = useCallback((e: PointerEvent) => {
    const el = scrollElRef.current
    if (!el) return
    const t = e.target instanceof Element ? e.target : undefined
    const isThumb =
      !!t && t.classList.contains('os-thumb') && !t.classList.contains('os-thumb-x') &&
      // thumb 属于本容器（挂在容器父元素下）
      !!el.parentElement && el.parentElement.contains(t)
    const isMiddleAutoScroll = e.button === 1 && !!t && (t === el || el.contains(t))
    const isNativeScrollbar = t === el
    if (!isThumb && !isMiddleAutoScroll && !isNativeScrollbar) return
    scrollbarPointerRef.current = e.pointerId
    markIntent('unknown')
  }, [markIntent])

  const handlePointerEnd = useCallback((e: PointerEvent) => {
    if (scrollbarPointerRef.current === e.pointerId) scrollbarPointerRef.current = null
  }, [])

  const handleInteraction = useCallback(() => {
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) stop()
  }, [stop])

  const setScrollRef = useCallback((el: HTMLElement | null) => {
    scrollElRef.current = el ?? undefined
    if (el) el.style.overflowAnchor = 'none'
  }, [])

  const setContentRef = useCallback((el: HTMLElement | null) => {
    contentElRef.current = el ?? undefined
  }, [])

  // 不使用 contentRef ResizeObserver：
  // measureElement 内置 RO → resizeItem → applyScrollAdjustment 已经处理了贴底。
  // contentRef RO 会在 item 首次测量时触发（container height 变化），
  // 把 scrollTop 拉回底部，覆盖 applyScrollAdjustment 的正确行为。

  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current) }, [])

  const reset = useCallback(() => {
    setScrolled(false)
  }, [setScrolled])

  const resume = useCallback(() => {
    setScrolled(false)
    scrollToBottom(true)
  }, [scrollToBottom, setScrolled])
  const scrollToBottomCb = useCallback(() => scrollToBottom(false), [scrollToBottom])
  const forceScrollToBottom = useCallback(() => scrollToBottom(true), [scrollToBottom])

  return useMemo(() => ({
    setScrollRef,
    setContentRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleKeyDown,
    handlePointerDown,
    handlePointerEnd,
    handleInteraction,
    pause: stop,
    reset,
    resume,
    markAuto,
    scrollToBottom: scrollToBottomCb,
    forceScrollToBottom,
    userScrolledRef,
    userScrolled,
  }), [
    setScrollRef, setContentRef, handleScroll, handleWheel,
    handleTouchStart, handleTouchMove, handleTouchEnd, handleKeyDown,
    handlePointerDown, handlePointerEnd, handleInteraction,
    stop, reset, resume, markAuto, scrollToBottomCb, forceScrollToBottom, userScrolled,
  ])
}
