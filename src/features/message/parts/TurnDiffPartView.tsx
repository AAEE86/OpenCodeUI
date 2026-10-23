// ============================================
// 回合文件变更摘要（官方 timeline 的 TurnDiff 行）
//
// 外层只是一行轻量标题，展开后每个文件直接复用工具卡的 ContentBlock：
// diff 渲染、分栏自适应、全屏里的 ViewModeSwitch、+/- 统计字体全部同源，
// 不再单独造一套 diff / 全屏。
// 默认关闭，可在设置里打开。
// ============================================

import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentBlock } from '../../../components'
import { getTurnDiff } from '../../../api/session'
import type { FileDiff } from '../../../api/types'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { MessageExpandPanel, useMessageExpandRender } from '../messageExpand'
import { cacheTurnDiff, getCachedTurnDiff } from './turnDiffCache'

/** 官方 turnDiffFileLimit 同款：列表默认最多露 5 个文件 */
const TURN_DIFF_FILE_LIMIT = 5

interface TurnDiffPartViewProps {
  /** 带服务器前缀的会话 key（getTurnDiff 内部会拆） */
  sessionId: string | null
  /** 该轮用户消息 id */
  from: string
  /** step 记录到的变更文件（diff 未到时先显示路径） */
  files: string[]
  stateKey?: string
  /** 外部传入的 diff（预览/测试用；提供时不再请求接口） */
  diffs?: FileDiff[]
  /** 预览用：初始是否展开 */
  defaultExpanded?: boolean
}

function statusOf(diff: FileDiff | undefined): { letter: string; className: string } {
  if (!diff) return { letter: '·', className: 'text-text-500' }
  if (diff.status === 'added') return { letter: 'A', className: 'text-success-100' }
  if (diff.status === 'deleted') return { letter: 'D', className: 'text-danger-100' }
  return { letter: 'M', className: 'text-warning-100' }
}

export const TurnDiffPartView = memo(function TurnDiffPartView({
  sessionId,
  from,
  files,
  stateKey,
  diffs: diffsProp,
  defaultExpanded,
}: TurnDiffPartViewProps) {
  const { t } = useTranslation('message')
  const cacheKey = sessionId ? `${sessionId}:${from}` : ''
  const [expanded, setExpanded] = useUiDisclosureState(
    stateKey ?? `turn-diff:${cacheKey}`,
    defaultExpanded ?? false,
  )
  const [fetched, setFetched] = useState<{ key: string; diffs: FileDiff[] } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const shouldRenderBody = useMessageExpandRender(expanded)

  // 已缓存的 diff 直接在渲染期取，避免在 effect 里同步 setState
  const loadedDiffs = (fetched?.key === cacheKey ? fetched.diffs : undefined) ?? getCachedTurnDiff(cacheKey) ?? null
  const diffs = diffsProp ?? loadedDiffs

  useEffect(() => {
    // 收起时也要拉一次：变更量（+N -N）必须在摘要行上直接可见。
    // 每个回合只请求一次，结果进缓存，展开时不再重复请求。
    if (!sessionId || diffs) return

    let cancelled = false
    getTurnDiff(sessionId, from)
      .then(result => {
        cacheTurnDiff(cacheKey, result)
        if (!cancelled) setFetched({ key: cacheKey, diffs: result })
      })
      .catch(() => {
        // 拉取失败时保留路径列表，不影响回放
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey, diffs, from, sessionId])

  const allFiles = diffs?.map(diff => diff.file) ?? files
  if (allFiles.length === 0) return null

  const visibleFiles = showAll ? allFiles : allFiles.slice(0, TURN_DIFF_FILE_LIMIT)
  const additions = diffs?.reduce((total, diff) => total + diff.additions, 0)
  const deletions = diffs?.reduce((total, diff) => total + diff.deletions, 0)

  return (
    <div className="group pt-1" data-component="turn-diff">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group/header flex w-full items-center gap-3 rounded-md px-0 py-1 text-left transition-colors hover:bg-bg-200/30"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
          <span className="shrink-0 text-[length:var(--fs-md)] font-medium leading-tight text-text-200 transition-colors group-hover/header:text-text-100">
            {t('system.filesChanged', { count: allFiles.length })}
          </span>
          {diffs && diffs.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[length:var(--fs-xxs)] font-mono font-medium tabular-nums">
              <span className="text-success-100">+{additions ?? 0}</span>
              <span className="text-danger-100">-{deletions ?? 0}</span>
            </span>
          )}
        </div>
      </button>

      <MessageExpandPanel open={expanded} variant="fade" innerClassName="min-h-0 min-w-0 overflow-hidden">
        {shouldRenderBody && (
          <div className="space-y-1.5 pt-1">
            {visibleFiles.map(file => {
              const diff = diffs?.find(item => item.file === file)
              const status = statusOf(diff)
              return (
                <ContentBlock
                  key={file}
                  label=""
                  hideLabel
                  labelIcon={
                    <span className={`font-mono text-[10px] font-semibold leading-none ${status.className}`}>
                      {status.letter}
                    </span>
                  }
                  filePath={file}
                  showFullPath
                  hideChevron
                  diff={diff?.patch}
                  diffStats={diff ? { additions: diff.additions, deletions: diff.deletions } : undefined}
                  defaultCollapsed
                  stateKey={`turn-diff:${cacheKey}:${file}`}
                />
              )
            })}

            {allFiles.length > TURN_DIFF_FILE_LIMIT && (
              <button
                type="button"
                className="flex w-full items-center justify-center px-3 py-1 text-[length:var(--fs-xs)] text-text-500 transition-colors hover:text-text-300"
                onClick={() => setShowAll(value => !value)}
              >
                {showAll ? t('showLess') : t('showAll')}
              </button>
            )}
          </div>
        )}
      </MessageExpandPanel>
    </div>
  )
})
