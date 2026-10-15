// ============================================
// task/subagent 工具卡片 ↔ 子 session 的绑定
//
// 为什么需要这个模块：
// v2 服务端在子 session 创建瞬间通过 ephemeral 的 session.tool.progress
// 下发 metadata.sessionID（subagent.ts 的 context.progress），但 progress
// **不落库**（官方 message-updater.ts 明示不投影 ephemeral progress）——
// 刷新/重连后 REST 回读到的运行中工具恒为 metadata: {}，子 session id 丢失。
//
// 好在 session.created 是 durable 事件且带 parentID + agent + title
// （子 session 的 title 就是工具 input.description），REST 的
// session?parentID= 列表也能回查。官方客户端在 progress 缺失时用
// 「parentID 过滤 + title startsWith description + 最新创建」的启发式
// 反查（session-ui taskSession），这里做同款配对，结果写入
// childSessionStore 的工具卡片绑定表。
//
// 配对原则：宁缺毋滥——多个候选无法区分时不绑（降级到会话级权限兜底），
// 绝不错挂到别的卡片上。
// ============================================

import { messageStore } from '../store/messageStore'
import { childSessionStore, type ChildSessionInfo } from '../store/childSessionStore'
import { makeSessionKey } from '../utils/sessionKey'
import { currentToolChildSessionId, currentToolInput, currentToolSubagentName } from '../types/api/toolState'
import type { AssistantTool, SessionMessageInfo } from '../types/api/message'

/** 运行中且尚未携带子 session id 的 task/subagent 工具卡片 */
interface UnlinkedTaskPart {
  partId: string
  agent?: string
  description?: string
  /** 消息顺序（早出现的卡片配对早创建的子 session） */
  ordinal: number
}

function isTaskToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'task' || lower === 'subagent'
}

/** 收集父 session 消息里「运行中且没有 metadata.sessionID」的 task/subagent 卡片 */
export function collectUnlinkedTaskParts(messages: SessionMessageInfo[]): UnlinkedTaskPart[] {
  const result: UnlinkedTaskPart[] = []
  let ordinal = 0
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const content of message.content) {
      if (content.type !== 'tool' || !isTaskToolName(content.name)) continue
      ordinal += 1
      // metadata 里有权威 sessionID 的不需要绑定（无论运行中还是已完成）
      if (currentToolChildSessionId(content)) continue
      const status = content.state.status
      if (status !== 'running' && status !== 'streaming') continue
      const input = currentToolInput(content as AssistantTool)
      result.push({
        partId: content.id,
        agent: currentToolSubagentName(content as AssistantTool),
        description: typeof input.description === 'string' ? input.description : undefined,
        ordinal,
      })
    }
  }
  return result
}

/**
 * 把父 session 的子 session 配对到发起它们的运行中 task/subagent 卡片。
 *
 * 配对信号（对齐官方 taskSession 启发式，扩展为两两配对）：
 * 1. title 前缀：子 session 的 title 就是工具 input.description（创建时写入）
 * 2. agent 名：session.created / session 列表都带 agent，与 input.agent 比对
 * 3. 顺序：候选卡片按消息顺序、子 session 按创建时间，早配早
 * 无法区分（无信号且多候选）时不绑。
 */
export function sweepTaskChildBindings(serverId: string, parentSessionKey: string): void {
  const state = messageStore.getSessionState(parentSessionKey)
  if (!state || state.messages.length === 0) return

  const candidates = collectUnlinkedTaskParts(state.messages).filter(
    part => !childSessionStore.getBoundChildForToolPart(serverId, part.partId),
  )
  if (candidates.length === 0) return

  const unbound = childSessionStore
    .getChildSessions(parentSessionKey)
    // 已被其它卡片绑定的不重复配对
    .filter(child => !childSessionStore.getBoundToolPartForChild(child.id))
    .sort((a, b) => a.createdAt - b.createdAt)
  if (unbound.length === 0) return

  const matches = (child: ChildSessionInfo, part: UnlinkedTaskPart): boolean => {
    if (part.description && child.title && child.title.startsWith(part.description)) return true
    if (part.agent && child.agent && child.agent === part.agent) return true
    return false
  }

  const remaining = [...unbound]
  for (const part of candidates) {
    const index = remaining.findIndex(child => matches(child, part))
    if (index >= 0) {
      const [child] = remaining.splice(index, 1)
      childSessionStore.bindToolPart(serverId, part.partId, child.id)
    }
  }

  // 信号缺失时的兜底：只剩一对一候选才绑（多个候选无法区分，宁可不绑）
  const leftoverParts = candidates.filter(
    part => !childSessionStore.getBoundChildForToolPart(serverId, part.partId),
  )
  if (leftoverParts.length === 1 && remaining.length === 1) {
    childSessionStore.bindToolPart(serverId, leftoverParts[0].partId, remaining[0].id)
  }
}

/**
 * task/subagent 工具卡片对应的子 session 引用。
 *
 * 优先 metadata.sessionID（服务端权威，运行中经 progress、完成后经 success 送达）；
 * 缺失时查早期绑定表（session.created / REST children 启发式配对的结果）。
 * 返回值可能是原始 id（metadata）或复合 key（绑定表），调用方两种都认。
 */
export function resolveTaskChildSessionId(
  part: { id: string; name: string; state: AssistantTool['state'] },
  serverId: string,
): string | undefined {
  const fromMetadata = currentToolChildSessionId(part as AssistantTool)
  if (fromMetadata) return fromMetadata
  return childSessionStore.getBoundChildForToolPart(serverId, part.id)
}

/** 便捷版：直接给出 { sessionKey, serverId } 引用 */
export function resolveTaskChildSessionRef(
  part: { id: string; name: string; state: AssistantTool['state'] },
  serverId: string,
): { sessionKey: string; serverId: string } | undefined {
  const sessionId = resolveTaskChildSessionId(part, serverId)
  if (!sessionId) return undefined
  // 统一成复合 key，下游（isChildOf 等）需要复合形式
  const sessionKey = sessionId.includes('::') ? sessionId : makeSessionKey(serverId, sessionId)
  return { sessionKey, serverId }
}
