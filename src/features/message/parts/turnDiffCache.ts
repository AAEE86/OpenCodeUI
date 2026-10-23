// 回合 diff 的会话内缓存：虚拟列表来回挂载时不重复请求，也给预览页提供 seed 入口。

import type { FileDiff } from '../../../api/types'

const turnDiffCache = new Map<string, FileDiff[]>()
const MAX_CACHED_TURN_DIFFS = 50

export function getCachedTurnDiff(key: string): FileDiff[] | undefined {
  return turnDiffCache.get(key)
}

export function cacheTurnDiff(key: string, diffs: FileDiff[]) {
  turnDiffCache.set(key, diffs)
  while (turnDiffCache.size > MAX_CACHED_TURN_DIFFS) {
    const oldest = turnDiffCache.keys().next().value
    if (oldest === undefined) break
    turnDiffCache.delete(oldest)
  }
}

/** 预览/测试用：预先塞入某轮的 diff，避免走接口 */
export function primeTurnDiffCache(sessionId: string, from: string, diffs: FileDiff[]) {
  cacheTurnDiff(`${sessionId}:${from}`, diffs)
}
