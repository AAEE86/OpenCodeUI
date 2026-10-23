// ============================================
// 提示行（官方 session-ui timeline 的 Notice 行）
//
// 模型 / agent / 工作目录切换、skill 激活、系统指令更新、synthetic 上下文，
// 在官方 UI 里都是以细提示行的形式插在会话流里。它们本身不是正文，但少了
// 它们就会觉得"信息流缺了一段"（尤其是压缩前后、切换模型之后）。
// ============================================

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMessageInfo } from '@opencode/client/promise'

/** 以提示行形式渲染的消息（官方 projection.ts 的 isNotice 分支） */
export type NoticeMessage = Extract<
  SessionMessageInfo,
  { type: 'synthetic' | 'system' | 'skill' | 'agent-switched' | 'model-switched' | 'location-switched' }
>

/** 官方 TimelineSeparator 同款：细分隔线 + 中间标签 */
function NoticeSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[length:var(--fs-sm)] text-text-500">
      <span className="flex-1 h-px bg-border-200/70" />
      <span className="shrink-0 max-w-[80%] truncate text-[length:var(--fs-xs)] leading-none text-text-400" title={label}>
        {label}
      </span>
      <span className="flex-1 h-px bg-border-200/70" />
    </div>
  )
}

function capitalizeAgent(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value ? value : undefined
}

/** 官方 system 提示的两种来源：metadata.instructionSources 或 description 前缀 */
function instructionSources(message: Extract<NoticeMessage, { type: 'system' }>): string[] | undefined {
  const metadata = message.metadata as Record<string, unknown> | undefined
  const fromMetadata = metadata?.['instructionSources']
  if (Array.isArray(fromMetadata)) {
    const sources = fromMetadata.filter((item): item is string => typeof item === 'string')
    if (sources.length > 0) return sources
  }

  const prefix = 'Instructions updated: '
  if (message.description?.startsWith(prefix)) {
    const keys = message.description
      .slice(prefix.length)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
    if (keys.length > 0) return keys
  }

  return undefined
}

export const TimelineNoticeView = memo(function TimelineNoticeView({ message }: { message: NoticeMessage }) {
  const { t } = useTranslation('message')

  if (message.type === 'model-switched') {
    const variant = message.model.variant
    return (
      <NoticeSeparator
        label={variant
          ? t('notice.modelSwitchedVariant', { model: message.model.id, variant })
          : t('notice.modelSwitched', { model: message.model.id })}
      />
    )
  }

  if (message.type === 'location-switched') {
    return <NoticeSeparator label={t('notice.movedTo', { directory: message.location.directory })} />
  }

  let label = ''
  let detail: string | undefined
  let items: string[] | undefined

  switch (message.type) {
    case 'agent-switched':
      label = t('notice.agentChanged')
      detail = message.previous
        ? `${capitalizeAgent(message.previous)} → ${capitalizeAgent(message.agent)}`
        : capitalizeAgent(message.agent)
      break

    case 'skill':
      label = t('notice.skill')
      detail = message.name
      break

    case 'system': {
      const sources = instructionSources(message)
      if (sources) {
        label = t('notice.instructionsUpdated')
        items = sources
      } else {
        label = message.description ?? message.text
      }
      break
    }

    case 'synthetic': {
      const metadata = message.metadata as Record<string, unknown> | undefined
      if (metadata?.['notice'] === 'restart' || message.description === 'Continuing after restart') {
        label = t('notice.restart')
        break
      }

      const source = metadata?.['source']
      if (source === 'subagent' || source === 'shell') {
        const actor =
          source === 'shell'
            ? t('notice.actorShell')
            : metadataString(metadata, 'agent') ?? t('notice.actorAgent')
        const state = metadata?.['state']
        label =
          state === 'error'
            ? t('notice.failed', { actor })
            : state === 'cancelled'
              ? t('notice.cancelled', { actor })
              : t('notice.finished', { actor })
        detail = message.description
        break
      }

      label = message.description ?? message.text
      break
    }
  }

  const hasItems = (items?.length ?? 0) > 0
  if (!label && !detail && !hasItems) return null
  const fullText = [label, detail, items?.join(' · ')].filter(Boolean).join(' ')

  return (
    <div
      data-timeline-notice={message.type}
      className="w-full min-w-0 px-3 py-1 text-[length:var(--fs-sm)] leading-relaxed text-text-500"
      title={fullText || undefined}
    >
      <span className="font-medium text-text-400">{label}</span>
      {detail && !hasItems && <span className="ml-2 break-words">{detail}</span>}
      {hasItems && (
        <span className="ml-2 inline-flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 align-top">
          {items!.map(item => (
            <span key={item} className="break-all">{item}</span>
          ))}
        </span>
      )}
    </div>
  )
})

/** 服务端已接收、尚未开始的压缩（官方 CompactionQueued 行） */
export const CompactionQueuedView = memo(function CompactionQueuedView() {
  const { t } = useTranslation('message')
  return (
    <div data-component="session-compaction-message">
      <NoticeSeparator label={t('notice.compactionQueued')} />
    </div>
  )
})
