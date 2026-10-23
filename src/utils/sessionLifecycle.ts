import { activeSessionStore } from '../store/activeSessionStore'
import { childSessionStore } from '../store/childSessionStore'
import { inboxStore } from '../store/inboxStore'
import { messageStore } from '../store/messageStore'
import { sessionInfoCache } from '../store/sessionInfoCache'
import { splitSessionKey } from './sessionKey'

export function clearSessionRuntimeState(sessionId: string) {
  const sessionIds = childSessionStore.getSessionAndDescendants(sessionId)

  for (const id of sessionIds) {
    messageStore.clearSession(id)
    inboxStore.clearSession(id)
    activeSessionStore.removeSession(id)
    // 列表交接缓存同样要清：否则删掉的会话还能在 TTL 内命中旧元信息
    sessionInfoCache.forget(splitSessionKey(id).serverId, id)
  }

  childSessionStore.removeSession(sessionId)
}
