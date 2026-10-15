// ============================================
// task/subagent 工具卡片 ↔ 子 session 的绑定
//
// 为什么需要这个模块：
// v2 服务端在子 session 创建瞬间通过 ephemeral 的 session.tool.progress
// 下发 metadata.sessionID（subagent.ts 的 context.progress），但 progress
// **不落库**（官方 message-updater.ts 明示不投影 ephemeral progress）——
// 刷新/重连后 REST 回读到的运行中工具恒为 metadata: {}，子 session id 丢失。
//
// 子 session id 的四个来源，按确定性从高到低（前三个都是精确的，只有第四个
// 需要「配对」，且必须有界）：
// 1. **续接参数**：模型续接已有子会话时在工具入参里显式传 `sessionID`
//    （subagent.ts:40-42）——参数即答案，服务端不会再发 progress。
//    （由 currentToolChildSessionId 统一读取，这里不参与配对）
// 2. **在线 progress**：新子 session 创建瞬间的 metadata.sessionID（精确）
// 3. **一对一**：父会话只有一张未链接卡片、且时间窗内只有一个候选子 session
// 4. **prompt 精确校验**：刷新恢复用 input.prompt 与子 session 首条用户消息
//    逐字比对（见 verifyTaskChildBindings）
//
// 为什么不用 agent/title 做配对：并行同 agent 的子代理会被按 agent 误配，
// 标题也可能被截断或退化成占位符（"Subtask"）——这正是「工具卡片挂错会话」
// 的根源。title 只用于在候选里挑最可能的一个去 probe，绝不单独作为绑定依据。
//
// 扫描有界：候选按「创建时间在工具调用之后（±时钟偏移）」筛时间窗，再按
// 时间最近排序，每张卡片最多 probe 数个、全局有上限——一堆子 session 时
// 不会挨个请求。
// ============================================

import { messageStore } from '../store/messageStore'
import { childSessionStore, type ChildSessionInfo } from '../store/childSessionStore'
import { makeSessionKey, splitSessionKey } from '../utils/sessionKey'
import { currentToolChildSessionId, currentToolInput, currentToolSubagentName } from '../types/api/toolState'
import type { AssistantTool, SessionMessageInfo } from '../types/api/message'

/** 子 session 创建时间早于工具调用开始时间的容差（时钟偏移 / 秒级取整） */
const CREATED_SKEW_MS = 5_000
/** 每张卡片最多 probe 的候选数（时间最近的优先） */
const MAX_PROBES_PER_PART = 4
/** 单次校验全局 probe 上限——一堆子 session 时不会挨个扫 */
const MAX_TOTAL_PROBES = 12
/** 时间窗内没有候选时，退一步看的最近候选数（时钟异常兜底） */
const FALLBACK_NEAREST = 2

/**
 * 服务端/客户端的通用占位标题（不携带信息，不能当信号）。
 * childSessionStore 在 title 缺失时写入 i18n 的 subtaskFallback。
 */
const GENERIC_TITLES = new Set(['subtask', 'task', 'sub agent', 'subagent', '子任务'])

/** 运行中且尚未确定子 session id 的 task/subagent 工具卡片 */
interface UnlinkedTaskPart {
  partId: string
  agent?: string
  description?: string
  /** 工具入参里的任务提示词——与子 session 首条用户消息逐字相等（精确绑定依据） */
  prompt?: string
  /** 工具调用开始时间（time.ran ?? time.created）——子 session 必然在此之后创建 */
  startedAt: number
  /** 消息顺序（同 prompt 的并行卡片按序配对同 prompt 的子 session） */
  ordinal: number
}

function isTaskToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'task' || lower === 'subagent'
}

function toolStartedAt(tool: AssistantTool): number {
  const time = (tool as { time?: { created?: number; ran?: number } }).time
  return time?.ran ?? time?.created ?? 0
}

/** 收集父 session 消息里「运行中且没有子 session id」的 task/subagent 卡片 */
export function collectUnlinkedTaskParts(messages: SessionMessageInfo[]): UnlinkedTaskPart[] {
  const result: UnlinkedTaskPart[] = []
  let ordinal = 0
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const content of message.content) {
      if (content.type !== 'tool' || !isTaskToolName(content.name)) continue
      ordinal += 1
      // metadata 或续接参数已经给出权威 sessionID 的不需要配对
      if (currentToolChildSessionId(content)) continue
      const status = content.state.status
      if (status !== 'running' && status !== 'streaming') continue
      const input = currentToolInput(content as AssistantTool)
      result.push({
        partId: content.id,
        agent: currentToolSubagentName(content as AssistantTool),
        description: typeof input.description === 'string' ? input.description : undefined,
        prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
        startedAt: toolStartedAt(content as AssistantTool),
        ordinal,
      })
    }
  }
  return result
}

/**
 * 已被某个卡片（metadata / 续接参数）明确指认的子 session id 集合（原始 id）。
 * 这些子 session 不需要也不允许再被配对给别的卡片。
 */
