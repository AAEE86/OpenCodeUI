import { afterEach, describe, expect, it, vi } from 'vitest'
import { supportsViewTransition, withViewTransition } from './viewTransition'

const originalStartViewTransition = Object.getOwnPropertyDescriptor(Document.prototype, 'startViewTransition')

function mockStartViewTransition(impl?: (update: () => void) => void) {
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn((update: () => void) => {
      impl?.(update)
      return { finished: Promise.resolve() }
    }),
  })
}

function removeStartViewTransition() {
  Reflect.deleteProperty(document, 'startViewTransition')
}

describe('viewTransition', () => {
  afterEach(() => {
    if (originalStartViewTransition) {
      Object.defineProperty(Document.prototype, 'startViewTransition', originalStartViewTransition)
    } else {
      removeStartViewTransition()
    }
  })

  it('浏览器不支持时同步直跑更新', () => {
    removeStartViewTransition()
    expect(supportsViewTransition()).toBe(false)

    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('支持时通过 startViewTransition 执行，且回调内同步完成 DOM 更新', () => {
    mockStartViewTransition(update => {
      // 捕获回调执行时 DOM 已是更新后的状态（flushSync 生效）
      update()
      expect(document.body.dataset.vtTest).toBe('updated')
    })

    expect(supportsViewTransition()).toBe(true)

    withViewTransition(() => {
      document.body.dataset.vtTest = 'updated'
    })

    expect(document.startViewTransition).toHaveBeenCalledTimes(1)
    expect(document.body.dataset.vtTest).toBe('updated')
    delete document.body.dataset.vtTest
  })

  it('prefers-reduced-motion 时跳过动画直接更新', () => {
    mockStartViewTransition()
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia

    const update = vi.fn()
    withViewTransition(update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(document.startViewTransition).not.toHaveBeenCalled()

    window.matchMedia = originalMatchMedia
  })
})
