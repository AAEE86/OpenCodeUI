// ============================================
// shellInventoryStore — 服务器 shell 库存（后台任务可见性的数据源）
//
// 数据节奏（对齐文件变更面板的事件驱动模式）：
//   - 有订阅者时拉一次初始清单（listShells）
//   - session.shell.started / ended 事件 → 500ms 防抖重取（useGlobalEvents 调 requestRefresh）
//   - 15s 兜底轮询（事件丢失的保险）
// 消费：侧边栏把 running shell 挂载到父会话下（SessionShellsSlot）、
// 父会话活跃判定（后台 shell 活着 = 会话仍活跃）。
// ============================================

import type { ShellInfo } from '@opencode/client/promise'
import { listShells } from '../api/shell'
import { serverStore } from './serverStore'

type Subscriber = () => void

const REFRESH_DEBOUNCE_MS = 500
const FALLBACK_POLL_MS = 15_000

class ShellInventoryStore {
  /** serverId → 该服务器的 shell 清单 */
  private shellsByServer = new Map<string, ShellInfo[]>()
  private version = 0
  private subscribers = new Set<Subscriber>()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private loading = false

  // 箭头属性：useSyncExternalStore(store.subscribe, ...) 直接引用不丢 this
  subscribe = (fn: Subscriber): (() => void) => {
    const wasEmpty = this.subscribers.size === 0
    this.subscribers.add(fn)
    if (wasEmpty) {
      // 第一个订阅者出现：拉初始清单 + 开兜底轮询
      void this.refreshNow()
      this.pollTimer = setInterval(() => void this.refreshNow(), FALLBACK_POLL_MS)
    }
    return () => {
      this.subscribers.delete(fn)
      if (this.subscribers.size === 0) {
        if (this.pollTimer) {
          clearInterval(this.pollTimer)
          this.pollTimer = null
        }
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer)
          this.refreshTimer = null
        }
      }
    }
  }

  getVersion = (): number => this.version

  /** 缺省/空 serverId 归一到活动服务器（调用点不用各自兜底） */
  getShells = (serverId?: string): ShellInfo[] =>
    this.shellsByServer.get(serverId || serverStore.getActiveServerId()) ?? EMPTY_SHELLS

  /** 事件触发（shell.started/ended）：防抖合并连续事件，避免一次回合启动多个 shell 时连打 */
  requestRefresh = () => {
    if (this.subscribers.size === 0) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshNow()
    }, REFRESH_DEBOUNCE_MS)
  }

  private async refreshNow() {
    if (this.loading) return
    this.loading = true
    try {
      const serverId = serverStore.getActiveServerId()
      const list = await listShells(serverId)
      const prev = this.shellsByServer.get(serverId)
      if (!sameShellList(prev, list)) {
        this.shellsByServer.set(serverId, list)
        this.version++
        this.subscribers.forEach(fn => fn())
      }
    } catch {
      // 失败保留旧数据，下一轮再试
    } finally {
      this.loading = false
    }
  }
}

const EMPTY_SHELLS: ShellInfo[] = []

function sameShellList(a: ShellInfo[] | undefined, b: ShellInfo[]): boolean {
  if (!a || a.length !== b.length) return false
  // status/exit 会变，id 集合也会变；command/cwd 不变。逐字段比对太贵，
  // 比 id+status+exit 足够覆盖 running↔exited 流转
  return a.every((shell, i) => shell.id === b[i].id && shell.status === b[i].status && shell.exit === b[i].exit)
}

export const shellInventoryStore = new ShellInventoryStore()

/** 某会话名下仍在运行的 shell（挂载到侧边栏父会话下的数据） */
export function runningShellsForSession(shells: ShellInfo[], rawSessionId: string): ShellInfo[] {
  return shells.filter(shell => shell.status === 'running' && shell.metadata?.sessionID === rawSessionId)
}
