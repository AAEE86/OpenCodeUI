import { useState, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { createSession as apiCreateSession, deleteSession as apiDeleteSession } from '../api'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { sessionIndexStore } from '../store/sessionIndexStore'
import { useDirectory } from './useDirectory'
import { isSameDirectory, normalizeToForwardSlash } from '../utils'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { SessionContext, type SessionContextValue } from './SessionContext.shared'

/** 列表首屏条数；「显示更多」每次多露出这么多 */
const LIST_PAGE_SIZE = 30

/** 稳定引用：useSyncExternalStore 每次渲染拿到同一个 subscribe，避免反复解绑 */
const subscribeServerStore = serverStore.subscribe.bind(serverStore)
const getActiveServerId = () => serverStore.getActiveServerId()

/**
 * 会话列表数据源。
 *
 * 列表本身来自 `sessionIndexStore`（每个服务器一份根会话索引，30s 内复用），
 * 这里只做三件事：按当前目录过滤、按搜索词过滤、按需要切片。
 *
 * 好处是切目录/切回来不再发请求，文件夹模式的各个目录也共享同一份索引；
 * 搜索是本地标题匹配（官方 home 的会话搜索同款），不再每个按键打一次服务端。
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { currentDirectory } = useDirectory()
  const serverId = useSyncExternalStore(subscribeServerStore, getActiveServerId, getActiveServerId)

  const snapshot = useSyncExternalStore(
    sessionIndexStore.subscribe,
    () => sessionIndexStore.getSnapshot(serverId),
    () => sessionIndexStore.getSnapshot(serverId),
  )

  const [search, setSearch] = useState('')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  // 「显示更多」的展开量跟目录/搜索词绑定：切过去时从第一页开始，不会把
  // 上一个目录的展开量短暂套到新目录上（会出现多显示一截再收回的跳动）
  const listKey = `${currentDirectory ?? ''}\0${search}`
  const [slice, setSlice] = useState({ key: listKey, limit: LIST_PAGE_SIZE })
  const limit = slice.key === listKey ? slice.limit : LIST_PAGE_SIZE

  const grow = useCallback(() => {
    setSlice({ key: listKey, limit: limit + LIST_PAGE_SIZE })
  }, [listKey, limit])

  // 挂载 / 切服务器：确保索引可用（30s 内命中则不请求）
  useEffect(() => {
    void sessionIndexStore.ensure(serverId)
  }, [serverId])

  const directorySessions = useMemo(() => {
    if (!currentDirectory) return snapshot.sessions
    return snapshot.sessions.filter(session => isSameDirectory(currentDirectory, session.location?.directory))
  }, [snapshot.sessions, currentDirectory])

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return directorySessions
    return directorySessions.filter(session => {
      const title = (session.title ?? '').toLowerCase()
      return title.includes(term) || session.id.toLowerCase().includes(term)
    })
  }, [directorySessions, search])

  const sessions = useMemo(() => filteredSessions.slice(0, limit), [filteredSessions, limit])
  const searching = search.trim().length > 0
  const hasMore = filteredSessions.length > limit || (!searching && snapshot.hasMore)
  // 首帧还没发起请求时也别显示空态；请求失败后交给空态/重试入口
  const isLoading = !snapshot.ready && !snapshot.error

  const refresh = useCallback(async () => {
    await sessionIndexStore.ensure(serverId, { force: true })
  }, [serverId])

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return
    setIsLoadingMore(true)
    try {
      // 本地还有没露出的先露出；本地见底了再向服务端要下一页
      if (filteredSessions.length > limit) {
        grow()
        return
      }
      if (snapshot.hasMore) {
        await sessionIndexStore.loadMore(serverId)
        grow()
      }
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, hasMore, filteredSessions.length, limit, grow, snapshot.hasMore, serverId])

  const createSession = useCallback(
    async (title?: string) => {
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
      const newSession = await apiCreateSession({ title, directory: targetDir })
      // 直接进索引，不等 SSE（新建会话已经是完整元信息）
      if (!newSession.parentID) sessionIndexStore.upsert(serverId, newSession)
      return newSession
    },
    [currentDirectory, serverId],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      const targetDir = normalizeToForwardSlash(currentDirectory) || undefined
      await apiDeleteSession(id, targetDir)
      pinnedSessionsStore.unpin(id)
      clearSessionRuntimeState(id)
      sessionIndexStore.remove(serverId, id)
    },
    [currentDirectory, serverId],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      sessions,
      isLoading,
      isLoadingMore,
      hasMore,
      search,
      setSearch,
      refresh,
      loadMore,
      createSession,
      deleteSession,
    }),
    [sessions, isLoading, isLoadingMore, hasMore, search, refresh, loadMore, createSession, deleteSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
