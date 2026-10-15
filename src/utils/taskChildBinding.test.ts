/**
 * taskChildBinding 契约测试
 *
 * 背景：v2 服务端的 session.tool.progress 是 ephemeral（不落库），运行中
 * task/subagent 工具的 metadata.sessionID 在刷新/重连后丢失。子 session id 的
 * 精确来源按可靠性排序：续接参数（工具入参 sessionID）> 在线 progress >
 * 一对一 > prompt 逐字校验；agent/顺序绝不单独作为绑定依据（会挂错会话）。
 *
 * 扫描必须有界：候选按时间窗（子 session 必然在工具调用之后创建）筛选，
 * 每张卡片最多 probe 数个、全局有上限——一堆子 session 时不挨个请求。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messageStore } from '../store/messageStore'
import { childSessionStore } from '../store/childSessionStore'
import type { ApiSession } from '../api/types'
import type { AssistantTool, SessionMessageInfo } from '../types/api/message'
import {
  collectUnlinkedTaskParts,
  isPromptMatch,
  resolveTaskChildSessionId,
  sweepTaskChildBindings,
  verifyTaskChildBindings,
} from './taskChildBinding'

vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveServerId: () => 'local' },
}))

const SERVER = 'local'
const PARENT_KEY = `${SERVER}::ses_parent`

const T0 = 10_000

/** 一条带 task/subagent 工具卡片的助手消息 */
function taskMessage(
  msgId: string,
  partId: string,
  input: Record<string, unknown>,
  options: { metadata?: Record<string, string>; ran?: number } = {},
) {
  const tool: AssistantTool = {
    type: 'tool',
    id: partId,
    name: 'subagent',
    time: { created: options.ran ?? T0, ran: options.ran ?? T0 },
    state: { status: 'running', input, metadata: options.metadata ?? {} } as AssistantTool['state'],
  }
  return {
    id: msgId,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content: [tool],
    time: { created: 1 },
  } as SessionMessageInfo
}

/** 注册子 session（模拟 session.created / REST children 到达） */
function registerChild(id: string, fields: { title?: string; agent?: string; createdAt?: number } = {}) {
  childSessionStore.registerChildSession(
    {
      id,
      parentID: 'ses_parent',
      // 服务端空 title 时 store 会兜底成占位符 "Subtask"（i18n fallback）
      title: fields.title ?? 'Subtask',
      agent: fields.agent,
      time: { created: fields.createdAt ?? T0 + 500 },
    } as unknown as ApiSession,
    SERVER,
  )
}

function loadMessages(...messages: SessionMessageInfo[]) {
  messageStore.setMessages(PARENT_KEY, messages, { directory: '' })
}

function toolPart(partId: string): AssistantTool {
  const state = messageStore.getSessionState(PARENT_KEY)!
  for (const message of state.messages) {
    if (message.type !== 'assistant') continue
    for (const content of message.content) {
      if (content.type === 'tool' && content.id === partId) return content as AssistantTool
    }
  }
  throw new Error(`tool part not found: ${partId}`)
}

beforeEach(() => {
  messageStore.clearAll()
  childSessionStore.clearAll()
})

describe('collectUnlinkedTaskParts', () => {
  it('只收集运行中、既无 metadata.sessionID 也无续接参数的 task/subagent 卡片', () => {
    loadMessages(
      taskMessage('m1', 'call_running', { description: 'A', prompt: 'pa' }),
      taskMessage('m2', 'call_meta', { description: 'B', prompt: 'pb' }, { metadata: { sessionID: 'ses_known' } }),
      // 续接已有子会话：入参 sessionID 即答案，不需要配对
      taskMessage('m3', 'call_resume', { description: 'C', prompt: 'pc', sessionID: 'ses_resumed' }),
      // 非 task 工具不收
      {
        id: 'm4',
        type: 'assistant',
        agent: 'build',
        model: { id: 'model-1', providerID: 'provider-1' },
        content: [
          { type: 'tool', id: 'call_bash', name: 'bash', time: { created: 1 }, state: { status: 'running', input: {}, metadata: {} } },
        ],
        time: { created: 1 },
      } as SessionMessageInfo,
    )

    const parts = collectUnlinkedTaskParts(messageStore.getSessionState(PARENT_KEY)!.messages)
    expect(parts.map(p => p.partId)).toEqual(['call_running'])
    expect(parts[0].prompt).toBe('pa')
  })
})

