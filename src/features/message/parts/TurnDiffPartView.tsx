// ============================================
// 回合文件变更摘要（官方 timeline 的 TurnDiff 行）
//
// 以卡片形式挂在回合正文末尾（step 信息之前），默认收起成一行。
// 展开后列出文件；点某个文件再内联展开 diff。
// 默认关闭，可在设置里打开。
// ============================================

import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, GitDiffIcon } from '../../../components/Icons'
import { DiffView } from '../../../components/DiffView'
import { getTurnDiff } from '../../../api/session'
import type { FileDiff } from '../../../api/types'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { chevronClass } from '../messageExpand'
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

function splitPath(file: string): { dir: string; name: string } {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  if (index < 0) return { dir: '', name: file }
  return { dir: file.slice(0, index + 1), name: file.slice(index + 1) }
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
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => new Set())

  // 已缓存的 diff 直接在渲染期取，避免在 effect 里同步 setState
  const loadedDiffs = (fetched?.key === cacheKey ? fetched.diffs : undefined) ?? getCachedTurnDiff(cacheKey) ?? null
  const diffs = diffsProp ?? loadedDiffs

  useEffect(() => {
    // 收起时不请求：历史回合很多，展开哪个才拉哪个
    if (!expanded || !sessionId || diffs) return

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
  }, [cacheKey, diffs, expanded, from, sessionId])

  const allFiles = diffs?.map(diff => diff.file) ?? files
  if (allFiles.length === 0) return null

  const visibleFiles = showAll ? allFiles : allFiles.slice(0, TURN_DIFF_FILE_LIMIT)
  const additions = diffs?.reduce((total, diff) => total + diff.additions, 0)
  const deletions = diffs?.reduce((total, diff) => total + diff.deletions, 0)

  const toggleFile = (file: string) => {
    setOpenFiles(previous => {
      const next = new Set(previous)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  return (
    <div
      className="mt-2 overflow-hidden rounded-lg border border-border-200/60 bg-bg-200/20"
      data-component="turn-diff"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-200/30"
      >
        <GitDiffIcon size={14} className="shrink-0 text-text-400" />
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-200">
          {t('system.filesChanged', { count: allFiles.length })}
        </span>
        {diffs && diffs.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 tabular-nums text-[length:var(--fs-xs)]">
            <span className="rounded bg-success-100/10 px-1.5 py-0.5 text-success-100">+{additions ?? 0}</span>
            <span className="rounded bg-danger-100/10 px-1.5 py-0.5 text-danger-100">-{deletions ?? 0}</span>
          </span>
        )}
        <ChevronDownIcon className={`${chevronClass(expanded)} shrink-0 text-text-400`} />
      </button>

      {expanded && (
        <div className="border-t border-border-200/50">
          <div className="divide-y divide-border-200/40">
            {visibleFiles.map(file => {
              const diff = diffs?.find(item => item.file === file)
              const open = openFiles.has(file)
              const { dir, name } = splitPath(file)
              const status = statusOf(diff)

              if (open && diff?.patch) {
                return (
                  <div key={file} className="bg-bg-100/40 p-2">
                    <DiffView diff={diff.patch} filePath={file} maxHeight={320} defaultCollapsed={false} />
                  </div>
                )
              }

              return (
                <button
                  key={file}
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-200/30"
                  onClick={() => diff && toggleFile(file)}
                  title={file}
                  disabled={!diff}
                >
                  <span
                    className={`w-3 shrink-0 font-mono text-[10px] font-semibold leading-none ${status.className}`}
                    title={diff?.status}
                  >
                    {status.letter}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-xs)]">
                    <span className="text-text-500">{dir}</span>
                    <span className="text-text-200">{name}</span>
                  </span>
                  {diff && (
                    <span className="shrink-0 tabular-nums text-[length:var(--fs-xs)]">
                      <span className="text-success-100">+{diff.additions}</span>{' '}
                      <span className="text-danger-100">-{diff.deletions}</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {allFiles.length > TURN_DIFF_FILE_LIMIT && (
            <button
              type="button"
              className="flex w-full items-center justify-center border-t border-border-200/40 px-3 py-1.5 text-[length:var(--fs-xs)] text-text-500 transition-colors hover:bg-bg-200/30 hover:text-text-300"
              onClick={() => setShowAll(value => !value)}
            >
              {showAll ? t('showLess') : t('showAll')}
            </button>
          )}
        </div>
      )}
    </div>
  )
})
