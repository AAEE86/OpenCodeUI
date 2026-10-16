// ============================================
// ActiveSessionStore - 追踪所有 session 的活跃状态
// ============================================
//
// 职责单一：只管 session 是否活跃、在等什么
//
// 数据来源：
// 1. GET /session/status → 全量 session 状态
// 2. GET /permission + GET /question → 补充等待中的 session
// 3. SSE session.status / permission.asked / question.asked 事件
//
// 与 notificationStore 完全独立，不互相依赖

import { useCallback, useSyncExternalStore } from 'react'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'

// ============================================
// Types
// ============================================

export interface PendingRequest {
  requestId: string
  sessionId: string
  type: 'permission' | 'question'
  description?: string
}

export interface ActiveSessionEntry {
  sessionId: string
  status: SessionStatus
  title?: string
  directory?: string
  /** session 当前等待的用户操作 */
  pendingAction?: {
    type: 'permission' | 'question'
    description?: string
  }
  /**
   * 合成条目标记：会话本身 idle，仅因后台 shell 在跑而被视为活跃
   * （SidePanel 活跃 tab 从 shellInventoryStore 合成，status 是 idle 占位）
   */
  backgroundOnly?: boolean
}

interface ActiveSessionState {
  statusMap: SessionStatusMap
  initialized: boolean
}

type Subscriber = () => void

function isSameBusySessions(a: ActiveSessionEntry[], b: ActiveSessionEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (left.sessionId !== right.sessionId) return false
    if (left.title !== right.title || left.directory !== right.directory) return false
    if (left.pendingAction?.type !== right.pendingAction?.type) return false
    if (left.pendingAction?.description !== right.pendingAction?.description) return false
    if (left.status.type !== right.status.type) return false
    if (left.status.type === 'retry' && right.status.type === 'retry') {
      if (
        left.status.attempt !== right.status.attempt ||
        left.status.message !== right.status.message ||
        left.status.next !== right.status.next
      ) {
        return false
      }
    }
  }
  return true
}

// ============================================
// Store
// ============================================

class ActiveSessionStore {
  private state: ActiveSessionState = {
    statusMap: {},
    initialized: false,
  }
  private subscribers = new Set<Subscriber>()

  // session 元信息缓存（title, directory）
  private sessionMeta = new Map<string, { title?: string; directory?: string }>()

  // 未回复的 permission/question 请求 — requestId → PendingRequest
  private pendingRequests = new Map<string, PendingRequest>()

  // 已回复/取消的 requestId（FIFO，取最近 512 条）。
  // 存在的意义：useGlobalEvents 会把拉取窗口内迟到的 asked 事件记在闭包里的
  // latePendingRequests，fetch 回来后再补进 store。本地乐观回复只清得掉 store
  // 里的 pendingRequests，够不着那个闭包——于是已回复的请求会被下一次 fetch
  // 重放回来，侧边栏徽标就这么卡住（不刷新页面永远不消失）。
  // 只要 requestId 记在这里，addPendingRequest 一律不认。
  private settledRequestIds = new Map<string, true>()
  private static readonly SETTLED_LIMIT = 512

  // 服务端已报告 idle，但因有未回复请求而暂缓移出的 session
  private deferredIdleSessions = new Set<string>()

