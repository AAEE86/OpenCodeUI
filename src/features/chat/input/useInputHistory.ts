import { useRef, useCallback, useEffect } from 'react'
import { usePromptHistory, fromHistoryEntry, type PromptHistoryEntry } from '../../../store/promptHistoryStore'
import type { Attachment } from '../../attachment'

// ============================================
// useInputHistory
// 类终端的历史消息导航（↑↓ 翻阅已发送消息）
//
// 默认数据源是**全局持久化**的 prompt 历史（官方 composer/history 同款：
// 跨会话跨重启保留，normal/shell 分轨，发送即记账、失败移除）。
// 传入 sessionEntries（当前会话自己的历史用户输入）时优先使用——
// 在某个会话里翻的是这个会话发过的内容，而不是其它会话的最近输入。
// ============================================

interface HistoryEntry {
  text: string
  attachments: Attachment[]
}

interface UseInputHistoryOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** 输入模式：normal / shell 分轨（官方同款） */
  mode: 'normal' | 'shell'
  /**
   * 召回当前会话/工作区的持久化草稿（usePersistedDraft）。
   * 空输入按 ↑ 时先注入草稿（当作「当前行」），继续 ↑ 才进入已发送历史；
   * ↓ 越过最新一条历史时回到草稿。
   */
  recallDraft?: () => HistoryEntry | null
  /**
   * 会话内历史（当前会话已发送的用户输入，最新在前）。
   * 非空时替代全局历史；空数组/不传时回退全局持久化历史。
   */
  sessionEntries?: PromptHistoryEntry[] | null
}

interface UseInputHistoryReturn {
  /**
   * 在 handleKeyDown 中调用：处理 ArrowUp/ArrowDown 历史导航。
   * 若已处理返回 { text, attachments }（调用方应用到 state），否则返回 null。
   */
  handleHistoryKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    text: string,
    attachments: Attachment[],
  ) => { text: string; attachments: Attachment[]; cursor: 'start' | 'end' } | null
  /**
   * 在 handleChange 中调用：文本变化时检测是否应退出历史模式。
   */
  handleHistoryChange: (newText: string) => void
  /** 重置历史索引（发送消息后调用） */
  resetHistoryIndex: () => void
}

