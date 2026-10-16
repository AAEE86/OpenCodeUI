// ============================================
// SessionMoveMenu — 把会话移动到其他目录 / worktree
//
// 对应官方 session/timeline/session-workspace-menu.tsx：
//   - 目标列表 = 项目根（本地）+ 新建 worktree + 现有 worktree
//   - 会话运行中禁止移动（blocked while running）
//   - 成功后服务端发 session.moved，各列表据此增删
//
// 交互是 Dialog（ui/Dialog）：头部触发按钮不变，
// 点开是居中的目标选择弹窗，底部是新建 worktree 区。
// ============================================

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderIcon, GitWorktreeIcon, SpinnerIcon } from '../../components/Icons'
import { Button, Dialog } from '../../components/ui'
import { getCurrentProject, moveSession } from '../../api/client'
import { listWorktreeEntries, createWorktree } from '../../api/worktree'
import { useSessionActiveEntry } from '../../store/activeSessionStore'
import { serverStore } from '../../store/serverStore'
import { makeSessionKey } from '../../utils/sessionKey'
import { isSameDirectory, normalizeToForwardSlash } from '../../utils'
import { uiErrorHandler } from '../../utils'

interface SessionMoveMenuProps {
  /** 会话 id（可为 scoped key） */
  sessionId: string
  /** 会话当前所在目录 */
  directory: string
}

interface MoveTarget {
  directory: string
  label: string
  kind: 'local' | 'worktree'
}

export function SessionMoveMenu({ sessionId, directory }: SessionMoveMenuProps) {
  const { t } = useTranslation(['chat', 'common'])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  /** 正在移入的目标目录（行内 spinner，同时禁用其它行） */
  const [movingTo, setMovingTo] = useState<string | null>(null)
  const [targets, setTargets] = useState<MoveTarget[]>([])
  const [projectID, setProjectID] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // 官方 blocked()：会话运行中禁止移动
  const activeKey = makeSessionKey(serverStore.getActiveServerId(), sessionId)
  const activeEntry = useSessionActiveEntry(activeKey)
  const running = activeEntry?.status.type === 'busy' || activeEntry?.status.type === 'retry'

  const loadTargets = useCallback(async () => {
    setLoading(true)
    try {
      const project = await getCurrentProject(directory || undefined)
      if (!project) {
        setTargets([])
        setProjectID(null)
        return
      }
      setProjectID(project.id)
      const root = normalizeToForwardSlash(project.canonical)
      const current = normalizeToForwardSlash(directory)
      const entries = await listWorktreeEntries(project.id)
      const list: MoveTarget[] = []
      // 本地（项目根）：当前不在根时才列出（官方同款）
      if (!isSameDirectory(root, current)) {
        list.push({ directory: root, label: t('chat:sessionMove.local'), kind: 'local' })
      }
      for (const entry of entries) {
        const dir = normalizeToForwardSlash(entry.directory)
        if (isSameDirectory(dir, current) || isSameDirectory(dir, root)) continue
        list.push({ directory: dir, label: dir.split('/').filter(Boolean).pop() ?? dir, kind: 'worktree' })
      }
      setTargets(list)
    } catch {
      setTargets([])
      setProjectID(null)
    } finally {
      setLoading(false)
    }
  }, [directory, t])

  const handleMove = async (destination: string) => {
    if (movingTo) return
    setMovingTo(destination)
    try {
      await moveSession(sessionId, destination)
      setOpen(false)
      // 列表增删由 session.moved 事件驱动（useSessions）
    } catch (e) {
      uiErrorHandler('move session', e)
    } finally {
      setMovingTo(null)
    }
  }

  const handleCreateAndMove = async () => {
    const name = newName.trim()
    if (!name || !projectID || creating) return
    setCreating(true)
    try {
      const wt = await createWorktree({ projectID, name })
      setNewName('')
      await handleMove(normalizeToForwardSlash(wt.directory))
    } catch (e) {
      uiErrorHandler('create worktree', e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={running || movingTo !== null}
        onClick={e => {
          e.stopPropagation()
          setOpen(true)
          void loadTargets()
        }}
        title={running ? t('chat:sessionMove.runningTitle') : t('chat:sessionMove.title')}
        aria-label={t('chat:sessionMove.title')}
        className="p-1 text-text-400 hover:text-text-100 transition-colors rounded-md hover:bg-bg-300/50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        {movingTo !== null ? <SpinnerIcon size={12} className="animate-spin" /> : <GitWorktreeIcon size={12} />}
      </button>

      <Dialog isOpen={open} onClose={() => setOpen(false)} title={t('chat:sessionMove.title')} width={480}>
        <div className="flex flex-col gap-4">
          {/* 目标列表：项目根 + 现有 worktree */}
          <div className="flex flex-col gap-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-text-400">
                <SpinnerIcon size={14} className="animate-spin" />
              </div>
            ) : targets.length === 0 ? (
              <div className="py-4 text-center text-[length:var(--fs-base)] text-text-400">
                {t('chat:sessionMove.empty')}
              </div>
            ) : (
              targets.map(target => (
                <button
                  key={target.directory}
                  type="button"
                  disabled={movingTo !== null || creating}
                  onClick={() => void handleMove(target.directory)}
                  className="group flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-bg-100/60 transition-colors disabled:opacity-50"
                >
                  {target.kind === 'worktree' ? (
                    <GitWorktreeIcon size={16} className="shrink-0 text-text-400 group-hover:text-text-200" />
                  ) : (
                    <FolderIcon size={16} className="shrink-0 text-text-400 group-hover:text-text-200" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[length:var(--fs-base)] text-text-100 truncate">{target.label}</span>
                    <span className="block text-[length:var(--fs-xs)] text-text-400 truncate" title={target.directory}>
                      {target.directory}
                    </span>
                  </span>
                  {movingTo === target.directory && <SpinnerIcon size={14} className="shrink-0 animate-spin text-text-400" />}
                </button>
              ))
            )}
          </div>

          {/* 新建 worktree 并移入（官方菜单的 "create" 项） */}
          {projectID && (
            <div className="border-t border-border-100/50 pt-4">
              <div className="mb-2 text-[length:var(--fs-sm)] text-text-400">{t('chat:sessionMove.newWorktreeSection')}</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateAndMove()
                    }
                  }}
                  placeholder={t('chat:sessionMove.newWorktreePlaceholder')}
                  disabled={creating || movingTo !== null}
                  className="flex-1 min-w-0 bg-bg-000 border border-border-200 rounded-lg px-3 py-2 text-[length:var(--fs-base)] text-text-100 placeholder:text-text-400/60 focus:outline-none focus:border-accent-main-100/50"
                />
                <Button
                  onClick={() => void handleCreateAndMove()}
                  disabled={!newName.trim() || creating || movingTo !== null}
                  isLoading={creating}
                  className="shrink-0"
                >
                  {t('chat:sessionMove.newWorktree')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