function referencedChildIds(messages: SessionMessageInfo[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const content of message.content) {
      if (content.type !== 'tool' || !isTaskToolName(content.name)) continue
      const id = currentToolChildSessionId(content as AssistantTool)
      if (id) ids.add(splitSessionKey(id).sessionId)
    }
  }
  return ids
}

/** title 是否与卡片 description 明确对应（相等或任一方向前缀，且非占位符） */
function titleMatches(child: ChildSessionInfo, part: UnlinkedTaskPart): boolean {
  if (!part.description || !child.title) return false
  const title = child.title.trim()
  if (!title || GENERIC_TITLES.has(title.toLowerCase())) return false
  return title.startsWith(part.description) || part.description.startsWith(title)
}

function agentMatches(child: ChildSessionInfo, part: UnlinkedTaskPart): boolean {
  if (!part.agent || !child.agent) return true
  return child.agent === part.agent
}

/**
 * 可参与配对的子 session：**当前活跃**（status running）、未绑定、且没有被
 * 其它卡片指认（metadata / 续接参数），按创建时间排序。
 *
 * 「只看活跃」是关键收敛：配对问题只发生在「刚创建、还在跑」的子 session 上——
 * 已跑完的子 session 其卡片的 metadata.sessionID 早已由 tool.success 落库，
 * 会走 referenced 排除；live 期间子会话 idle 事件也会把 status 置为 idle。
 * 注意刷新后 REST 恢复的子 session 一律注册成 running（没有 idle 事件回放），
 * 因此恢复路径的边界由「时间窗 + referenced 排除 + probe 上限」保证。
 */
