// ============================================
// SessionInfoCache — 列表到会话页的元信息交接
//
// 列表（session.list）返回的本来就是完整 `SessionInfo`，但会话页过去还要
// 再发一次 `session.get` 才拿得到标题 / 目录 / agent / model / revert。
// 官方 app 的做法是点击时 `data.session.remember(session)`，进会话不再请求。
//
// 这里保存同一份交接数据，带短 TTL：
//   - 命中 → 进入会话少一个请求，且不占同源连接槽
//   - 过期 / 未命中（深链、刷新）→ 照常走 session.get
//
// TTL 内服务端状态可能已变（重命名、revert），所以只用于「刚从列表点进来」
// 这一条路径；重连刷新（force）显式跳过缓存。
// ============================================

import type { Session } from '../types/api/session'
import { splitSessionKey } from '../utils/sessionKey'

/** 交接数据的可信窗口：列表刚拉到的数据足够新鲜 */
const TTL_MS = 30_000
/** 上限按「一个服务器常见会话数量」取，超出按 LRU 淘汰 */
const MAX_ENTRIES = 300

interface Entry {
  session: Session
  storedAt: number
}

class SessionInfoCache {
  private entries = new Map<string, Entry>()

  /**
   * 归一化会话标识：调用方可能传原始 id（列表项）或复合 key（路由/pane），
   * 两种形式落到同一个条目上。
   */
  private normalize(serverId: string, sessionId: string): { serverId: string; sessionId: string } {
    if (!sessionId.includes('::')) return { serverId, sessionId }
    const parsed = splitSessionKey(sessionId)
    return { serverId: parsed.serverId, sessionId: parsed.sessionId }
  }

  private key(serverId: string, sessionId: string): string {
    const target = this.normalize(serverId, sessionId)
    return `${target.serverId}\0${target.sessionId}`
  }

  remember(serverId: string, session: Session): void {
    const key = this.key(serverId, session.id)
    // delete + set：维持 Map 的插入顺序即 LRU 顺序
    this.entries.delete(key)
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { session, storedAt: Date.now() })
  }

  get(serverId: string, sessionId: string): Session | undefined {
    const key = this.key(serverId, sessionId)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.storedAt > TTL_MS) {
      this.entries.delete(key)
      return undefined
    }
    // 命中即最近使用：delete + set 保持 Map 的插入顺序等于 LRU 顺序
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.session
  }

  forget(serverId: string, sessionId: string): void {
    this.entries.delete(this.key(serverId, sessionId))
  }

  /**
   * 就地更新已缓存的条目（重命名等局部变更）。
   * 没有条目时什么都不做——交给下一次 getSession 回填。
   */
  update(serverId: string, sessionId: string, patch: Partial<Session>): void {
    const key = this.key(serverId, sessionId)
    const entry = this.entries.get(key)
    if (!entry) return
    entry.session = { ...entry.session, ...patch }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const sessionInfoCache = new SessionInfoCache()

/**
 * 列表项是否已经是完整可用的 `SessionInfo`。
 *
 * 缓存只接受完整对象：半截对象（只有 id + location）写进去会让会话页
 * 拿不到标题/时间/agent，比不发缓存更糟。列表与命令面板给的都是完整
 * 记录，守卫只是把这条边界写死。
 */
export function isCompleteSessionInfo(value: unknown): value is Session {
  const candidate = value as Partial<Session> | undefined
  return (
    !!candidate &&
    typeof candidate.id === 'string' &&
    typeof candidate.location?.directory === 'string' &&
    typeof candidate.time?.updated === 'number'
  )
}