  // 派生数据缓存
  private cachedBusySessions: ActiveSessionEntry[] = []
  private cachedBusyCount: number = 0

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.recomputeDerived()
    this.subscribers.forEach(cb => {
      cb()
    })
  }

  private recomputeDerived() {
    const entries = Object.entries(this.state.statusMap)
      .filter(([, status]) => status.type === 'busy' || status.type === 'retry')
      .map(([sessionId, status]) => {
        const meta = this.sessionMeta.get(sessionId)
        // 从自身 pendingRequests 查 pending action
        const pending = this.findPendingForSession(sessionId)
        return {
          sessionId,
          status,
          title: meta?.title,
          directory: meta?.directory,
          pendingAction: pending ? { type: pending.type, description: pending.description } : undefined,
        } as ActiveSessionEntry
      })
    // 内容不变时复用旧数组引用，避免 useBusySessions 订阅方因引用抖动重渲染
    if (!isSameBusySessions(this.cachedBusySessions, entries)) {
      this.cachedBusySessions = entries
    }
    this.cachedBusyCount = entries.length
  }

  private findPendingForSession(sessionId: string): PendingRequest | undefined {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return req
    }
    return undefined
  }

  private hasPendingForSession(sessionId: string): boolean {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return true
    }
    return false
  }

  private markSettled(requestId: string) {
    this.settledRequestIds.set(requestId, true)
    if (this.settledRequestIds.size > ActiveSessionStore.SETTLED_LIMIT) {
      const oldest = this.settledRequestIds.keys().next().value
      if (oldest !== undefined) this.settledRequestIds.delete(oldest)
    }
  }

  getSnapshot = (): ActiveSessionState => this.state
  getBusySessionsSnapshot = (): ActiveSessionEntry[] => this.cachedBusySessions
  getBusyCountSnapshot = (): number => this.cachedBusyCount

  private applyStatusSnapshot(statusMap: SessionStatusMap, baseMap: SessionStatusMap): SessionStatusMap {
    const nextMap = { ...baseMap }

    for (const [sessionId, status] of Object.entries(statusMap)) {
      if (status.type === 'idle') {
        delete nextMap[sessionId]
        continue
      }

      nextMap[sessionId] = status.type === 'retry' ? { ...status } : { type: 'busy' }
    }

    return nextMap
  }

  // ============================================
  // 初始化：从 API 拉取全量状态
  // ============================================

  initialize(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: this.applyStatusSnapshot(statusMap, {}),
      initialized: true,
    }
    this.notify()
  }

  // ============================================
  // 状态快照（session.active()：只列「运行中」会话）
  //
  // 快照对发起 server 是**绝对**的（官方 client/solid/data.ts 的
  // server.connected → session.active() 全量替换语义）：
  // 快照没有、本地却 busy/retry 的同 server 会话 = 拉取开始前已结束 →
  // 不进新 map（即 idle）。keepOtherServers 只跨 server 保留条目，
  // 不跨时间保留——否则断连期间结束的会话会永远卡在 busy（断流恢复后
  // 「信息流状态不刷新」的根因）。
  //
  // 拉取窗口内到达的 status 事件（beginStatusSnapshot 缓冲，官方
  // activeUpdates 同款）覆盖快照，防止旧快照盖掉新事件。
  // ============================================

  /** serverId → 拉取窗口（depth 支持同 server 并发 fetch；updates 为窗口内事件） */
  private statusSnapshotFlights = new Map<string, { depth: number; updates: Map<string, SessionStatus> }>()

  beginStatusSnapshot(serverId: string) {
    const flight = this.statusSnapshotFlights.get(serverId)
    if (flight) {
      flight.depth += 1
      return
    }
    this.statusSnapshotFlights.set(serverId, { depth: 1, updates: new Map() })
  }

  endStatusSnapshot(serverId: string) {
    const flight = this.statusSnapshotFlights.get(serverId)
    if (!flight) return
    flight.depth -= 1
    if (flight.depth <= 0) this.statusSnapshotFlights.delete(serverId)
  }

  applyServerStatusSnapshot(serverId: string, statusMap: SessionStatusMap, options?: { keepOtherServers?: boolean }) {
    const prefix = `${serverId}::`
    const nextMap: SessionStatusMap = {}
    if (options?.keepOtherServers) {
      for (const [sid, status] of Object.entries(this.state.statusMap)) {
        if (!sid.startsWith(prefix)) nextMap[sid] = status
      }
    }
    // 本 server 的绝对状态 = 快照 ∪ 拉取窗口内迟到事件（事件更晚，覆盖快照）
    const merged = new Map<string, SessionStatus>(Object.entries(statusMap))
    const flight = this.statusSnapshotFlights.get(serverId)
    if (flight) {
      for (const [sid, status] of flight.updates) merged.set(sid, status)
    }
    for (const [sid, status] of merged) {
      if (status.type === 'idle') continue
      nextMap[sid] = status.type === 'retry' ? { ...status } : { type: 'busy' }
    }
    this.state = { ...this.state, statusMap: nextMap, initialized: true }
    this.notify()
  }

  // ============================================
  // 初始化：从 /permission + /question API 补充
  // ============================================

  initializePendingRequests(
    permissions: Array<{ id: string; sessionID: string; action: string; resources?: readonly string[] }>,
    forms: Array<{ id: string; sessionID: string; title?: string }>,
  ) {
    this.applyPendingSnapshot(permissions, forms, new Map<string, PendingRequest>(), new Set<string>())
  }

  // ============================================
  // 范围刷新：保留这次范围外已知的 pending request
  // ============================================

  mergePendingRequests(
    permissions: Array<{ id: string; sessionID: string; action: string; resources?: readonly string[] }>,
    forms: Array<{ id: string; sessionID: string; title?: string }>,
  ) {
    this.applyPendingSnapshot(permissions, forms, new Map(this.pendingRequests), new Set(this.deferredIdleSessions))
  }

  private applyPendingSnapshot(
    permissions: Array<{ id: string; sessionID: string; action: string; resources?: readonly string[] }>,
    questions: Array<{ id: string; sessionID: string; title?: string }>,
    pendingRequests: Map<string, PendingRequest>,
    deferredIdleSessions: Set<string>,
  ) {
    let changed = false
    const newMap = { ...this.state.statusMap }

    for (const p of permissions) {
      // v2：permission→action，patterns→resources
      const desc = p.resources?.length ? `${p.action}: ${p.resources[0]}` : p.action
      pendingRequests.set(p.id, {
        requestId: p.id,
        sessionId: p.sessionID,
        type: 'permission',
        description: desc,
      })
      if (!newMap[p.sessionID] || newMap[p.sessionID].type === 'idle') {
        newMap[p.sessionID] = { type: 'busy' }
        deferredIdleSessions.add(p.sessionID)
        changed = true
      }
    }

    for (const q of questions) {
      // v2：question.header → form.title
      const desc = q.title || 'Waiting for input'
      pendingRequests.set(q.id, {
        requestId: q.id,
        sessionId: q.sessionID,
        type: 'question',
        description: desc,
      })
      if (!newMap[q.sessionID] || newMap[q.sessionID].type === 'idle') {
        newMap[q.sessionID] = { type: 'busy' }
        deferredIdleSessions.add(q.sessionID)
        changed = true
      }
    }

    this.pendingRequests = pendingRequests
    this.deferredIdleSessions = deferredIdleSessions

    if (changed) {
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question asked → 注册 pending
  // ============================================

  addPendingRequest(requestId: string, sessionId: string, type: 'permission' | 'question', description?: string) {
    // 已回复/取消过的请求：fetch 快照重放、乱序事件再推回来都不认
    if (this.settledRequestIds.has(requestId)) return
    this.pendingRequests.set(requestId, { requestId, sessionId, type, description })
    // 确保 session 在 busy 列表
    if (!this.state.statusMap[sessionId] || this.state.statusMap[sessionId].type === 'idle') {
      const newMap = { ...this.state.statusMap, [sessionId]: { type: 'busy' as const } }
      this.deferredIdleSessions.add(sessionId)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question replied → 移除 pending
  // ============================================

  resolvePendingRequest(requestId: string) {
    // 无论这条当前还在不在 pending 里都先记下：SSE replied 和本地乐观回复都会
    // 走到这里，先到的把 id 记牢，后到的（含 fetch 重放）就被 addPendingRequest 挡掉。
    this.markSettled(requestId)

    const req = this.pendingRequests.get(requestId)
    if (!req) return
    this.pendingRequests.delete(requestId)

    // 检查该 session 是否还有其他 pending，没有且 deferred 就移出 busy
    if (this.deferredIdleSessions.has(req.sessionId) && !this.hasPendingForSession(req.sessionId)) {
      this.deferredIdleSessions.delete(req.sessionId)
      const newMap = { ...this.state.statusMap }
      delete newMap[req.sessionId]
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：session status 更新
  // ============================================

  updateStatus(sessionId: string, status: SessionStatus) {
    const newMap = { ...this.state.statusMap }

    if (status.type === 'idle') {
      if (this.hasPendingForSession(sessionId)) {
        this.deferredIdleSessions.add(sessionId)
      } else {
        this.deferredIdleSessions.delete(sessionId)
        delete newMap[sessionId]
      }
    } else if (status.type === 'retry') {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = { ...status }
    } else {
      this.deferredIdleSessions.delete(sessionId)
      newMap[sessionId] = { type: 'busy' }
    }

    // 快照拉取窗口内的事件先记账（官方 activeUpdates 同款）：
    // applyServerStatusSnapshot 用它们覆盖旧快照
    const sep = sessionId.indexOf('::')
    if (sep > 0) {
      const flight = this.statusSnapshotFlights.get(sessionId.slice(0, sep))
      if (flight) flight.updates.set(sessionId, status)
    }

    this.state = { ...this.state, statusMap: newMap }
    this.notify()
  }

  removeSession(sessionId: string) {
    let changed = false
    let nextMap = this.state.statusMap

    if (nextMap[sessionId]) {
      nextMap = { ...nextMap }
      delete nextMap[sessionId]
      changed = true
    }

    for (const [requestId, request] of this.pendingRequests) {
      if (request.sessionId !== sessionId) continue
      this.pendingRequests.delete(requestId)
      changed = true
    }

    if (this.deferredIdleSessions.delete(sessionId)) changed = true
    if (this.sessionMeta.delete(sessionId)) changed = true

    if (!changed) return
    this.state = { ...this.state, statusMap: nextMap }
    this.notify()
  }

  // ============================================
  // Session 元信息管理
  // ============================================

  setSessionMeta(sessionId: string, title?: string, directory?: string) {
    const existing = this.sessionMeta.get(sessionId)
    const newTitle = title ?? existing?.title
    const newDir = directory ?? existing?.directory
    if (newTitle !== existing?.title || newDir !== existing?.directory) {
      this.sessionMeta.set(sessionId, { title: newTitle, directory: newDir })
      this.notify()
    }
  }

  getSessionMeta(sessionId: string) {
    return this.sessionMeta.get(sessionId)
  }

  getBusySessions(): ActiveSessionEntry[] {
    return this.cachedBusySessions
  }

  get busyCount(): number {
    return this.cachedBusyCount
  }

  // ============================================
  // 全量重置（测试隔离 / 会话上下文彻底切换）
  // ============================================

  reset() {
    this.state = { statusMap: {}, initialized: false }
    this.pendingRequests = new Map()
    this.settledRequestIds = new Map()
    this.deferredIdleSessions = new Set()
    this.sessionMeta = new Map()
    this.statusSnapshotFlights = new Map()
    this.cachedBusySessions = []
    this.cachedBusyCount = 0
    this.notify()
  }
}

// ============================================
// Singleton & React Hooks
// ============================================

export const activeSessionStore = new ActiveSessionStore()

export function useActiveSessionStore() {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getSnapshot)
}

export function useBusySessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusySessionsSnapshot)
}

export function useBusyCount(): number {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusyCountSnapshot)
}

/** 按 sessionId 查活跃状态，不活跃时返回 undefined */
export function useSessionActiveEntry(sessionId: string): ActiveSessionEntry | undefined {
  const getSnapshot = useCallback(
    () => activeSessionStore.getBusySessions().find(e => e.sessionId === sessionId),
    [sessionId],
  )
  return useSyncExternalStore(activeSessionStore.subscribe, getSnapshot)
}
