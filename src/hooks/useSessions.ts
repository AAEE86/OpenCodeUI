import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react'
import { createSession, deleteSession, type ApiSession } from '../api'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { sessionIndexStore } from '../store/sessionIndexStore'
import { isSameDirectory } from '../utils'

/** 稳定引用：useSyncExternalStore 每次渲染拿到同一个 subscribe，避免反复解绑 */
const subscribeServerStore = serverStore.subscribe.bind(serverStore)
const getActiveServerId = () => serverStore.getActiveServerId()

interface UseSessionsOptions {
  /** 每页数量（本地切片，不触发网络请求） */
  pageSize?: number
  /** 初始搜索词 */
  initialSearch?: string
  /** 按目录过滤 */
  directory?: string
  /** 延迟启用，用于懒加载 */
  enabled?: boolean
  /** 指定服务器（缺省用活动服务器）。多服务器模式下每个服务器一个实例 */
  serverId?: string
}

interface UseSessionsResult {
  sessions: ApiSession[]
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  /** 搜索词 */
  search: string
  setSearch: (search: string) => void
  /** 加载更多 */
  loadMore: () => Promise<void>
  /** 刷新列表 */
  refresh: () => Promise<void>
  /** 创建新会话 */
  create: (title?: string) => Promise<ApiSession>
  /** 删除会话 */
  remove: (sessionId: string) => Promise<void>
  /** 本地更新会话 */
  patchLocalSession: (sessionId: string, patch: Partial<ApiSession>) => void
  /** 本地移除会话 */
  removeLocalSession: (sessionId: string) => void
}

/**
 * 目录级会话列表（侧栏文件夹模式 / 多服务器模式）。
 *
 * 数据来自 `sessionIndexStore` 的服务器级索引：同一台服务器上无论展开
 * 多少个文件夹，都只共享一次 `session.list`，目录过滤和分页切片都在本地。
 * 过去每个文件夹（pageSize=5）各发一次请求，文件夹一多就把队列打满。
 */
export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
  const { pageSize = 20, initialSearch = '', directory, enabled = true, serverId } = options

  // 标准化 directory 路径 (移除末尾斜杠，统一正斜杠)
  const normalizedDirectory = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') : undefined
  // 固定服务器直接用；没传时跟随活动服务器（切服务器要换索引）
  const activeServerId = useSyncExternalStore(
    subscribeServerStore,
    getActiveServerId,
    getActiveServerId,
  )
  const serverKey = serverId ?? activeServerId

  const snapshot = useSyncExternalStore(
    sessionIndexStore.subscribe,
    () => sessionIndexStore.getSnapshot(serverKey),
    () => sessionIndexStore.getSnapshot(serverKey),
  )

  const [search, setSearch] = useState(initialSearch)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  // 展开量跟「服务器 + 目录 + 搜索词」绑定：切走后不把旧展开量带过去
  const listKey = `${serverKey}\0${normalizedDirectory ?? ''}\0${search}\0${pageSize}`
  const [slice, setSlice] = useState({ key: listKey, limit: pageSize })
  const limit = slice.key === listKey ? slice.limit : pageSize

  const grow = useCallback(() => {
    setSlice({ key: listKey, limit: limit + pageSize })
  }, [listKey, limit, pageSize])

  // 懒加载：只有 enabled 的文件夹才触发索引拉取（同一服务器仍然只拉一次）
  useEffect(() => {
    if (!enabled) return
    void sessionIndexStore.ensure(serverKey)
  }, [enabled, serverKey])

  const directorySessions = useMemo(() => {
    if (!normalizedDirectory) return snapshot.sessions
    return snapshot.sessions.filter(session => isSameDirectory(normalizedDirectory, session.location?.directory))
  }, [snapshot.sessions, normalizedDirectory])

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
  const isLoading = !enabled ? false : !snapshot.ready && !snapshot.error

  const loadMore = useCallback(async () => {
    if (!enabled || isLoadingMore || !hasMore) return
    setIsLoadingMore(true)
    try {
      if (filteredSessions.length > limit) {
        grow()
        return
      }
      if (snapshot.hasMore) {
        await sessionIndexStore.loadMore(serverKey)
        grow()
      }
    } finally {
      setIsLoadingMore(false)
    }
  }, [enabled, isLoadingMore, hasMore, filteredSessions.length, limit, grow, snapshot.hasMore, serverKey])

  const refresh = useCallback(async () => {
    if (!enabled) return
    await sessionIndexStore.ensure(serverKey, { force: true })
  }, [enabled, serverKey])

  const create = useCallback(
    async (title?: string) => {
      const newSession = await createSession({ title, directory: normalizedDirectory }, serverId)
      // 不等 SSE：新建的会话已经是完整元信息，直接进索引
      if (!newSession.parentID) sessionIndexStore.upsert(serverKey, newSession)
      return newSession
    },
    [normalizedDirectory, serverId, serverKey],
  )

  const remove = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId, normalizedDirectory, serverId)
      pinnedSessionsStore.unpin(sessionId)
      sessionIndexStore.remove(serverKey, sessionId)
    },
    [normalizedDirectory, serverId, serverKey],
  )

  const patchLocalSession = useCallback(
    (sessionId: string, patch: Partial<ApiSession>) => {
      sessionIndexStore.patch(serverKey, sessionId, patch)
    },
    [serverKey],
  )

  const removeLocalSession = useCallback(
    (sessionId: string) => {
      sessionIndexStore.remove(serverKey, sessionId)
    },
    [serverKey],
  )

  return {
    sessions,
    isLoading,
    isLoadingMore,
    error: snapshot.error,
    hasMore,
    search,
    setSearch,
    loadMore,
    refresh,
    create,
    remove,
    patchLocalSession,
    removeLocalSession,
  }
}
