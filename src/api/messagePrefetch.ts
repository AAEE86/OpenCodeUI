// ============================================
// 会话首屏消息预取
//
// 点击列表项到 ChatPane 的 effect 真正执行之间，隔着一次 React 提交。
// 官方 app 在点击回调里就发出 `message.sync`（home/sessions/controller.tsx:348），
// 这里做同一件事：导航入口先发请求，会话页再「取走」这个 in-flight promise。
//
// 复用而不是并行重发：会话页拿到的是同一个请求，不会因为预取而多打一次。
// 未被取走的预取在 TTL 后自然失效；promise 上的 catch 保证不会产生
// unhandled rejection（调用方 await 时仍能拿到真实错误）。
//
// TTL 取「点击 → effect 执行」这个量级（10s），而不是元信息缓存的 30s：
// 这里存的是会话内容，宁可偶尔多打一次请求，也不要让用户看到十秒前
// 的转写（期间可能正在流式输出）。
// ============================================

import { getSessionMessagesPage } from './message'
import { messageStore } from '../store/messageStore'
import { makeSessionKey, splitSessionKey } from '../utils/sessionKey'

type MessagePage = Awaited<ReturnType<typeof getSessionMessagesPage>>

const TTL_MS = 10_000
const MAX_INFLIGHT = 32

interface Entry {
  promise: Promise<MessagePage>
  startedAt: number
}

const inflight = new Map<string, Entry>()

/**
 * 归一化会话标识：导航入口传原始 id（列表项的 session.id），
 * 会话页传复合 key（serverId::sessionId），两者必须落到同一个槽位。
 */
function normalizeTarget(serverId: string, sessionId: string): { serverId: string; sessionId: string } {
  return sessionId.includes('::') ? splitSessionKey(sessionId) : { serverId, sessionId }
}

function cacheKey(serverId: string, sessionId: string, limit: number): string {
  const target = normalizeTarget(serverId, sessionId)
  return `${target.serverId}\0${target.sessionId}\0${limit}`
}

function prune(now: number): void {
  for (const [key, entry] of inflight) {
    if (now - entry.startedAt > TTL_MS) inflight.delete(key)
  }
  // 极端情况下（一直被导航打断）按插入顺序丢最早的一批
  while (inflight.size > MAX_INFLIGHT) {
    const oldest = inflight.keys().next().value
    if (oldest === undefined) break
    inflight.delete(oldest)
  }
}

/**
 * 预取会话首屏消息；重复调用复用同一个请求。
 *
 * 已经有可用缓存视图（切过去不会再请求）时直接跳过：白白发一次请求，
 * 而且 request 的结果没人取，只会在槽位里留到过期。
 */
export function prefetchSessionMessages(serverId: string, sessionId: string, limit: number): void {
  const target = normalizeTarget(serverId, sessionId)
  // 已有可用缓存视图时，会话页根本不会再请求：预取纯属浪费
  if (messageStore.hasRenderableCache(makeSessionKey(target.serverId, target.sessionId))) return
  const key = cacheKey(serverId, sessionId, limit)
  if (inflight.has(key)) return

  prune(Date.now())
  const promise = getSessionMessagesPage(sessionId, { limit }, serverId)
  // 失败时清理槽位，并吞掉「没人取走」场景下的 rejection
  promise.catch(() => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key)
  })
  inflight.set(key, { promise, startedAt: Date.now() })
}

/**
 * 取走预取结果（一次性）。过期则视为未命中，由调用方重新请求。
 * 返回 undefined 表示没有可用的预取。
 */
export function takeSessionMessagesPrefetch(
  serverId: string,
  sessionId: string,
  limit: number,
): Promise<MessagePage> | undefined {
  const key = cacheKey(serverId, sessionId, limit)
  const entry = inflight.get(key)
  if (!entry) return undefined
  inflight.delete(key)
  if (Date.now() - entry.startedAt > TTL_MS) return undefined
  return entry.promise
}

/** 测试用：清空预取槽位 */
export function clearSessionMessagesPrefetch(): void {
  inflight.clear()
}
