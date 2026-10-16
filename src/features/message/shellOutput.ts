// ============================================
// followShellOutput — 运行中 shell 的实时输出跟随
//
// 逐行移植官方 packages/session-ui/src/tools/shell-output.ts：
//   - 按 shell 记忆进度（游标），虚拟列表频繁重挂载时从游标续读
//   - 只保留最近 64KB 输出（与 TUI 相同的 tail 窗口）
//   - 服务端已丢弃的 shell（not found）永不重试
//   - 仅在 shell 存活期间 1s 轮询；退出时补一次最终快照
// ============================================

import { isShellNotFoundError } from '@opencode/client/promise'
import { getShellOutput } from '../../api/shell'

// 与官方/TUI 相同的尾部窗口；只保留最近这么多输出
export const SHELL_OUTPUT_TAIL_BYTES = 64 * 1024
const PROGRESS_LIMIT = 32

type Progress = { cursor: number; output: string; state: 'partial' | 'complete' | 'missing' }

const progress = new Map<string, Progress>()

function remember(id: string, entry: Progress) {
  progress.delete(id)
  progress.set(id, entry)
  if (progress.size <= PROGRESS_LIMIT) return
  const oldest = progress.keys().next().value
  if (oldest !== undefined) progress.delete(oldest)
}

export function followShellOutput(input: {
  id: string
  directory?: string
  serverId?: string
  running: boolean
  onOutput: (output: string) => void
}): () => void {
  const cached = progress.get(input.id)
  if (cached) {
    remember(input.id, cached)
    input.onOutput(cached.output)
  }
  // missing 的 shell 不会回来；complete 的只在仍认为存活时重读
  //（存活清单可能晚于历史渲染到达）
  if (cached?.state === 'missing' || (cached?.state === 'complete' && !input.running)) return () => {}
  let cursor = cached?.cursor ?? 0
  let text = cached?.output ?? ''
  let loading = false
  let disposed = false
  // ── UTF-8 边界自愈 ──
  // 服务端按字节区间独立 decode（core/shell.ts: buffer.subarray(...).toString('utf8')），
  // 多字节字符被区间边界切开就永久变成 U+FFFD（逐字打印中文的场景必现）。
  // 自愈规则：
  //   1. 页头出现 U+FFFD → 上次「页尾剥离」猜错了回退字节数，游标落在字符中间。
  //      回滚到追加前的存档点，等字符写全后整段重读（存档点一定是干净边界）
  //   2. 页尾出现 U+FFFD → 区间终点切在字符中间：剥掉替换符，游标按每符 1 字节
  //      回退（猜少了会被下一轮的规则 1 抓回来）
  //   3. 输出本身含 U+FFFD 的极端情况：同一位置只自愈一次，再失败原样接受，不死循环
  let savepoint = { cursor, text }
  let recoveredAt = -1
  const read = async () => {
    if (loading) return
    loading = true
    while (true) {
      const page = await getShellOutput(input.id, cursor, input.directory, input.serverId).then(
        response => response,
        (cause: unknown) => (isShellNotFoundError(cause) ? ('missing' as const) : undefined),
      )
      if (disposed) break
      if (page === 'missing') {
        // 服务端过了保留期会丢弃已退出的 shell：别再问了
        remember(input.id, { cursor, output: text, state: 'missing' })
        clearInterval(interval)
        break
      }
      if (!page) break

      // 规则 1：页头替换符 → 游标在字符中间，回滚到存档点整段重读
      if (page.output.startsWith('�') && recoveredAt !== cursor) {
        recoveredAt = cursor
        cursor = savepoint.cursor
        text = savepoint.text
        remember(input.id, { cursor, output: text, state: 'partial' })
        break
      }

      // 规则 2：页尾替换符 → 剥掉，游标按每符 1 字节回退
      let output = page.output
      let pageCursor = page.cursor
      const tail = output.match(/�+$/)
      if (tail) {
        output = output.slice(0, -tail[0].length)
        pageCursor -= tail[0].length
      }

      // 追加前存档（下一轮的页头检查若失败，回滚到这里）
      savepoint = { cursor, text }
      const advanced = pageCursor > cursor
      cursor = Math.max(cursor, pageCursor)
      text = (text + output).slice(-SHELL_OUTPUT_TAIL_BYTES)
      const complete = !input.running && cursor >= page.size
      remember(input.id, { cursor, output: text, state: complete ? 'complete' : 'partial' })
      input.onOutput(text)
      if (input.running || complete || !advanced) break
    }
    loading = false
  }
  void read()
  // 退出时刷新最终快照；只在存活期间轮询
  const interval = input.running ? setInterval(() => void read(), 1_000) : undefined
  return () => {
    disposed = true
    clearInterval(interval)
  }
}
