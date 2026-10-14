import { useCallback, useSyncExternalStore } from 'react'

/**
 * 变更查看的范围模式——对齐官方 review（gui-extensions/review/model.ts）：
 *   git    → vcs.diff({ mode: 'working' })   工作区（HEAD → working copy）
 *   branch → vcs.diff({ mode: 'branch' })    分支（merge-base → working copy）
 *   turn   → session.diff({ sessionID })     当前轮（快照差，仅 git 项目）
 *
 * v1 时代的 'session' 模式已移除：v2 的 session.diff 无参调用就是 turn 语义，
 * 两者是同一接口的两个名字。
 */
export type ChangeScopeMode = 'git' | 'branch' | 'turn'

type Subscriber = () => void

class ChangeScopeStore {
  private modes = new Map<string, ChangeScopeMode>()
  private subscribers = new Set<Subscriber>()

  subscribe = (fn: Subscriber): (() => void) => {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  getMode(sessionId: string | null): ChangeScopeMode {
    if (!sessionId) return 'git'
    return this.modes.get(sessionId) ?? 'git'
  }

  setMode(sessionId: string | null, mode: ChangeScopeMode) {
    if (!sessionId) return
    if (this.modes.get(sessionId) === mode) return
    this.modes.set(sessionId, mode)
    this.subscribers.forEach(fn => fn())
  }

  clearSession(sessionId: string | null) {
    if (!sessionId) return
    if (!this.modes.delete(sessionId)) return
    this.subscribers.forEach(fn => fn())
  }

  clearAll() {
    if (this.modes.size === 0) return
    this.modes.clear()
    this.subscribers.forEach(fn => fn())
  }
}

export const changeScopeStore = new ChangeScopeStore()

export function useSessionChangeScope(sessionId: string | null): ChangeScopeMode {
  const getSnapshot = useCallback(() => changeScopeStore.getMode(sessionId), [sessionId])
  return useSyncExternalStore(changeScopeStore.subscribe, getSnapshot, getSnapshot)
}
