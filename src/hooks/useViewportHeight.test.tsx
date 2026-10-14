import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewportHeight } from './useViewportHeight'

type VisualViewportMock = EventTarget & {
  height: number
  offsetTop: number
}

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

function installVisualViewportMock({ innerHeight, viewportHeight, offsetTop = 0 }: { innerHeight: number; viewportHeight: number; offsetTop?: number }) {
  const viewport = new EventTarget() as VisualViewportMock

  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: innerHeight,
  })
  Object.defineProperty(viewport, 'height', {
    configurable: true,
    value: viewportHeight,
  })
  Object.defineProperty(viewport, 'offsetTop', {
    configurable: true,
    value: offsetTop,
  })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  })

  return viewport
}

function restoreWindowProperty(name: 'innerHeight' | 'visualViewport', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)
  } else {
    Reflect.deleteProperty(window, name)
  }
}

function mockIosDevice() {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15',
  })
}

function mockAndroidDevice() {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  })
}

describe('useViewportHeight', () => {
  beforeEach(() => {
    // 键盘会话会优先钉 screen.height——默认归零，需要可信值的用例自己 mock
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 0 })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // jsdom 移除 DOM 不一定清 activeElement，显式 blur 避免焦点泄漏到下个用例
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    document.body.replaceChildren()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    restoreWindowProperty('innerHeight', originalInnerHeight)
    restoreWindowProperty('visualViewport', originalVisualViewport)
    Reflect.deleteProperty(window.navigator, 'userAgent')
  })

  it('restores full height after an editable element blurs without a visualViewport resize', () => {
    vi.useFakeTimers()
    mockIosDevice()
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    renderHook(() => useViewportHeight())

    // 键盘弹起：进入键盘会话（放开文档滚动交给原生 reveal），高度冻结
    expect(document.documentElement.classList.contains('keyboard-session')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')

    act(() => {
      textarea.focus()
      textarea.blur()
      vi.runAllTimers()
    })

    // 键盘收起但 visualViewport 没派发 resize：焦点结算仍复位
    expect(document.documentElement.classList.contains('keyboard-session')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')
  })

  it('keeps the keyboard session while focus moves between text inputs', () => {
    vi.useFakeTimers()
    mockIosDevice()
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })
    const textarea = document.createElement('textarea')
    const input = document.createElement('input')
    document.body.append(textarea, input)

    renderHook(() => useViewportHeight())

    act(() => {
      textarea.focus()
      input.focus()
      vi.runAllTimers()
    })

    expect(document.documentElement.classList.contains('keyboard-session')).toBe(true)
  })

  it('syncs --app-height to window.innerHeight when no keyboard is open', () => {
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 800 })

    renderHook(() => useViewportHeight())

    expect(document.documentElement.classList.contains('keyboard-session')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')
  })

  it('pins --app-height to screen.height while the keyboard is open (metrics are untrustworthy during the IME)', () => {
    // iOS 键盘弹起时实测：ih=685、vv=345（少报 ~120px），只有 screen.height 可信
    mockIosDevice()
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 874 })
    installVisualViewportMock({ innerHeight: 685, viewportHeight: 345, offsetTop: 19 })

    renderHook(() => useViewportHeight())

    expect(document.documentElement.classList.contains('keyboard-session')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('874px')
  })

  it('resyncs --app-height after the keyboard closes (iOS standalone bottom-gap guard)', () => {
    mockIosDevice()
    const viewport = installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })

    renderHook(() => useViewportHeight())
    expect(document.documentElement.classList.contains('keyboard-session')).toBe(true)

    // 键盘收起，innerHeight 恢复：退出键盘会话，--app-height 重新钉回真实高度
    Object.defineProperty(viewport, 'height', { configurable: true, value: 800 })
    act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })

    expect(document.documentElement.classList.contains('keyboard-session')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')
  })

  it('never blanks #root display, even with a stuck standalone metric (regression: display-flip caused full-screen white flashes on iOS)', () => {
    vi.useFakeTimers()
    // iOS standalone 环境 + 卡住的度量（innerHeight 812 < 物理屏 874）
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 874 })
    const rootEl = document.createElement('div')
    rootEl.id = 'root'
    document.body.append(rootEl)
    const textarea = document.createElement('textarea')
    rootEl.append(textarea)

    installVisualViewportMock({ innerHeight: 812, viewportHeight: 812 })
    renderHook(() => useViewportHeight())

    act(() => {
      textarea.focus()
      textarea.blur()
      vi.runAllTimers()
    })

    // 钉高方案下卡住的 innerHeight 无害（布局钉 screen.height），
    // 任何情况下都不得对 #root 做 display 翻动（iOS 上会闪全屏白）
    expect(rootEl.style.display).toBe('')
  })

  it('pins --app-height to screen.height in standalone when the keyboard is closed', () => {
    // standalone + 漂移的坏度量（innerHeight 812，物理屏 874）
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 874 })
    installVisualViewportMock({ innerHeight: 812, viewportHeight: 812 })

    renderHook(() => useViewportHeight())

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('874px')
  })

  it('keeps --app-height pinned to screen.height during a keyboard session in standalone', () => {
    mockIosDevice()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 874 })
    installVisualViewportMock({ innerHeight: 478, viewportHeight: 478 })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()

    renderHook(() => useViewportHeight())

    // 键盘会话期间 standalone 也钉 screen.height（布局交给原生 reveal，
    // 不信任任何键盘态度量——ih/vv 在 iOS 26 上都是污染值）
    expect(document.documentElement.classList.contains('keyboard-session')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('874px')
  })

  it('never enters the keyboard session on Android - live innerHeight with resizes-content is already correct', () => {
    mockAndroidDevice()
    const viewport = installVisualViewportMock({ innerHeight: 800, viewportHeight: 800 })

    renderHook(() => useViewportHeight())

    // 键盘弹起：Android Chrome 的 resizes-content 让视口真实收缩，
    // ih/vv 同步缩小且度量准确——高度 live 跟随即可，不进键盘会话
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
    Object.defineProperty(viewport, 'height', { configurable: true, value: 500 })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    act(() => {
      textarea.focus()
      viewport.dispatchEvent(new Event('resize'))
    })

    expect(document.documentElement.classList.contains('keyboard-session')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('500px')
  })
})
