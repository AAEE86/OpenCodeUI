// ============================================
// 回合文件变更摘要（官方 timeline 的 TurnDiff 行）
//
// 默认收起成一行「N 个文件变更」，点开才列文件、再点文件看 diff。
// 官方是列表常驻，这里按本项目的信息流密度收了一级，避免每轮都铺一屏。
// 默认关闭，可在设置里打开。
// ============================================

import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon } from '../../../components/Icons'
import { DiffView } from '../../../components/DiffView'
import { getTurnDiff } from '../../../api/session'
import type { FileDiff } from '../../../api/types'
import { useUiDisclosureState } from '../../../utils/uiDisclosureState'
import { chevronClass } from '../messageExpand'

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

/** 会话内跨虚拟行复用已拉到的 diff（只留最近若干轮，避免补丁长期占内存） */
const turnDiffCache = new Map<string, FileDiff[]>()
const MAX_CACHED_TURN_DIFFS = 50

function cacheTurnDiff(key: string, diffs: FileDiff[]) {
  turnDiffCache.set(key, diffs)
  while (turnDiffCache.size > MAX_CACHED_TURN_DIFFS) {
    const oldest = turnDiffCache.keys().next().value
    if (oldest === undefined) break
    turnDiffCache.delete(oldest)
  }
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
  const [expanded, setExpanded] = useUiDisclosureState(stateKey ?? `turn-diff:${cacheKey}`, defaultExpanded ?? false)
  const [fetched, setFetched] = useState<{ key: string; diffs: FileDiff[] } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => new Set())

  // 已缓存的 diff 直接在渲染期取，避免在 effect 里同步 setState
  const loadedDiffs = (fetched?.key === cacheKey ? fetched.diffs : undefined) ?? turnDiffCache.get(cacheKey) ?? null
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
    <div className="flex min-w-0 flex-col gap-1 px-3 py-1" data-component="turn-diff">
      <div className="flex min-w-0 items-center gap-2 text-[length:var(--fs-sm)]">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-text-400 hover:text-text-200"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <ChevronDownIcon className={chevronClass(expanded)} />
          <span className="truncate tabular-nums">
            {t('system.filesChanged', { count: allFiles.length })}
          </span>
        </button>
        {diffs && diffs.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            <span className="text-success-100">+{additions ?? 0}</span>
            <span className="text-danger-100">-{deletions ?? 0}</span>
          </span>
        )}
      </div>

      {expanded && (
        <>
          <div className="flex flex-col">
            {visibleFiles.map(file => {
              const diff = diffs?.find(item => item.file === file)
              const open = openFiles.has(file)
              return (
                <div key={file} className="min-w-0">
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-[length:var(--fs-sm)] text-text-400 hover:text-text-200"
                    onClick={() => diff && toggleFile(file)}
                    title={file}
                  >
                    <ChevronDownIcon className={`${chevronClass(open)} shrink-0 ${diff ? '' : 'invisible'}`} />
                    <span className="min-w-0 flex-1 truncate">{file}</span>
                    {diff && (
                      <span className="shrink-0 tabular-nums">
                        <span className="text-success-100">+{diff.additions}</span>{' '}
                        <span className="text-danger-100">-{diff.deletions}</span>
                      </span>
                    )}
                  </button>
                  {open && diff?.patch && (
                    <div className="pb-2">
                      <DiffView diff={diff.patch} filePath={file} maxHeight={320} defaultCollapsed={false} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {allFiles.length > TURN_DIFF_FILE_LIMIT && (
            <button
              type="button"
              className="self-start text-[length:var(--fs-xs)] text-text-500 hover:text-text-300"
              onClick={() => setShowAll(value => !value)}
            >
              {showAll ? t('showLess') : t('showAll')}
            </button>
          )}
        </>
      )}
    </div>
  )
})
