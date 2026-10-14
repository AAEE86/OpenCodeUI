import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoScroll } from './useAutoScroll'

/**
 * jsdom 没有布局，用可写的 mock 滚动元素模拟：
 * scrollHeight/clientHeight/scrollTop 手动驱动。
 */
function makeScroller(clientHeight = 500) {
  let scrollTop = 0
  let scrollHeight = clientHeight
  const el = {
    style: {},
    get scrollTop() {
      return scrollTop
    },
    set scrollTop(v: number) {
      scrollTop = Math.max(0, Math.min(v, scrollHeight - clientHeight))
    },
    get scrollHeight() {
      return scrollHeight
    },
    get clientHeight() {
      return clientHeight
    },
  } as unknown as HTMLElement
  return {
    el,
    grow(by: number) {
      scrollHeight += by
    },
    shrink(by: number) {
      scrollHeight = Math.max(clientHeight, scrollHeight - by)
      // 浏览器行为：收缩后 scrollTop 被钳到新 floor
      scrollTop = Math.min(scrollTop, scrollHeight - clientHeight)
    },
    scrollTo(top: number) {
      scrollTop = Math.max(0, Math.min(top, scrollHeight - clientHeight))
    },
    get top() {
      return scrollTop
    },
    get floor() {
      return scrollHeight - clientHeight
    },
  }
}

function setup() {
  const { result } = renderHook(() => useAutoScroll(10))
  const scroller = makeScroller()
  act(() => {
    result.current.setScrollRef(scroller.el)
  })
  return { auto: result, scroller }
}

describe('useAutoScroll 贴底跟随归因', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('流式增长中错过 auto 标记的 scroll 事件不再永久失贴（几何自愈）', () => {
    vi.useFakeTimers()
    try {
      const { auto, scroller } = setup()
      scroller.grow(1000)
      // 程序贴底并标记
      act(() => {
        auto.current.scrollToBottom()
      })
      expect(scroller.top).toBe(scroller.floor)

      // 高 TPS 极端情形：auto 标记 TTL 过期（1.5s 内没有新的程序滚动刷新它），
      // 同时内容又长了 50px——scroll 事件到达时 isAuto 失配
      act(() => {
        vi.advanceTimersByTime(1600)
        scroller.grow(50)
        auto.current.handleScroll()
      })
      // 归因判定：位置没有偏离确认点（不是读者手势）→ 贴底意图保留并自愈回贴
      expect(auto.current.userScrolled).toBe(false)
      expect(scroller.top).toBe(scroller.floor)
    } finally {
      vi.useRealTimers()
    }
  })

  it('内容收缩钳位不算读者离底', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    // 流式中 thinking 折叠/图片替换导致内容收缩 300px：浏览器把 scrollTop 钳到新 floor
    act(() => {
      scroller.shrink(300)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(false)
  })

  it('真实读者手势（位置偏离确认点）仍然解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    // 滚动条拖拽 / 键盘 PgUp：没有 wheel 事件，scrollTop 明显偏离
    act(() => {
      scroller.scrollTo(scroller.floor - 300)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(true)
  })

  it('读者滚回底部阈值内恢复跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    act(() => {
      scroller.scrollTo(scroller.floor - 300)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(true)
    act(() => {
      scroller.scrollTo(scroller.floor)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(false)
  })
})