describe('sweepTaskChildBindings（同步、无网络、只绑无歧义）', () => {
  it('一对一：唯一卡片 + 唯一候选子 session → 直绑', () => {
    loadMessages(taskMessage('m1', 'call_a', { agent: 'explore', description: '任务', prompt: 'p1' }))
    registerChild('ses_child_1')

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_1`)
  })

  it('并行同 description（title 也相同）：不按 agent/顺序概率性配对，留给 prompt 校验', () => {
    loadMessages(
      taskMessage('m1', 'call_a', { agent: 'explore', description: '并行任务', prompt: 'p1' }, { ran: T0 }),
      taskMessage('m2', 'call_b', { agent: 'explore', description: '并行任务', prompt: 'p2' }, { ran: T0 }),
    )
    registerChild('ses_child_a', { title: '并行任务', agent: 'explore', createdAt: T0 + 500 })
    registerChild('ses_child_b', { title: '并行任务', agent: 'explore', createdAt: T0 + 600 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_b')).toBeUndefined()
  })

  it('title 唯一对应时直接绑（title 创建时由 input.description 写入）', () => {
    loadMessages(
      taskMessage('m1', 'call_a', { description: '查认证流程', prompt: 'p1' }, { ran: T0 }),
      taskMessage('m2', 'call_b', { description: '写测试', prompt: 'p2' }, { ran: T0 }),
    )
    registerChild('ses_child_a', { title: '查认证流程', createdAt: T0 + 300 })
    registerChild('ses_child_b', { title: '完全不同的标题', createdAt: T0 + 400 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_a`)
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_b')).toBeUndefined()
  })

  it('时间窗外的历史子 session 不参与配对——即使 title 恰好相同（一堆子 session 也不会误绑）', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '任务', prompt: 'p1' }, { ran: T0 }))
    // 很久以前创建的历史子 session：title 与本次 description 相同也不能绑
    registerChild('ses_old', { title: '任务', createdAt: T0 - 600_000 })
    registerChild('ses_child_1', { createdAt: T0 + 400 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_1`)
    expect(childSessionStore.getBoundToolPartForChild(`${SERVER}::ses_old`)).toBeUndefined()
  })

  it('已被其它卡片指认（metadata）的子 session 不会被抢绑', () => {
    loadMessages(
      taskMessage('m1', 'call_linked', { description: '任务', prompt: 'p1' }, { metadata: { sessionID: 'ses_child_1' } }),
      taskMessage('m2', 'call_a', { description: '任务2', prompt: 'p2' }, { ran: T0 }),
    )
    registerChild('ses_child_1', { title: '任务', createdAt: T0 + 100 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
  })

  it('已 idle 的子 session 不参与配对（只找当前活跃的）', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '任务', prompt: 'p1' }, { ran: T0 }))
    registerChild('ses_done', { title: '任务', createdAt: T0 + 100 })
    registerChild('ses_active', { createdAt: T0 + 200 })
    childSessionStore.markIdle(`${SERVER}::ses_done`)

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_active`)
  })
})

describe('isPromptMatch', () => {
  const PREFIX = 'You are a subagent spawned by another session.'

  it('裸 prompt 相等算命中', () => {
    expect(isPromptMatch('修 bug', '修 bug')).toBe(true)
  })

  it('新建子会话的服务端前缀（subagent.ts:208-211）算命中', () => {
    expect(isPromptMatch(`${PREFIX}\n修 bug`, '修 bug')).toBe(true)
  })

  it('前缀之外的差异不算命中（前缀相同的不同任务必须区分开）', () => {
    expect(isPromptMatch(`${PREFIX}\n修别的 bug`, '修 bug')).toBe(false)
    expect(isPromptMatch(`另一种前缀\n修 bug`, '修 bug')).toBe(false)
    expect(isPromptMatch('', '修 bug')).toBe(false)
  })
})

