import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RetryIcon, ChevronDownIcon } from '../../../components/Icons'
import { CopyButton } from '../../../components/ui'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import { useDisclosureScrollLock } from '../../../hooks'
import { useNow } from '../../../hooks/useNow'
import { useTheme } from '../../../hooks/useTheme'
import type { SessionMessageAssistant, SessionMessageCompaction, SessionMessageInfo } from '@opencode/client/promise'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { unwrapErrorMessage } from '../../../utils/errorMessage'
import { chevronClass, MessageExpandPanel, useMessageExpandRender } from '../messageExpand'
import { ForkActionButton, UndoActionButton, useMessageActionBarClass } from '../MessageActionBar'
import { StepFinishPartView, type StepFinishInfo } from './StepFinishPartView'

// ============================================
// Retry Part View - 显示重试状态
// ============================================

/**
 * v2 的重试信息挂在**助手消息**上（`message.retry`），不是独立 part：
 * `{ attempt, at, error: { type, message, status?, response? } }`
 */
export type RetryInfo = NonNullable<SessionMessageAssistant['retry']>

interface RetryPartViewProps {
  retry: RetryInfo
  /** 展开状态 key（同一消息多次重试时区分） */
  stateKey?: string
}

/** 429/5xx 这类瞬时错误视为可重试（v2 错误里没有 isRetryable 字段） */
function isRetryableStatus(error: RetryInfo['error']): boolean {
  return error.status == null || error.status === 429 || error.status >= 500
}

export const RetryPartView = memo(function RetryPartView({ retry, stateKey }: RetryPartViewProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useUiDisclosureState(stateKey ?? 'message:retry', false)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const { attempt, error, at } = retry
  const now = useNow(250)

  // `at` 是下一次重试的绝对时间戳（与官方 session-retry.tsx 的 `next - Date.now()` 一致）。
  // 超过 10 分钟视为数据异常（旧版本/脏数据），宁可不显示倒计时。
  const remainingMs = at - now
  const showCountdown = remainingMs > 0 && remainingMs <= 10 * 60_000
  const info = showCountdown
    ? t('system.retryWaiting', { attempt, seconds: Math.ceil(remainingMs / 1000) })
    : t('system.retryNow', { attempt })

  const isRetryable = isRetryableStatus(error)

  return (
    <div ref={rootRef} className="px-3 py-2 rounded-md bg-warning-100/10 border border-warning-100/20">
      <button
        type="button"
        ref={headerRef}
        onClick={() => withScrollLock(() => setExpanded(!expanded))}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-transparent border-none p-0 text-left"
      >
        <RetryIcon className="w-4 h-4 text-warning-100 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[length:var(--fs-base)] text-warning-100">{info}</span>
          {error.message && (
            <span className="block truncate text-[length:var(--fs-sm)] text-text-500">
              {unwrapErrorMessage(error.message)}
            </span>
          )}
        </div>
        {isRetryable && (
          <span className="text-[length:var(--fs-xxs)] text-warning-100/70 bg-warning-100/10 px-1.5 py-0.5 rounded">
            {t('system.retryable')}
          </span>
        )}
        <ChevronDownIcon className={chevronClass(expanded)} />
      </button>

      <MessageExpandPanel open={expanded} variant="fade" innerClassName="overflow-hidden">
        {shouldRenderBody && (
          <div className="mt-2 pt-2 border-t border-warning-100/20">
            <p className="text-[length:var(--fs-sm)] text-text-300 font-mono whitespace-pre-wrap break-words overflow-x-hidden">
              {unwrapErrorMessage(error.message)}
            </p>
            {error.status != null && (
              <p className="text-[length:var(--fs-xxs)] text-text-500 mt-1">
                {t('system.statusCode', { code: error.status })}
              </p>
            )}
          </div>
        )}
      </MessageExpandPanel>
    </div>
  )
})

// ============================================
// Compaction Message View - 显示上下文压缩
// ============================================
//
// v2 的压缩是**独立消息**（`{ type:'compaction', status, summary, ... }`），
// 不是挂在用户消息上的 part。

interface CompactionPartViewProps {
  /** 原生压缩消息（`status` / `summary` / `tokens` / `error` …） */
  message: SessionMessageCompaction
  onUndo?: (messageId: string) => void
  onFork?: (message: SessionMessageInfo, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  canUndo?: boolean
}

/** 官方 TimelineSeparator 同款：细分隔线 + 中间标签 */
function Separator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-500">
      <span className="flex-1 h-px bg-border-200/70" />
      <span className="shrink-0 text-[length:var(--fs-xs)] leading-none text-text-400">{label}</span>
      <span className="flex-1 h-px bg-border-200/70" />
    </div>
  )
}

/** 官方 Intl.NumberFormat compact 同款（1 位小数） */
function compactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/**
 * 压缩消息视图：单标识 + 可收起。
 * - 头部是唯一分隔线：running 时显示"开始压缩上下文"，结束后变成"结果 · 用量"，
 *   不再额外渲染第二条结果分隔线，也不显示流式中的转圈指示。
 * - 摘要内容可点击头部收起/展开；流式输出结束后默认自动收起（设置里可关）。
 */
