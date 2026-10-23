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

describe('子会话「已确认」标记', () => {
  it('标记之后不再重复问服务端', () => {
    expect(childSessionStore.hasScannedChildren('local::ses_parent')).toBe(false)
    childSessionStore.markChildrenScanned('local::ses_parent')
    expect(childSessionStore.hasScannedChildren('local::ses_parent')).toBe(true)
  })

  it('removeSession 丢掉标记（会话没了，下次重建要重新确认）', () => {
    childSessionStore.markChildrenScanned('local::ses_parent')
    childSessionStore.removeSession('local::ses_parent')
    expect(childSessionStore.hasScannedChildren('local::ses_parent')).toBe(false)
  })

  it('clearChildren 丢掉标记（子会话记录被清空需要重新问）', () => {
    childSessionStore.markChildrenScanned('local::ses_parent')
    childSessionStore.clearChildren('local::ses_parent')
    expect(childSessionStore.hasScannedChildren('local::ses_parent')).toBe(false)
  })

  it('resetChildrenScans 只清标记（重连补拉断连期间新建的子会话）', () => {
    childSessionStore.markChildrenScanned('local::ses_a')
    childSessionStore.markChildrenScanned('local::ses_b')
    childSessionStore.resetChildrenScans()
    expect(childSessionStore.hasScannedChildren('local::ses_a')).toBe(false)
    expect(childSessionStore.hasScannedChildren('local::ses_b')).toBe(false)
  })

  it('clearAll 清空标记（切换服务器）', () => {
    childSessionStore.markChildrenScanned('local::ses_parent')
    childSessionStore.clearAll()
    expect(childSessionStore.hasScannedChildren('local::ses_parent')).toBe(false)
  })
})
