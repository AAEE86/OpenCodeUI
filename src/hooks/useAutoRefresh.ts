import { useCallback, useEffect, useRef } from 'react'
import { registerSessionConsumer } from './useGlobalEvents'
import { canonicalizePath } from '../utils/pathUtils'

/** 是否为 git 内部路径（.git/ 下的内部变更不触发刷新，对齐官方 watcher 的 .git 过滤） */
function isGitInternalPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/')
  return normalized.startsWith('.git/') || normalized.includes('/.git/') || normalized.endsWith('/.git')
}

/** file 是否位于 directory 之下（折叠 ..、统一分隔符后做前缀判断） */
function isWithinDirectory(directory: string, file: string): boolean {
  const dir = canonicalizePath(directory).replace(/\/+$/, '')
  if (!dir) return true
  const target = canonicalizePath(file)
  return target === dir || target.startsWith(`${dir}/`)
}

/**
 * 自动刷新 hook：在「数据真的可能变了」的时机触发面板刷新，而不是轮询。
 *
 * 触发时机（事件驱动，对齐官方 watcher 驱动，且比官方多覆盖 git 分支操作）：
 * 1. filesystem.changed — 工作区文件真变了（跳过 .git 内部，按 watchDirectory 过滤）。
 *    覆盖「外部编辑器改文件」「工具写文件」等场景，是主要触发源。
 * 2. vcs.branch.updated — commit / checkout / 切分支等 git 操作（不改文件但会变 diff）。
 * 3. Session idle — AI 完成一轮对话后刷新，用户最想看改了什么。
 * 4. SSE 重连 — 断线重连后数据可能过期。
 *
 * 不再用「窗口聚焦 / 可见性变化」轮询：那不靠事件、每次 alt-tab 都刷新（即使啥也没改），
 * 是「频繁刷新」的根因；filesystem.changed 已能更准地覆盖外部改动。
 *
 * 防抖：多次触发在 500ms 内只执行一次，避免请求风暴（如 git checkout 一次性改大量文件）。
 */
export function useAutoRefresh(
  consumerId: string,
  sessionId: string | null,
  refresh: () => void | Promise<void>,
  enabled: boolean = true,
  options?: {
    /** 文件变更事件按此目录过滤（只关心该目录下的改动）；缺省则任何文件变更都触发 */
    watchDirectory?: string
    /**
     * 文件真的变了时的回调（已过 .git 内部与 watchDirectory 过滤）。
     * 用于预览这类"不只是刷新列表"的消费方：例如编辑中的文件被外部改动。
     */
    onFilesystemChanged?: (data: { file: string; event: string }) => void
  },
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleRefresh = useCallback(() => {
    if (pendingRef.current !== null) return
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null
      void refreshRef.current()
    }, 500)
  }, [])

  // 一次注册：会话级 idle/reconnect + 全局文件/分支变更（经 useGlobalEvents 广播）。
  const watchDirectory = options?.watchDirectory
  useEffect(() => {
    if (!enabled) return
    return registerSessionConsumer(consumerId, sessionId, {
      onSessionIdle: () => scheduleRefresh(),
      onReconnected: () => scheduleRefresh(),
      onFilesystemChanged: data => {
        if (isGitInternalPath(data.file)) return
        if (watchDirectory && !isWithinDirectory(watchDirectory, data.file)) return
        scheduleRefresh()
      },
      onVcsBranchUpdated: () => scheduleRefresh(),
    })
  }, [consumerId, sessionId, enabled, scheduleRefresh, watchDirectory])

  // 卸载时清掉待执行的刷新，避免在已卸载组件上 setState
  useEffect(
    () => () => {
      if (pendingRef.current !== null) {
        clearTimeout(pendingRef.current)
        pendingRef.current = null
      }
    },
    [],
  )
}
