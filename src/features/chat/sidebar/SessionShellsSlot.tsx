// ============================================
// SessionShellsSlot — 挂在父会话下的后台 shell 子项
//
// 设计（和子会话挂载位同款，ml-3 缩进）：
// - 数据来自 shellInventoryStore（listShells 初始 + shell.started/ended
//   事件重取 + 15s 兜底），按 metadata.sessionID 挂到父会话
// - shell 不是 session：行是专用的（终端图标 + 命令 + running 脉冲点），
//   点击开输出弹窗（ShellOutputDialog），行尾 × 停止
// - shell 退出即消失（完成结果由转写里的 synthetic 消息回流，列表不留尸）
// - 父会话活跃判定由 SessionList 读同一批数据（后台 shell 活着 = 会话活跃）
// ============================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiSession } from '../../../api'
import type { ShellInfo } from '@opencode/client/promise'
import { CloseIcon, TerminalIcon } from '../../../components/Icons'
import { removeShell } from '../../../api/shell'
import { shellInventoryStore, useRunningShellsForSession } from '../../../store/shellInventoryStore'
import { uiErrorHandler } from '../../../utils'
import { ShellOutputDialog } from './ShellOutputDialog'

interface SessionShellsSlotProps {
  parentSession: ApiSession
  /** 父 session 所属服务器（缺省用活动服务器） */
  serverId?: string
}

export function SessionShellsSlot({ parentSession, serverId }: SessionShellsSlotProps) {
  const { t } = useTranslation(['commands'])
  // 打开时存快照：shell 退出后会离开 running 列表，但弹窗不能因为列表刷新被闪关
  //（最新状态由弹窗自己跟库存，exited shell 仍留在库存里）
  const [openShell, setOpenShell] = useState<ShellInfo | null>(null)
  const [stoppingId, setStoppingId] = useState<string | null>(null)

  // shell 按工作区目录隔离：挂到哪取哪，目录即会话的 location.directory
  const directory = parentSession.location?.directory
  const shells = useRunningShellsForSession(parentSession.id, directory)

  const handleStop = async (e: React.MouseEvent, shellId: string) => {
    e.stopPropagation()
    if (stoppingId) return
    setStoppingId(shellId)
    try {
      await removeShell(shellId, directory, serverId)
      shellInventoryStore.requestRefresh()
    } catch (err) {
      uiErrorHandler('stop shell', err)
    } finally {
      setStoppingId(null)
    }
  }

  // 注意：弹窗不能放在 shells.length === 0 的早退之后——shell 退出会离开 running 列表，
  // 但打开中的弹窗靠快照继续展示（状态由弹窗自己跟库存）
  return (
    <>
      {shells.length > 0 && (
        <div className="ml-3">
          {shells.map(shell => (
            <div
              key={shell.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenShell(shell)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpenShell(shell)
                }
              }}
              title={shell.command}
              className="group flex items-center gap-2 px-2 py-1.5 cursor-default rounded-md text-text-400 hover:bg-bg-200/40 hover:text-text-300 transition-colors duration-150 select-none"
            >
              {/* running 脉冲点（和会话活跃标识同款） */}
              <span className="relative shrink-0 flex items-center justify-center size-5">
                <span className="absolute w-1.5 h-1.5 rounded-full bg-success-100" />
                <span className="absolute w-1.5 h-1.5 rounded-full bg-success-100 animate-ping opacity-50" />
              </span>
              <TerminalIcon size={12} className="shrink-0 text-text-500" />
              <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{shell.command}</span>
              <button
                type="button"
                onClick={e => void handleStop(e, shell.id)}
                disabled={stoppingId === shell.id}
                title={t('sessions.shell.stopTitle')}
                aria-label={t('sessions.shell.stopTitle')}
                className="shrink-0 p-0.5 rounded text-text-500 hover:text-text-200 hover:bg-bg-300/60 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {openShell && (
        <ShellOutputDialog shell={openShell} directory={directory} onClose={() => setOpenShell(null)} serverId={serverId} />
      )}
    </>
  )
}
