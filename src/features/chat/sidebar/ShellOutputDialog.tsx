// ============================================
// ShellOutputDialog — 后台 shell 的输出查看弹窗
//
// UI 直接复用信息流里的 shell 工具卡（ToolPartView）：
// 把 ShellInfo + 实时输出投影成 ToolViewPart，和 ShellMessageView
// （`!` shell 命令消息）同款投影逻辑——running 展开跟输出，
// 结束后折叠、点头行展开，交互与信息流完全一致。
// 卡片不管的事弹窗自己补：cwd 展示 + 停止按钮（shell.remove）。
// ============================================

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JsonValue, ShellInfo } from '@opencode/client/promise'
import { Button, Dialog } from '../../../components/ui'
import { removeShell } from '../../../api/shell'
import { shellInventoryStore, useShellsForDir } from '../../../store/shellInventoryStore'
import { followShellOutput } from '../../message/shellOutput'
import { ToolPartView } from '../../message/parts'
import type { ToolViewPart } from '../../message/tools'
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
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const [output, setOutput] = useState('')
  const [stopping, setStopping] = useState(false)

  // 状态以库存最新值为准（exited/退出码会随后台刷新到达；被 remove 后回落到传入快照）
  const inventory = useShellsForDir(directory)
  const live = useMemo(() => inventory.find(item => item.id === shell.id) ?? shell, [inventory, shell])
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

  // ShellInfo → ToolViewPart 投影（ShellMessageView 同款：
  // input=command、output=输出文本、metadata 带 shellID/exit）
  const part = useMemo<ToolViewPart>(() => {
    const input = { command: live.command }
    const metadata: Record<string, JsonValue> = { shellID: live.id }
    let state: ToolViewPart['state']
    if (live.status === 'running') {
      state = {
        status: 'running',
        input,
        metadata: output ? { ...metadata, output } : metadata,
      }
    } else if (live.status === 'timeout' || live.status === 'killed') {
      state = {
        status: 'error',
        input,
        error: {
          type: 'ShellError',
          message: t(live.status === 'timeout' ? 'chat:shellMessage.timeout' : 'chat:shellMessage.killed'),
        },
        ...(output ? { content: [{ type: 'text' as const, text: output }] } : {}),
        metadata,
      }
    } else {
      if (typeof live.exit === 'number') metadata.exit = live.exit
      state = {
        status: 'completed',
        input,
        content: [{ type: 'text' as const, text: output }],
        metadata,
      }
    }
    return {
      type: 'tool',
      id: live.id,
      name: 'shell',
      // messageID 用 shell.id：折叠状态 key（message:<mid>:tool:<id>）与信息流里
      // 的同 shell 卡片（mid=消息 id）天然隔开，两边展开状态互不影响
      messageID: live.id,
      state,
      time: { created: live.time.started, completed: live.time.completed },
    }
  }, [live, output, t])

  return (
    <Dialog isOpen onClose={onClose} title={t('commands:sessions.shell.outputTitle')} width={640} ariaLabel={t('commands:sessions.shell.outputTitle')}>
      <div className="flex flex-col gap-3">
        {/* 信息流沉浸模式同款 shell 工具卡：头行（名称+命令+耗时）+ 输出体 */}
        <ToolPartView
          part={part}
          context={{ messageID: live.id, created: live.time.started, completed: live.time.completed }}
          descriptive
          isFirst
          isLast
        />

        {/* 卡片不管的：cwd + 退出码 + 停止 */}
        <div className="flex items-center gap-2 text-[length:var(--fs-sm)]">
          {typeof live.exit === 'number' && (
            <span className={`shrink-0 ${live.exit === 0 ? 'text-text-400' : 'text-warning-100'}`}>
              {t('commands:sessions.shell.exitCode', { code: live.exit })}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-text-500" title={live.cwd}>
            {live.cwd}
          </span>
          {running && (
            <Button variant="danger" size="sm" isLoading={stopping} onClick={() => void handleStop()} className="shrink-0">
              {t('commands:sessions.shell.stop')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
