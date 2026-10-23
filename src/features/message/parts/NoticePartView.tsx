// ============================================
// 提示行（官方 session-ui timeline 的 Notice 行）
//
// 模型 / agent / 工作目录切换、skill 激活、系统指令更新、synthetic 上下文，
// 在官方 UI 里都以「横线 + 中间标签」的分隔行出现（和压缩分隔线同款）。
// 默认关闭，可在设置里打开。
// ============================================

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { TimelineSeparator } from './SystemPartViews'

/** 以提示行形式渲染的消息（官方 projection.ts 的 isNotice 分支） */
export type NoticeMessage = Extract<
  SessionMessageInfo,
  { type: 'synthetic' | 'system' | 'skill' | 'agent-switched' | 'model-switched' | 'location-switched' }
>

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

  let label: string | null = null

  switch (message.type) {
    case 'model-switched':
      label = message.model.variant
        ? t('notice.modelSwitchedVariant', { model: message.model.id, variant: message.model.variant })
        : t('notice.modelSwitched', { model: message.model.id })
      break

    case 'location-switched':
      label = t('notice.movedTo', { directory: message.location.directory })
      break

    case 'agent-switched':
      label = message.previous
        ? t('notice.agentChangedDetail', {
            previous: capitalizeAgent(message.previous),
            agent: capitalizeAgent(message.agent),
          })
        : t('notice.agentChangedTo', { agent: capitalizeAgent(message.agent) })
      break

    case 'skill':
      label = t('notice.skillActivated', { name: message.name })
      break

    case 'system': {
      const sources = instructionSources(message)
      label = sources
        ? t('notice.instructionsUpdatedDetail', { sources: sources.join(', ') })
        : (message.description ?? message.text)
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
          source === 'shell' ? t('notice.actorShell') : (metadataString(metadata, 'agent') ?? t('notice.actorAgent'))
        const state = metadata?.['state']
        const outcome =
          state === 'error'
            ? t('notice.failed', { actor })
            : state === 'cancelled'
              ? t('notice.cancelled', { actor })
              : t('notice.finished', { actor })
        label = message.description ? `${outcome} · ${message.description}` : outcome
        break
      }

      label = message.description ?? message.text
      break
    }
  }

  if (!label?.trim()) return null
  return <TimelineSeparator label={label} />
})

/** 服务端已接收、尚未开始的压缩（官方 CompactionQueued 行） */
export const CompactionQueuedView = memo(function CompactionQueuedView() {
  const { t } = useTranslation('message')
  return (
    <div data-component="session-compaction-message">
      <TimelineSeparator label={t('notice.compactionQueued')} />
    </div>
  )
})
