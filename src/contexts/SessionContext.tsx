import { useState, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import {
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  getSessions,
} from '../api'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { sessionIndexStore } from '../store/sessionIndexStore'
import { useDirectory } from './useDirectory'
import { isSameDirectory, normalizeToForwardSlash } from '../utils'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { SessionContext, type SessionContextValue } from './SessionContext.shared'
import type { Session } from '../types/api/session'

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
 * 好处是切目录/切回来不再发请求，文件夹模式的各个目录也共享同一份索引。
 *
 * 搜索先走本地（标题 / id）。但索引只有最近一页，旧会话可能不在里面：
 * 这时再按目录去服务端搜一次补上（去抖 300ms），只补本地没有的那部分。
 * 索引已经完整时纯本地，不按键打服务端。
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
  /** 索引没覆盖到的旧会话（服务端按标题搜出来的补充结果）；跟 serverId 绑死，切服务器不串 */
  const [remoteResults, setRemoteResults] = useState<{ serverId: string; sessions: Session[] }>({
    serverId,
    sessions: [],
  })
  const remoteSessions = remoteResults.serverId === serverId ? remoteResults.sessions : []
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

  // 当前目录在索引里一条都没有、而服务端还有没拉到的页：按目录兜底补一次。
  // 索引只保证最近若干页，旧项目可能整段被挤出；补拉后就有数据了。
  const needsDirectoryFetch =
    !!currentDirectory && snapshot.ready && snapshot.hasMore && directorySessions.length === 0
  useEffect(() => {
    if (!needsDirectoryFetch || !currentDirectory) return
    void sessionIndexStore.ensureDirectory(serverId, currentDirectory)
  }, [needsDirectoryFetch, currentDirectory, serverId])

  // 索引只覆盖最近一页：本地搜不到的旧会话再问一次服务端（去抖 300ms）。
  // 上游 search 只匹配标题，本地是「标题 + id」的超集，所以服务端结果
  // 按同样的条件再筛一遍，避免上一次搜索的旧结果串到新词下面。
  useEffect(() => {
    const term = search.trim()
    if (!term || !snapshot.hasMore) {
      setRemoteResults(previous =>
        previous.sessions.length === 0 && previous.serverId === serverId
          ? previous
          : { serverId, sessions: [] },
      )
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const directory = normalizeToForwardSlash(currentDirectory) || undefined
      void getSessions(
        { parentID: null, search: term, limit: 50, ...(directory ? { directory } : {}) },
        serverId,
      )
        .then(data => {
          if (!cancelled) setRemoteResults({ serverId, sessions: data })
        })
        .catch(() => {
          if (!cancelled) setRemoteResults({ serverId, sessions: [] })
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search, snapshot.hasMore, currentDirectory, serverId])

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return directorySessions

    const matches = (session: Session) => {
      const title = (session.title ?? '').toLowerCase()
      return title.includes(term) || session.id.toLowerCase().includes(term)
    }

    const local = directorySessions.filter(matches)
    if (remoteSessions.length === 0) return local

    // 服务端补来的结果可能包含别处的目录（缺省目录时是全服务器），按当前目录收口
    const byId = new Map(local.map(session => [session.id, session]))
    for (const session of remoteSessions) {
      if (!matches(session)) continue
      if (currentDirectory && !isSameDirectory(currentDirectory, session.location?.directory)) continue
      if (!byId.has(session.id)) byId.set(session.id, session)
    }
    return [...byId.values()].sort((a, b) => {
      const left = a.time?.updated ?? a.time?.created ?? 0
      const right = b.time?.updated ?? b.time?.created ?? 0
      return right - left
    })
  }, [directorySessions, search, remoteSessions, currentDirectory])

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
      if (!snapshot.hasMore) return
      // 服务端翻页是全局的：某一页可能一条都不属于当前目录。
      // 以「当前目录有没有变多」为准，最多连翻三页，别让点击看起来没反应。
      const before = filteredSessions.length
      for (let page = 0; page < 3; page++) {
        await sessionIndexStore.loadMore(serverId)
        const latest = sessionIndexStore.getSnapshot(serverId)
        const inDirectory = currentDirectory
          ? latest.sessions.filter(item => isSameDirectory(currentDirectory, item.location?.directory)).length
          : latest.sessions.length
        if (inDirectory > before || !latest.hasMore) break
      }
      grow()
    } finally {
      setIsLoadingMore(false)
    }
  }, [
    isLoadingMore,
    hasMore,
    filteredSessions.length,
    limit,
    grow,
    snapshot.hasMore,
    serverId,
    currentDirectory,
  ])

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