export function useInputHistory({ textareaRef, mode, recallDraft, sessionEntries }: UseInputHistoryOptions): UseInputHistoryReturn {
  // store 条目最新在前；导航时下标 0 = 最新一条
  const storeEntries = usePromptHistory(mode)
  // 会话内历史优先（该会话发过的输入）；没有时回退全局「最近输入」
  const effectiveEntries = sessionEntries && sessionEntries.length > 0 ? sessionEntries : storeEntries
  const historyRef = useRef(effectiveEntries)
  useEffect(() => {
    historyRef.current = effectiveEntries
  }, [effectiveEntries])

  const recallDraftRef = useRef(recallDraft)
  useEffect(() => {
    recallDraftRef.current = recallDraft
  }, [recallDraft])

  // -1 = 未进入历史模式，0 = 最新一条，往上递增
  const historyIndexRef = useRef(-1)
  // 进入历史前暂存用户的输入
  const savedInputRef = useRef<HistoryEntry>({ text: '', attachments: [] })
  // ↑ 召回的持久化草稿：作为「当前行」，在它之上再按 ↑ 进入已发送历史
  const draftLineRef = useRef<HistoryEntry | null>(null)

  const resetHistoryIndex = useCallback(() => {
    historyIndexRef.current = -1
    draftLineRef.current = null
  }, [])

  // Attachment（运行时）与 HistoryAttachment（持久化序列化形态）结构不同，
  // 比较只依赖共有字段 type/displayName（与改动前的内联比较一致）
  const attachmentsMatch = (
    a: readonly { type: string; displayName: string }[],
    b: readonly { type: string; displayName: string }[],
  ) => a.length === b.length && a.every((item, i) => item.type === b[i].type && item.displayName === b[i].displayName)

  const handleHistoryKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      text: string,
      attachments: Attachment[],
    ): { text: string; attachments: Attachment[]; cursor: 'start' | 'end' } | null => {
      const history = historyRef.current

      const canNavigateHistoryAtCursor = (direction: 'up' | 'down', inHistory: boolean) => {
        const ta = textareaRef.current
        if (!ta) return false
        if (ta.selectionStart !== ta.selectionEnd) return false

        const cursor = ta.selectionStart
        const atStart = cursor === 0
        const atEnd = cursor === ta.value.length

        if (inHistory) {
          return atStart || atEnd
        }

        if (direction === 'up') {
          return atStart && ta.value.length === 0
        }

        return atEnd
      }

      // 检查历史内容是否未被用户修改
      const isHistoryUnmodified = () => {
        if (historyIndexRef.current < 0) return false
        const entry = history[historyIndexRef.current]
        if (!entry || text !== entry.text) return false
        return attachmentsMatch(attachments, entry.attachments)
      }

      // 当前内容是否就是 ↑ 召回的草稿且未被修改
      const isDraftLineUnmodified = () => {
        const draft = draftLineRef.current
        if (!draft || historyIndexRef.current >= 0) return false
        return text === draft.text && attachmentsMatch(attachments, draft.attachments)
      }

      const entryAt = (index: number): HistoryEntry => {
        const entry = history[index]
        return { text: entry.text, attachments: entry.attachments.map(fromHistoryEntry) }
      }

      if (e.key === 'ArrowUp') {
        const inHistory = historyIndexRef.current >= 0
        const isEmpty = text.trim() === '' && attachments.length === 0

        // 空输入先召回持久化草稿（当作当前行），再 ↑ 才进入已发送历史
        if (!inHistory && isEmpty && canNavigateHistoryAtCursor('up', false)) {
          const draft = recallDraftRef.current?.()
          if (draft && (draft.text.trim() !== '' || draft.attachments.length > 0)) {
            e.preventDefault()
            draftLineRef.current = draft
            savedInputRef.current = draft
            return { text: draft.text, attachments: draft.attachments, cursor: 'end' }
          }
        }

        const onDraftLine = isDraftLineUnmodified()
        const canRecallHistory = inHistory ? isHistoryUnmodified() : isEmpty || onDraftLine

        if (canRecallHistory && history.length > 0 && canNavigateHistoryAtCursor('up', inHistory || onDraftLine)) {
          e.preventDefault()
          if (!inHistory) {
            savedInputRef.current = draftLineRef.current ?? { text, attachments: [...attachments] }
          }
          draftLineRef.current = null
          const nextIndex = Math.min(historyIndexRef.current + 1, history.length - 1)
          if (nextIndex !== historyIndexRef.current) {
            historyIndexRef.current = nextIndex
            return { ...entryAt(nextIndex), cursor: 'start' }
          }
        }
      }

      if (e.key === 'ArrowDown' && historyIndexRef.current >= 0) {
        if (canNavigateHistoryAtCursor('down', true) && isHistoryUnmodified()) {
          e.preventDefault()
          const nextIndex = historyIndexRef.current - 1
          historyIndexRef.current = nextIndex
          if (nextIndex < 0) {
            return { text: savedInputRef.current.text, attachments: savedInputRef.current.attachments, cursor: 'end' }
          }
          return { ...entryAt(nextIndex), cursor: 'end' }
        }
      }

      return null
    },
    [textareaRef],
  )

  const handleHistoryChange = useCallback((newText: string) => {
    if (draftLineRef.current && newText !== draftLineRef.current.text) {
      draftLineRef.current = null
    }
    if (historyIndexRef.current >= 0) {
      const history = historyRef.current
      const currentEntry = history[historyIndexRef.current]
      if (!currentEntry || newText !== currentEntry.text) {
        historyIndexRef.current = -1
      }
    }
  }, [])

  return {
    handleHistoryKeyDown,
    handleHistoryChange,
    resetHistoryIndex,
  }
}
