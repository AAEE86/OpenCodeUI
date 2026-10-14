import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('useViewportHeight', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    restoreWindowProperty('innerHeight', originalInnerHeight)
    restoreWindowProperty('visualViewport', originalVisualViewport)
  })

  it('clears stale keyboard inset after an editable element blurs without a visualViewport resize', () => {
    vi.useFakeTimers()
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    renderHook(() => useViewportHeight())

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('300px')

    act(() => {
      textarea.focus()
      textarea.blur()
      vi.runAllTimers()
    })

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('0px')
  })

  it('keeps the keyboard inset when focus moves between text inputs', () => {
    vi.useFakeTimers()
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

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('300px')
  })

  it('syncs --app-height to window.innerHeight when no keyboard is open', () => {
    installVisualViewportMock({ innerHeight: 800, viewportHeight: 800 })

    renderHook(() => useViewportHeight())

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')
  })

  it('does not shrink --app-height while the keyboard is open', () => {
    const viewport = installVisualViewportMock({ innerHeight: 800, viewportHeight: 800 })

    renderHook(() => useViewportHeight())
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')

    // 键盘弹起：visualViewport 缩小，--app-height 保持不变（由 keyboard-inset 让位，避免双重收缩）
    Object.defineProperty(viewport, 'height', { configurable: true, value: 500 })
    act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('300px')
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')
  })

  it('resyncs --app-height after the keyboard closes (iOS standalone bottom-gap guard)', () => {
    const viewport = installVisualViewportMock({ innerHeight: 800, viewportHeight: 500 })

    renderHook(() => useViewportHeight())

    // 键盘收起，innerHeight 恢复：--app-height 重新钉回真实高度
    Object.defineProperty(viewport, 'height', { configurable: true, value: 800 })
    act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset-bottom')).toBe('0px')
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

  it('follows innerHeight instead of screen.height while the keyboard has focus in standalone', () => {
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

    // 键盘弹起（webview 真实收缩）：钉 innerHeight，不是 screen.height
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('478px')
  })
})
