/**
 * childSessionStore 契约测试
 *
 * 核心回归：`subscribe` 必须是绑定过的（箭头属性）——
 * useSyncExternalStore(childSessionStore.subscribe, ...) 以未绑定方式调用，
 * 原型方法会丢 this，渲染期 TypeError 直接白屏（v0.7.13 GitHub Pages 事故）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { childSessionStore } from './childSessionStore'

vi.mock('./serverStore', () => ({
  serverStore: { getActiveServerId: () => 'local' },
}))

beforeEach(() => {
  childSessionStore.clearAll()
})

describe('subscribe 未绑定调用', () => {
  it('解构出的 subscribe / getVersion 不需要 this 也能工作', () => {
    const { subscribe, getVersion } = childSessionStore
    const seen: number[] = []
    const unsubscribe = subscribe(() => seen.push(getVersion()))

    childSessionStore.bindToolPart('local', 'call_1', 'local::ses_child')

    expect(seen.length).toBeGreaterThan(0)
    unsubscribe()
    seen.length = 0
    childSessionStore.bindToolPart('local', 'call_2', 'local::ses_child2')
    expect(seen).toEqual([])
  })
})

describe('工具卡片 ↔ 子 session 绑定', () => {
  it('bind / 查询 / 重绑（子 session 换绑时旧卡片解绑）', () => {
    childSessionStore.bindToolPart('local', 'call_a', 'local::ses_1')
    expect(childSessionStore.getBoundChildForToolPart('local', 'call_a')).toBe('local::ses_1')
    expect(childSessionStore.getBoundToolPartForChild('local::ses_1')).toBe('local:call_a')

    // 同一子 session 绑到另一张卡片：旧卡片解绑
    childSessionStore.bindToolPart('local', 'call_b', 'local::ses_1')
    expect(childSessionStore.getBoundChildForToolPart('local', 'call_a')).toBeUndefined()
    expect(childSessionStore.getBoundChildForToolPart('local', 'call_b')).toBe('local::ses_1')
  })

  it('clearAll 清空绑定', () => {
    childSessionStore.bindToolPart('local', 'call_a', 'local::ses_1')
    childSessionStore.clearAll()
    expect(childSessionStore.getBoundChildForToolPart('local', 'call_a')).toBeUndefined()
  })
})