describe('verifyTaskChildBindings（prompt 精确校验，有界扫描）', () => {
  const fetcher =
    (texts: Record<string, string | undefined>, onFetch?: (key: string) => void) =>
    async (childKey: string) => {
      onFetch?.(childKey)
      return texts[childKey]
    }

  it('prompt 逐字相等才绑：并行同 agent、同 description 也能各归各位（用服务端真实前缀形态）', async () => {
    loadMessages(
      taskMessage('m1', 'call_a', { agent: 'explore', description: '并行', prompt: '审查 auth 模块' }, { ran: T0 }),
      taskMessage('m2', 'call_b', { agent: 'explore', description: '并行', prompt: '给 store 补测试' }, { ran: T0 + 10 }),
    )
    registerChild('ses_child_a', { title: '并行', agent: 'explore', createdAt: T0 + 500 })
    registerChild('ses_child_b', { title: '并行', agent: 'explore', createdAt: T0 + 600 })

    // 新建子会话的首条用户消息 = "You are a subagent spawned by another session.\n" + prompt
    const prefix = 'You are a subagent spawned by another session.\n'
    await verifyTaskChildBindings(
      SERVER,
      PARENT_KEY,
      fetcher({
        [`${SERVER}::ses_child_a`]: `${prefix}审查 auth 模块`,
        [`${SERVER}::ses_child_b`]: `${prefix}给 store 补测试`,
      }),
    )

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_a`)
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_b')).toBe(`${SERVER}::ses_child_b`)
  })

  it('prompt 不同则不绑（title/agent 对得上也无效）', async () => {
    loadMessages(
      taskMessage('m1', 'call_a', { agent: 'explore', description: '查认证', prompt: '审查 auth 模块' }, { ran: T0 }),
    )
    registerChild('ses_child_1', { title: '查认证', agent: 'explore', createdAt: T0 + 500 })

    await verifyTaskChildBindings(SERVER, PARENT_KEY, fetcher({ [`${SERVER}::ses_child_1`]: '别的任务' }))

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
  })

  it('同 prompt 的并行卡片按候选距离（时间最近优先）一一配对', async () => {
    loadMessages(
      taskMessage('m1', 'call_a', { description: '并行', prompt: '同一个 prompt' }, { ran: T0 }),
      taskMessage('m2', 'call_b', { description: '并行', prompt: '同一个 prompt' }, { ran: T0 + 1_000 }),
    )
    registerChild('ses_child_1', { createdAt: T0 + 200 })
    registerChild('ses_child_2', { createdAt: T0 + 1_100 })

    await verifyTaskChildBindings(
      SERVER,
      PARENT_KEY,
      fetcher({
        [`${SERVER}::ses_child_1`]: '同一个 prompt',
        [`${SERVER}::ses_child_2`]: '同一个 prompt',
      }),
    )

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_1`)
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_b')).toBe(`${SERVER}::ses_child_2`)
  })

  it('每张卡片的 probe 数有上限：候选很多时不挨个扫', async () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '任务', prompt: '目标 prompt' }, { ran: T0 }))
    // 8 个时间窗内的候选，正确的那一个是第 6 近 —— 超出单卡上限就不再扫
    for (let i = 1; i <= 8; i += 1) {
      registerChild(`ses_child_${i}`, { createdAt: T0 + i * 100 })
    }
    const probed: string[] = []
    await verifyTaskChildBindings(
      SERVER,
      PARENT_KEY,
      fetcher(
        Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [
            `${SERVER}::ses_child_${index + 6 <= 8 ? index + 1 : index + 1}`,
            index + 1 === 6 ? '目标 prompt' : '不是这个',
          ]),
        ),
        key => probed.push(key),
      ),
    )

    expect(probed.length).toBeLessThanOrEqual(4)
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
  })

  it('没有 prompt 的卡片不参与校验（交给在线 progress）', async () => {
    loadMessages(taskMessage('m1', 'call_a', { agent: 'explore', description: '任务' }))
    registerChild('ses_child_1', { agent: 'explore', title: '任务' })

    await verifyTaskChildBindings(SERVER, PARENT_KEY, fetcher({ [`${SERVER}::ses_child_1`]: '什么都不是' }))

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
  })

  it('probe 期间权威 metadata 到达则放弃绑定', async () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '任务', prompt: '目标 prompt' }, { ran: T0 }))
    registerChild('ses_child_1', { createdAt: T0 + 100 })
    registerChild('ses_child_2', { createdAt: T0 + 200 })

    await verifyTaskChildBindings(SERVER, PARENT_KEY, async key => {
      // 模拟拉取期间 progress 事件把权威 id 写进了卡片
      const state = messageStore.getSessionState(PARENT_KEY)!
      const tool = (state.messages[0] as Extract<SessionMessageInfo, { type: 'assistant' }>).content[0] as AssistantTool
      tool.state = { status: 'running', input: {}, metadata: { sessionID: 'ses_authoritative' } } as AssistantTool['state']
      return key.endsWith('ses_child_1') ? '目标 prompt' : '不是这个'
    })

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
  })
})

describe('resolveTaskChildSessionId', () => {
  it('metadata.sessionID 优先于绑定表', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '查认证' }, { metadata: { sessionID: 'ses_meta' } }))
    childSessionStore.bindToolPart(SERVER, 'call_a', `${SERVER}::ses_child_1`)

    expect(resolveTaskChildSessionId(toolPart('call_a'), SERVER)).toBe('ses_meta')
  })

  it('续接参数（input.sessionID）作为权威 id 直接返回', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '继续', prompt: 'p', sessionID: 'ses_resumed' }))

    expect(resolveTaskChildSessionId(toolPart('call_a'), SERVER)).toBe('ses_resumed')
  })

  it('metadata 缺失时回落到绑定表（返回复合 key）', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '查认证' }))
    childSessionStore.bindToolPart(SERVER, 'call_a', `${SERVER}::ses_child_1`)

    expect(resolveTaskChildSessionId(toolPart('call_a'), SERVER)).toBe(`${SERVER}::ses_child_1`)
  })

  it('既无权威 id 又无绑定：undefined', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '查认证' }))
    expect(resolveTaskChildSessionId(toolPart('call_a'), SERVER)).toBeUndefined()
  })
})
