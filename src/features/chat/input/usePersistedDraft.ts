// ============================================
// usePersistedDraft — 输入草稿持久化（按会话/工作区）
//
// 存储维度对齐官方 composer/persistence（Persist.serverScoped(server,
// dir, sessionID, "prompt")），但**恢复策略不同**：官方切会话直接
// 把草稿预填进编辑器，这里只持久化不预填——切换会话/工作区时输入框
// 清空，草稿留在 localStorage，用户按 ↑ 翻阅历史时才注入
// （useInputHistory 的 recallDraft）。直接预填在「新建会话点进
// 工作区」场景下看起来像上次输入没清干净的残留。
//
// 发送成功清空（clearPersistedDraft）。附件沿用 promptHistory 的
// 可序列化子集（data URL 内联图片不落盘）。
// ============================================

import { useEffect, useRef } from 'react'
import { fromHistoryEntry, toHistoryAttachment, type PromptHistoryEntry } from '../../../store/promptHistoryStore'
import type { Attachment } from '../../attachment'

const SAVE_DEBOUNCE_MS = 300

interface PersistedDraftOptions {
  /** 持久化 key（null = 不持久化） */
  storageKey: string | null
  text: string
  attachments: Attachment[]
  setText: (text: string) => void
  setAttachments: (attachments: Attachment[]) => void
}

/** 读取持久化草稿（供 ↑ 历史导航召回；不改动存储） */
export function readPersistedDraft(storageKey: string | null): { text: string; attachments: Attachment[] } | null {
  if (!storageKey) return null
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const entry = JSON.parse(raw) as PromptHistoryEntry
    const attachments = (entry.attachments ?? []).map(fromHistoryEntry)
    if (!entry.text && attachments.length === 0) return null
    return { text: entry.text ?? '', attachments }
  } catch {
    return null
  }
}

export function usePersistedDraft({ storageKey, text, attachments, setText, setAttachments }: PersistedDraftOptions) {
  // 当前 key 是否已完成切换清理（清理前不写盘，避免把上一个会话的内容写进新 key）
  const settledKeyRef = useRef<string | null>(null)
  // 切换后的首次空内容保存跳过删键：那是程序性清空，草稿要留到 ↑ 召回
  const skipEmptyDeleteKeyRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // key 变化（切会话/工作区）→ 清空输入框，但不读回草稿（草稿留给 ↑ 召回）
  useEffect(() => {
    if (!storageKey) return
    settledKeyRef.current = null
    skipEmptyDeleteKeyRef.current = storageKey
    setText('')
    setAttachments([])
    settledKeyRef.current = storageKey
    // 故意只随 key 执行：读写器引用随渲染变化但语义稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // 内容变化 → 防抖写盘；空草稿删除键
  useEffect(() => {
    if (!storageKey || settledKeyRef.current !== storageKey) return
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      try {
        const serializable = attachments.flatMap(attachment => {
          const item = toHistoryAttachment(attachment)
          return item ? [item] : []
        })
        const isEmpty = !text.trim() && serializable.length === 0
        if (isEmpty && skipEmptyDeleteKeyRef.current === storageKey) {
          // 切换 key 时的程序性清空：保留已有草稿，只消费一次标记
          skipEmptyDeleteKeyRef.current = null
          return
        }
        skipEmptyDeleteKeyRef.current = null
        if (isEmpty) {
          localStorage.removeItem(storageKey)
          return
        }
        localStorage.setItem(storageKey, JSON.stringify({ text, attachments: serializable }))
      } catch {
        // 存储满/不可用时草稿退化为内存态
      }
    }, SAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, text, attachments])

  // 卸载清理定时器
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    },
    [],
  )
}

/** 会话作用域的草稿 key（官方 serverScoped(server, dir, sessionID) 同款维度） */
export function draftStorageKey(sessionId: string | null | undefined, directory: string | undefined): string | null {
  if (sessionId) return `srv:draft:${sessionId}`
  if (!directory) return null
  return `srv:draft:workspace:${directory}`
}

/** 发送成功后清空草稿（resetDraft 时同步删键） */
export function clearPersistedDraft(storageKey: string | null) {
  if (!storageKey) return
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // 忽略
  }
}
