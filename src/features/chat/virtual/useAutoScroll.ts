/**
 * useAutoScroll — React 移植自 oc 的 createAutoScroll
 *
 * 核心机制：
 * - userScrolled: 用户离开底部后置 true，阻止程序拉回底部
 * - markAuto/isAuto: 程序滚动时打标记（1500ms TTL, 2px 容差点匹配），
 *   防止自己的 scrollToBottom 被误判为用户滚动；错过标记的中间帧/迟到
 *   事件由方向感知归因兜底（见下）
 * - handleScroll 可无手势门控调用：靠 isAuto 区分程序滚动
 * - ackTop（借鉴 dsh 的 ScrollFollow 归因）：记录上一次确认的滚动位置。
 *   归因判定是**方向感知**的：读者「离底」手势只会把位置往上推（滚轮上滚、
 *   触控上拖、滚动条上拖、PgUp）；向下或原地移动一律不是离底意图——程序
 *   跟随、生长动画竞帧、内容收缩钳位（min(ack, floor)）、iOS 橡皮筋过冲
 *   都属此类，贴底意图保留并几何自愈回贴，只有向上偏离确认点才解除跟随。
 * - 所有回调稳定（useCallback + useMemo），避免 ref 回调重挂载
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const AUTO_TTL = 1500
const AUTO_TOLERANCE = 2
/** 读者滚动归因容差（px）：与 dsh sample() 的 0.5 同款语义，略放宽吸收亚像素抖动 */
const READER_TOLERANCE = 1

export function useAutoScroll(bottomThreshold = 10) {
  const scrollElRef = useRef<HTMLElement | undefined>(undefined)
  const contentElRef = useRef<HTMLElement | undefined>(undefined)
  const userScrolledRef = useRef(false)
  const [userScrolled, setUserScrolled] = useState(false)
  // 上一次确认的滚动位置（程序滚动、已处理的 scroll 事件都会更新）
  const ackTopRef = useRef<number | undefined>(undefined)

  const autoMark = useRef<{ top: number; time: number } | undefined>(undefined)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const setScrolled = useCallback((v: boolean) => {
    userScrolledRef.current = v
    setUserScrolled(v)
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
    // 中间帧/迟到事件由下方的方向感知归因兜底。
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
      // 方向感知归因：与上一次确认位置对比（先按当前 floor 钳制，吸收内容
      // 收缩的被动钳位）。读者「离底」手势只会把位置**向上**推——向下/原地
      // 移动是程序跟随、生长动画竞帧或橡皮筋过冲等布局产物，贴底意图保留，
      // 几何自愈回贴；只有向上偏离确认点才解除跟随。
      const ack = ackTopRef.current
      if (ack === undefined) {
        // 首次观测：只建立基线，不做判定
        ackTopRef.current = el.scrollTop
        return
      }
      const movedUpByReader = el.scrollTop < Math.min(ack, max) - READER_TOLERANCE
      if (!movedUpByReader) {
        ackTopRef.current = el.scrollTop
        scrollToBottom(false)
        return
      }
    }
    stop()
    ackTopRef.current = el.scrollTop
  }, [bottomThreshold, isAuto, scrollToBottom, setScrolled, stop])

  const handleWheel = useCallback((e: WheelEvent) => {
    const el = scrollElRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    // 容器无溢出时忽略所有 wheel 事件——空白页 spacer 产生的小溢出不该触发折叠
    if (max <= 1) return
    if (e.deltaY >= 0) {
      // 下滚回底时恢复贴底跟随：用户主动下滚到阈值内才清 userScrolled。
      // 流式增长推回不会走这里（不是 wheel 事件）。
      if (userScrolledRef.current) {
        if (max - el.scrollTop < bottomThreshold) setScrolled(false)
      }
      return
    }
    // 上滚立刻离底。清除 auto 标记避免后续 scroll 事件被误判为程序滚动。
    autoMark.current = undefined
    const nested = (e.target instanceof Element ? e.target : undefined)?.closest('[data-scrollable]')
    if (nested && nested !== el) return
    // 直接写 ref，不等 React re-render——同帧的 RO/measure 必须立刻看到离底
    if (!userScrolledRef.current) setScrolled(true)
  }, [bottomThreshold, setScrolled])

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
    setScrollRef, setContentRef, handleScroll, handleWheel, handleInteraction,
    stop, reset, resume, markAuto, scrollToBottomCb, forceScrollToBottom, userScrolled,
  ])
}
