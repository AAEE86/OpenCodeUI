import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SpinnerIcon, SplitIcon, UndoIcon } from '../../components/Icons'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import type { SessionMessageInfo } from '@opencode/client/promise'

/**
 * 消息操作条（undo / fork / copy）共享样式与按钮。
 *
 * 从 MessageRenderer 抽出来，供 UserMessageView / AssistantMessageView /
 * CompactionPartView 共用——后者不能反向 import MessageRenderer（循环依赖）。
 */

/** PC 精细指针：默认隐藏，悬浮消息/聚焦时显示；触控优先设备始终显示 */
export function useMessageActionBarClass() {
  const { preferTouchUi } = useInputCapabilities()
  return preferTouchUi
    ? 'flex items-center gap-1 transition-opacity'
    : 'flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto focus-within:pointer-events-auto transition-opacity'
}

interface UndoActionButtonProps {
  /** 回退目标消息 id（用户消息或 compaction 等可回退边界） */
  messageId: string
  onUndo?: (messageId: string) => void
  canUndo?: boolean
}

/** 回退到这条消息（revert 边界） */
export const UndoActionButton = memo(function UndoActionButton({ messageId, onUndo, canUndo }: UndoActionButtonProps) {
  const { t } = useTranslation('message')
  if (!canUndo || !onUndo) return null
  return (
    <button
      onClick={() => onUndo(messageId)}
      className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200"
      title={t('undoFromHere')}
      aria-label={t('undoFromHere')}
    >
      <UndoIcon />
    </button>
  )
})

interface ForkActionButtonProps {
  message: SessionMessageInfo
  onFork?: (message: SessionMessageInfo, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
}

export const ForkActionButton = memo(function ForkActionButton({ message, onFork, forkMessageId }: ForkActionButtonProps) {
  const { t } = useTranslation('message')
  const [isForking, setIsForking] = useState(false)

  const handleFork = useCallback(async () => {
    if (!onFork || isForking) return

    setIsForking(true)

    try {
      await onFork(message, forkMessageId)
    } catch {
      // 业务错误由上层统一处理
    } finally {
      setIsForking(false)
    }
  }, [forkMessageId, isForking, message, onFork])

  if (!onFork) return null

  return (
    <button
      onClick={() => void handleFork()}
      disabled={isForking}
      className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200 disabled:cursor-default disabled:text-text-500"
      title={isForking ? t('forkingFromHere') : t('forkFromHere')}
      aria-label={isForking ? t('forkingFromHere') : t('forkFromHere')}
    >
      {isForking ? <SpinnerIcon className="animate-spin" /> : <SplitIcon />}
    </button>
  )
})