export const CompactionPartView = memo(function CompactionPartView({
  message,
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
}: CompactionPartViewProps) {
  const { t, i18n } = useTranslation('message')
  const { compactionAutoCollapse } = useTheme()
  const actionBarClass = useMessageActionBarClass()
  const isRunning = message.status === 'running'
  const isFailed = message.status === 'failed'
  const summary = isFailed ? '' : message.summary

  // 压缩请求自身的用量（官方 usage 同款：completed/failed 才显示）
  const usage = (() => {
    if (isRunning) return ''
    const tokens = message.tokens
    if (!tokens) return ''
    const input = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
    const output = (tokens.output ?? 0) + (tokens.reasoning ?? 0)
    if (input + output <= 0) return ''
    return t('system.compactionUsage', {
      input: compactNumber(input, i18n.language),
      output: compactNumber(output, i18n.language),
    })
  })()

  // 结果标签（官方 outcome 同款）
  const outcome = (() => {
    if (!isFailed) {
      const providerContext = message.status === 'completed' ? message.providerContext : undefined
      return providerContext ? t('system.providerCompaction') : t('system.contextCompacted')
    }
    const errorType = message.error?.type
    if (errorType === 'aborted') return t('system.compactionCancelled')
    if (errorType === 'compaction.interrupted') return t('system.compactionInterrupted')
    return t('system.compactionFailed')
  })()

  const outcomeLabel = [outcome, usage].filter(Boolean).join(' · ')
  // 失败原因（aborted/interrupted 不显示错误详情，官方同款）
  const failureDetail = (() => {
    if (!isFailed) return ''
    const errorType = message.error?.type
    if (errorType === 'aborted' || errorType === 'compaction.interrupted') return ''
    return message.error?.message ?? ''
  })()

  // 唯一标识：running 时是"开始压缩上下文"，结束后变成"结果 · 用量"
  const headerLabel = isRunning ? t('system.compactionStarted') : outcomeLabel
  const hasContent = !!(summary.trim() || failureDetail)

  // step 完成信息（对齐助手消息）：model + tokens + cost。
  // 注意 v2 压缩消息只记录 time.created（官方不持久化完成时间），
  // 所以助手那种"耗时 / 完成时刻"没有数据，这里不显示。
  const stepFinish = ((): StepFinishInfo | undefined => {
    if (isRunning) return undefined
    const tokens = message.tokens
    const cost = message.cost ?? 0
    if (!tokens && cost <= 0) return undefined
    return {
      tokens: {
        input: tokens?.input ?? 0,
        output: tokens?.output ?? 0,
        reasoning: tokens?.reasoning ?? 0,
        cache: { read: tokens?.cache?.read ?? 0, write: tokens?.cache?.write ?? 0 },
      },
      cost,
    }
  })()
  const stepFinishModel = message.status === 'completed' ? message.model?.id : undefined

  // 收起状态：running 时展开看流式；结束后默认收起（可在设置里关掉自动收起）
  const stateKey = `message:compaction:${message.id}`
  const [expanded, setExpanded] = useUiDisclosureState(stateKey, isRunning || !compactionAutoCollapse)
  const shouldRenderBody = useMessageExpandRender(expanded)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()

  // 流式结束（running → done）自动收起；respectUser 尊重用户手动展开/收起
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = isRunning
    if (wasRunning && !isRunning && compactionAutoCollapse) {
      setExpanded(false, { touched: false, respectUser: true })
    }
  }, [isRunning, compactionAutoCollapse, setExpanded])

  // 无内容可收起（如 aborted 空消息）→ 纯分隔线
  if (!hasContent) {
    return (
      <div data-component="session-compaction-message">
        <Separator label={headerLabel} />
      </div>
    )
  }

  return (
    <div data-component="session-compaction-message" ref={rootRef} className="group">
      <button
        type="button"
        ref={headerRef}
        onClick={() => withScrollLock(() => setExpanded(!expanded))}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-transparent border-none p-0 text-left"
      >
        <span className="flex-1 h-px bg-border-200/70" />
        <span className="shrink-0 px-3 py-1.5 text-[length:var(--fs-xs)] leading-none text-text-400">{headerLabel}</span>
        <ChevronDownIcon className={chevronClass(expanded, 'sm')} />
        <span className="flex-1 h-px bg-border-200/70" />
      </button>

      <MessageExpandPanel open={expanded} variant="fade" innerClassName="overflow-hidden">
        {shouldRenderBody && (
          <>
            {summary.trim() && (
              <div className="px-3 pb-1 text-text-300">
                <MarkdownRenderer content={summary} isStreaming={isRunning} />
              </div>
            )}
            {failureDetail && (
              <div className="px-3 pb-1 text-[length:var(--fs-sm)] text-danger-100">{failureDetail}</div>
            )}
          </>
        )}
      </MessageExpandPanel>

      {/* step 完成信息（model + tokens + cost），与助手消息一致：内容下方、始终显示 */}
      {stepFinish && (
        <div className="px-3">
          <StepFinishPartView part={stepFinish} modelLabel={stepFinishModel} />
        </div>
      )}

      {/* 操作条：undo / 分叉 / 复制，在 step 信息下面（与助手消息同一逻辑，悬浮显现） */}
      {!isRunning && (onUndo || onFork || summary.trim()) && (
        <div className={`px-3 pb-1 ${actionBarClass}`}>
          <UndoActionButton messageId={message.id} onUndo={onUndo} canUndo={canUndo} />
          <ForkActionButton message={message} onFork={onFork} forkMessageId={forkMessageId} />
          {summary.trim() && <CopyButton text={summary} position="static" />}
        </div>
      )}
    </div>
  )
})
