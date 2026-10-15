import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoScroll } from './useAutoScroll'

/**
 * jsdom 没有布局，用真实 DOM 元素 + 覆写几何属性模拟滚动容器：
 * scrollHeight/clientHeight/scrollTop 手动驱动。
 */
function makeScroller(clientHeight = 500) {
  const el = document.createElement('div')
  let scrollTop = 0
  let scrollHeight = clientHeight
  Object.defineProperties(el, {
    scrollTop: {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = Math.max(0, Math.min(v, scrollHeight - clientHeight))
      },
    },
    scrollHeight: { get: () => scrollHeight },
    clientHeight: { get: () => clientHeight },
  })
  const wrapper = document.createElement('div')
  wrapper.appendChild(el)
  return {
    el,
    wrapper,
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
    /** 绕过钳位直接写位置（模拟 iOS 橡皮筋过冲等瞬时越界状态） */
    forceTop(v: number) {
      scrollTop = v
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

/** 自绘滚动条 thumb 的 pointerdown（capture 阶段登记 unknown 意图） */
function makeThumb(scroller: ReturnType<typeof makeScroller>) {
  const thumb = document.createElement('div')
  thumb.classList.add('os-thumb')
  scroller.wrapper.appendChild(thumb)
  return thumb
}

function pointerDownOn(thumb: HTMLElement, pointerId = 1) {
  return { target: thumb, pointerId, button: 0 } as unknown as PointerEvent
}

function wheelUp(target: EventTarget | null = null) {
  return { deltaY: -100, deltaMode: 0, ctrlKey: false, target } as unknown as WheelEvent
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

  it('无输入的「收缩→回长」跨帧竞帧：贴底意图保留并自愈（概率性失贴根因修复）', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    // 过程壳折叠（收缩 300，clamp 到 700）与下一段流式回长（+400）落在同一
    // 渲染窗口：scroll 事件到达时 scrollTop 既不在底部、也偏离确认点、还对不上
    // 任何 auto 标记——旧几何归因会误判为读者离底，永久失贴。
    act(() => {
      scroller.shrink(300)
      scroller.grow(400)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(false)
    // 自愈：重新贴回底部
    expect(scroller.top).toBe(scroller.floor)
  })

  it('无输入且布局守卫过期的未分类上移仍解除跟随（辅助技术兼容）', () => {
    vi.useFakeTimers()
    try {
      const { auto, scroller } = setup()
      scroller.grow(1000)
      act(() => {
        auto.current.scrollToBottom()
      })
      act(() => {
        vi.advanceTimersByTime(1600)
        scroller.shrink(300)
        scroller.grow(400)
        auto.current.handleScroll()
      })
      expect(auto.current.userScrolled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('真实读者手势（自绘滚动条拖拽上移）解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    // thumb pointerdown 登记 unknown 意图（挂在容器父元素上，容器收不到该事件）
    const thumb = makeThumb(scroller)
    act(() => {
      auto.current.handlePointerDown(pointerDownOn(thumb))
      scroller.scrollTo(scroller.floor - 300)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(true)
    act(() => {
      auto.current.handlePointerEnd({ pointerId: 1 } as PointerEvent)
    })
  })

  it('读者滚回底部阈值内恢复跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    const thumb = makeThumb(scroller)
    act(() => {
      auto.current.handlePointerDown(pointerDownOn(thumb))
      scroller.scrollTo(scroller.floor - 300)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(true)
    act(() => {
      scroller.scrollTo(scroller.floor)
      auto.current.handleScroll()
      auto.current.handlePointerEnd({ pointerId: 1 } as PointerEvent)
    })
    expect(auto.current.userScrolled).toBe(false)
  })

  it('wheel 上滚立即解除跟随（不等 scroll 事件）', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    act(() => {
      auto.current.handleWheel(wheelUp())
    })
    expect(auto.current.userScrolled).toBe(true)
  })

  it('wheel 上滚发生在嵌套滚动容器内：不立即解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    const nested = document.createElement('div')
    nested.setAttribute('data-scrollable', '')
    const inner = document.createElement('div')
    nested.appendChild(inner)
    act(() => {
      auto.current.handleWheel(wheelUp(inner))
    })
    // 嵌套消费掉的 wheel 不影响主容器贴底
    expect(auto.current.userScrolled).toBe(false)
  })

  it('触控板捏合缩放（ctrl+wheel）不影响贴底', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    act(() => {
      auto.current.handleWheel({
        deltaY: -100,
        deltaMode: 0,
        ctrlKey: true,
        target: null,
      } as unknown as WheelEvent)
    })
    expect(auto.current.userScrolled).toBe(false)
  })

  it('键盘 PageUp 解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    act(() => {
      auto.current.handleKeyDown({ key: 'PageUp', target: null, shiftKey: false } as unknown as KeyboardEvent)
    })
    expect(auto.current.userScrolled).toBe(true)
  })

  it('触摸上拖（手指下移）解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    act(() => {
      auto.current.handleTouchStart({ touches: [{ clientY: 500 }] } as unknown as TouchEvent)
      auto.current.handleTouchMove({ touches: [{ clientY: 520 }], target: null } as unknown as TouchEvent)
    })
    expect(auto.current.userScrolled).toBe(true)
    act(() => {
      auto.current.handleTouchEnd()
    })
  })

  it('生长动画竞帧：程序跟随的中间帧位置不解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    // 内容突然蹦出一大片 + 高度生长动画：floor 从 1000 涨到 1080，
    // 程序发起跟随滚动（scrollToFn 顺序：先 markAuto 后写 scrollTop）
    act(() => {
      scroller.grow(80)
      auto.current.markAuto(scroller.el)
    })
    // 某一帧没跟上：scroll 事件到达时位置还在中间帧（1040），
    // 既不等于标记目标（1080），也偏离了确认点（1000）——但不是读者手势
    act(() => {
      scroller.scrollTo(1040)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(false)
    // 几何自愈：重新贴回底部
    expect(scroller.top).toBe(scroller.floor)
  })

  it('底部橡胶弹跳/过冲（scrollTop 瞬时超过 floor）不解除跟随', () => {
    const { auto, scroller } = setup()
    scroller.grow(1000)
    act(() => {
      auto.current.scrollToBottom()
    })
    // iOS 橡皮筋：scrollTop 瞬时冲过 max（mock 的 forceTop 绕过钳位模拟）
    act(() => {
      scroller.forceTop(scroller.floor + 40)
      auto.current.handleScroll()
    })
    expect(auto.current.userScrolled).toBe(false)
  })
})