function availableChildren(parentSessionKey: string, referenced: Set<string>): ChildSessionInfo[] {
  return childSessionStore
    .getChildSessions(parentSessionKey)
    .filter(child => child.status === 'running')
    .filter(child => !childSessionStore.getBoundToolPartForChild(child.id))
    .filter(child => !referenced.has(splitSessionKey(child.id).sessionId))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * 一张卡片的候选子 session：时间窗（调用之后创建 ± 容差）+ agent 一致，
 * 按「与调用时刻的距离」由近到远。窗口内为空时退化为最近的若干个候选。
 */
function candidateChildren(part: UnlinkedTaskPart, children: ChildSessionInfo[]): ChildSessionInfo[] {
  const inAgent = children.filter(child => agentMatches(child, part))
  const inWindow = inAgent.filter(child => child.createdAt >= part.startedAt - CREATED_SKEW_MS)
  const sorted = [...inAgent].sort(
    (a, b) => Math.abs(a.createdAt - part.startedAt) - Math.abs(b.createdAt - part.startedAt),
  )
  if (inWindow.length > 0) {
    return sorted.filter(child => inWindow.includes(child))
  }
  // 时间窗内为空（时钟异常 / 缺少工具时间戳）：只退一步看最近的少数候选
  return sorted.slice(0, FALLBACK_NEAREST)
}

/**
 * 新建子会话时服务端给 prompt 加的固定前缀
 * （subagent.ts:208-211：新建走 `[前缀, input.prompt].join("\n")`；
 * 续接已有子会话才发裸 prompt——续接有入参 sessionID，不参与校验）。
 * 不认这个前缀的话，新建子会话的首条消息永远对不上 prompt。
 */
const SUBAGENT_PROMPT_PREFIX = 'You are a subagent spawned by another session.'

/** 子 session 首条用户消息是否就是这张卡片发出的 prompt（逐字，允许上述固定前缀） */
export function isPromptMatch(messageText: string, prompt: string): boolean {
  if (messageText === prompt) return true
  const prefixed = `${SUBAGENT_PROMPT_PREFIX}\n`
  return messageText.startsWith(prefixed) && messageText.slice(prefixed.length) === prompt
}

/** 绑定前复查：卡片仍未获得权威 id，且该子 session 仍未被别的卡片绑定 */
function canBind(parentSessionKey: string, partId: string, childId: string): boolean {
  if (childSessionStore.getBoundToolPartForChild(childId)) return false
  const state = messageStore.getSessionState(parentSessionKey)
  const part = state?.messages
    .flatMap(message => (message.type === 'assistant' ? message.content : []))
    .find(content => content.type === 'tool' && content.id === partId)
  if (!part || part.type !== 'tool') return false
  return !currentToolChildSessionId(part as AssistantTool)
}

/**
 * 同步直绑（无网络）——只处理无歧义的情况，在线第一时间的即时反馈：
 *
 *   a. 唯一卡片 + 唯一候选子 session → 直接绑；
 *   b. 某卡片的候选中只有一个 title 明确对应 → 绑（title 创建时由
 *      input.description 写入，属于确定性信号）；
 *
 * 其余情况一律留给 verifyTaskChildBindings 的 prompt 精确校验——
 * 多候选按 agent/顺序硬配正是挂错会话的原因。
 */
export function sweepTaskChildBindings(serverId: string, parentSessionKey: string): void {
  const state = messageStore.getSessionState(parentSessionKey)
  if (!state || state.messages.length === 0) return

  const referenced = referencedChildIds(state.messages)
  const children = availableChildren(parentSessionKey, referenced)
  if (children.length === 0) return

  const parts = collectUnlinkedTaskParts(state.messages).filter(
    part => !childSessionStore.getBoundChildForToolPart(serverId, part.partId),
  )
  if (parts.length === 0) return

  for (const part of parts) {
    // 候选一律先过时间窗（子 session 必然在工具调用之后创建）——
    // 历史子 session 即使 title 恰好相同也不会被绑走
    const candidates = candidateChildren(part, children).filter(
      child => !childSessionStore.getBoundToolPartForChild(child.id),
    )
    if (candidates.length === 0) continue

    // 只有一张卡片时，时间窗内唯一候选即无歧义（常见的单子代理场景，零请求）
    const target =
      parts.length === 1 && candidates.length === 1
        ? candidates[0]
        : (() => {
            const exact = candidates.filter(child => titleMatches(child, part))
            return exact.length === 1 ? exact[0] : undefined
          })()
    if (!target) continue
    if (!canBind(parentSessionKey, part.partId, target.id)) continue
    childSessionStore.bindToolPart(serverId, part.partId, target.id)
  }
}

/**
 * prompt 精确校验绑定（刷新/重连恢复路径）。
 *
 * 子 session 的第一条用户消息就是 task 工具发给它的 prompt——逐字比对是
 * 唯一不依赖时序、命名与顺序的确定性信号。有界策略：
 *
 *   1. 候选 = 未绑定 / 未被其它卡片指认 / 时间窗内创建 / agent 一致，
 *      按与调用时刻的距离由近到远；
 *   2. 每张卡片最多 probe MAX_PROBES_PER_PART 个候选，全局最多
 *      MAX_TOTAL_PROBES 次首条消息请求（每个子 session 只拉一次）；
 *   3. 文本与 input.prompt 逐字相等 → 绑定；同 prompt 的并行卡片与
 *      候选顺序一一配对；
 *   4. 绑定前复查（probe 期间 progress 可能已送达权威 metadata）。
 *
 * fetchFirstUserText 由调用方注入（REST 通道），返回 undefined 视为不可判定。
 */
export async function verifyTaskChildBindings(
  serverId: string,
  parentSessionKey: string,
  fetchFirstUserText: (childSessionKey: string) => Promise<string | undefined>,
): Promise<void> {
  const state = messageStore.getSessionState(parentSessionKey)
  if (!state || state.messages.length === 0) return

  const children = availableChildren(parentSessionKey, referencedChildIds(state.messages))
  if (children.length === 0) return

  const parts = collectUnlinkedTaskParts(state.messages).filter(
    part => part.prompt && !childSessionStore.getBoundChildForToolPart(serverId, part.partId),
  )
  if (parts.length === 0) return

  const textByChild = new Map<string, string | undefined>()
  let probes = 0
  const textOf = async (child: ChildSessionInfo): Promise<string | undefined> => {
    if (textByChild.has(child.id)) return textByChild.get(child.id)
    if (probes >= MAX_TOTAL_PROBES) return undefined
    probes += 1
    let text: string | undefined
    try {
      text = await fetchFirstUserText(child.id)
    } catch {
      text = undefined
    }
    textByChild.set(child.id, text)
    return text
  }

  const claimed = new Set<string>()
  for (const part of parts) {
    const candidates = candidateChildren(part, children)
      .filter(child => !claimed.has(child.id))
      .filter(child => !childSessionStore.getBoundToolPartForChild(child.id))
    if (candidates.length === 0) continue

    const pool =
      candidates.length > MAX_PROBES_PER_PART
        ? // 时间窗内候选多于上限时，title 对得上的排在前面（只为少发请求，不作判定）
          [
            ...candidates.filter(child => titleMatches(child, part)),
            ...candidates.filter(child => !titleMatches(child, part)),
          ].slice(0, MAX_PROBES_PER_PART)
        : candidates

    let matched: ChildSessionInfo | undefined
    for (const child of pool) {
      const text = await textOf(child)
      if (text !== undefined && isPromptMatch(text, part.prompt!)) {
        matched = child
        break
      }
    }
    if (!matched) continue
    if (!canBind(parentSessionKey, part.partId, matched.id)) continue
    claimed.add(matched.id)
    childSessionStore.bindToolPart(serverId, part.partId, matched.id)
  }
}

/**
 * task/subagent 工具卡片对应的子 session 引用。
 *
 * 优先 metadata.sessionID / 续接参数（服务端与模型给出的权威值），
 * 缺失时查早期绑定表（sweep / verify 的结果）。
 * 返回值可能是原始 id（权威值）或复合 key（绑定表），调用方两种都认。
 */
export function resolveTaskChildSessionId(
  part: { id: string; name: string; state: AssistantTool['state'] },
  serverId: string,
): string | undefined {
  const fromTool = currentToolChildSessionId(part as AssistantTool)
  if (fromTool) return fromTool
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
