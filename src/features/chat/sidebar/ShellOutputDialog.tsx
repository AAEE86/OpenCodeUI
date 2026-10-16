// ============================================
// ShellOutputDialog — 后台 shell 的输出查看弹窗
//
// 回答「这个后台 shell 在跑什么」：
// - 输出实时跟随（followShellOutput 游标轮询，和转写里 shell 卡片同款通道）
// - 状态随库存刷新（shellInventoryStore：running/exited/timeout/killed + 退出码）
// - 运行中可停止（shell.remove，官方 session-running-menu 的 × 同款）
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShellInfo } from '@opencode/client/promise'
import { Button, Dialog } from '../../../components/ui'
import { removeShell } from '../../../api/shell'
import { shellInventoryStore, useShellsForDir } from '../../../store/shellInventoryStore'
import { followShellOutput } from '../../message/shellOutput'
import { uiErrorHandler } from '../../../utils'

interface ShellOutputDialogProps {
  /** 打开时的 shell（状态以库存里的最新值为准） */
  shell: ShellInfo
  /** shell 所在工作区目录（库存/输出/停止都按目录路由） */
  directory?: string
  onClose: () => void
  serverId?: string
}

export function ShellOutputDialog({ shell, directory, onClose, serverId }: ShellOutputDialogProps) {
  const { t } = useTranslation(['commands', 'common'])
  const [output, setOutput] = useState('')
  const [stopping, setStopping] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  // 状态以库存最新值为准（exited/退出码会随后台刷新到达；被 remove 后回落到传入快照）
  const inventory = useShellsForDir(directory)
  const live = useMemo(
    () => inventory.find(item => item.id === shell.id) ?? shell,
    [inventory, shell],
  )
  const running = live.status === 'running'

  // 实时输出跟随（游标增量；组件卸载即停）
  useEffect(() => {
    return followShellOutput({
      id: shell.id,
      directory,
      serverId,
      running: true,
      onOutput: setOutput,
    })
  }, [shell.id, directory, serverId])

  // 新输出自动滚到底
  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  const handleStop = async () => {
    if (stopping) return
    setStopping(true)
    try {
      await removeShell(shell.id, directory, serverId)
      shellInventoryStore.requestRefresh()
    } catch (e) {
      uiErrorHandler('stop shell', e)
    } finally {
      setStopping(false)
    }
  }

  const statusLabel = t(`sessions.shell.status.${live.status}`)
  const statusColor = running ? 'text-success-100' : live.status === 'exited' && live.exit === 0 ? 'text-text-400' : 'text-warning-100'

  return (
    <Dialog isOpen onClose={onClose} title={live.command} width={640} ariaLabel={t('sessions.shell.outputTitle')}>
      <div className="flex flex-col gap-3">
        {/* 状态行：状态 + 退出码 + cwd */}
        <div className="flex items-center gap-2 text-[length:var(--fs-sm)]">
          <span className={`shrink-0 font-medium ${statusColor}`}>{statusLabel}</span>
          {typeof live.exit === 'number' && (
            <span className="shrink-0 text-text-400">{t('sessions.shell.exitCode', { code: live.exit })}</span>
          )}
          <span className="min-w-0 flex-1 truncate text-text-500" title={live.cwd}>
            {live.cwd}
          </span>
          {running && (
            <Button variant="danger" size="sm" isLoading={stopping} onClick={() => void handleStop()} className="shrink-0">
              {t('sessions.shell.stop')}
            </Button>
          )}
        </div>

        {/* 输出：等宽 + 跟随滚动 */}
        <pre
          ref={outputRef}
          className="max-h-[50vh] min-h-32 overflow-auto custom-scrollbar rounded-lg bg-bg-000 border border-border-200/50 p-3 text-[length:var(--fs-sm)] leading-relaxed text-text-200 whitespace-pre-wrap break-all"
        >
          {output || <span className="text-text-500">{t('sessions.shell.emptyOutput')}</span>}
        </pre>
      </div>
    </Dialog>
  )
}
