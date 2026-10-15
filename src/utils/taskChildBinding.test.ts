/**
 * taskChildBinding 契约测试
 *
 * 背景：v2 服务端的 session.tool.progress 是 ephemeral（不落库），运行中
 * task/subagent 工具的 metadata.sessionID 在刷新/重连后丢失。绑定模块用
 * session.created / REST children 的 parentID + agent + title（= 工具
 * input.description）做启发式配对，把子 session 绑回发起它的工具卡片。
 *
 * 核心契约：宁缺毋滥——无法区分时不绑定，绝不错挂。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messageStore } from '../store/messageStore'
import { childSessionStore } from '../store/childSessionStore'
import type { ApiSession } from '../api/types'
import type { AssistantTool, SessionMessageInfo } from '../types/api/message'
import { collectUnlinkedTaskParts, resolveTaskChildSessionId, sweepTaskChildBindings } from './taskChildBinding'

vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveServerId: () => 'local' },
}))

const SERVER = 'local'
const PARENT_KEY = `${SERVER}::ses_parent`

/** 一条带 task/subagent 工具卡片的助手消息 */
function taskMessage(msgId: string, partId: string, input: Record<string, unknown>, metadata?: Record<string, string>) {
  const tool: AssistantTool = {
    type: 'tool',
    id: partId,
    name: 'subagent',
    time: { created: 1 },
    state: { status: 'running', input, metadata: metadata ?? {} } as AssistantTool['state'],
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

/** 注册子 session（模拟 session.created 到达） */
function registerChild(id: string, fields: { title?: string; agent?: string; createdAt?: number } = {}) {
  childSessionStore.registerChildSession(
    {
      id,
      parentID: 'ses_parent',
      title: fields.title ?? '',
      agent: fields.agent,
      time: { created: fields.createdAt ?? 1000 },
    } as unknown as ApiSession,
    SERVER,
  )
}

function loadMessages(...messages: SessionMessageInfo[]) {
  messageStore.setMessages(PARENT_KEY, messages, { directory: '' })
}

beforeEach(() => {
  messageStore.clearAll()
  childSessionStore.clearAll()
})

describe('collectUnlinkedTaskParts', () => {
  it('只收集运行中且没有 metadata.sessionID 的 task/subagent 卡片', () => {
    loadMessages(
      taskMessage('m1', 'call_running', { agent: 'explore', description: 'A' }),
      taskMessage('m2', 'call_linked', { agent: 'explore', description: 'B' }, { sessionID: 'ses_known' }),
      taskMessage('m3', 'call_done', { agent: 'explore', description: 'C' }),
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
    // call_done 置为完成态
    const state = messageStore.getSessionState(PARENT_KEY)!
    const done = state.messages[2]
    if (done.type === 'assistant') {
      const tool = done.content[0] as AssistantTool
      tool.state = { ...tool.state, status: 'completed' } as AssistantTool['state']
    }

    const parts = collectUnlinkedTaskParts(state.messages)
    expect(parts.map(p => p.partId)).toEqual(['call_running'])
  })
})

describe('sweepTaskChildBindings 配对', () => {
  it('title 前缀配对：两个候选各自绑到 title 匹配的子 session', () => {
    loadMessages(
      taskMessage('m1', 'call_a', { agent: 'explore', description: '查认证流程' }),
      taskMessage('m2', 'call_b', { agent: 'explore', description: '写测试' }),
    )
    registerChild('ses_child_b', { title: '写测试', createdAt: 2000 })
    registerChild('ses_child_a', { title: '查认证流程', createdAt: 1000 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_a`)
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_b')).toBe(`${SERVER}::ses_child_b`)
  })

  it('title 缺失时按 agent 名配对', () => {
    loadMessages(taskMessage('m1', 'call_a', { agent: 'explore', description: '任务' }))
    registerChild('ses_child', { title: '', agent: 'explore' })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child`)
  })

  it('信号不足且多个候选：不绑定（宁缺毋滥）', () => {
    loadMessages(
      taskMessage('m1', 'call_a', { prompt: 'p1' }),
      taskMessage('m2', 'call_b', { prompt: 'p2' }),
    )
    registerChild('ses_child_1', { createdAt: 1000 })
    registerChild('ses_child_2', { createdAt: 2000 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBeUndefined()
    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_b')).toBeUndefined()
  })

  it('一对一兜底：唯一候选 + 唯一未绑定子 session 时绑定', () => {
    loadMessages(taskMessage('m1', 'call_a', { prompt: 'p1' }))
    registerChild('ses_child_1')

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(`${SERVER}::ses_child_1`)
  })

  it('幂等：已绑定的卡片不重复配对，已绑定的子 session 不换绑', () => {
    loadMessages(taskMessage('m1', 'call_a', { agent: 'explore', description: '查认证' }))
    registerChild('ses_child_1', { title: '查认证', agent: 'explore' })
    registerChild('ses_child_2', { title: '查认证', agent: 'explore', createdAt: 2000 })

    sweepTaskChildBindings(SERVER, PARENT_KEY)
    const first = childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')
    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_a')).toBe(first)
    expect(first).toBe(`${SERVER}::ses_child_1`)
  })

  it('metadata 已带 sessionID 的卡片不参与配对', () => {
    loadMessages(taskMessage('m1', 'call_linked', { description: '查认证' }, { sessionID: 'ses_from_meta' }))
    registerChild('ses_child_1', { title: '查认证' })

    sweepTaskChildBindings(SERVER, PARENT_KEY)

    expect(childSessionStore.getBoundChildForToolPart(SERVER, 'call_linked')).toBeUndefined()
  })
})

describe('resolveTaskChildSessionId', () => {
  it('metadata.sessionID 优先于绑定表', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '查认证' }, { sessionID: 'ses_meta' }))
    registerChild('ses_child_1', { title: '查认证' })
    sweepTaskChildBindings(SERVER, PARENT_KEY)
    // metadata 有的不会被绑定；手工绑一个验证优先级
    childSessionStore.bindToolPart(SERVER, 'call_a', `${SERVER}::ses_child_1`)

    const state = messageStore.getSessionState(PARENT_KEY)!
    const tool = (state.messages[0] as Extract<SessionMessageInfo, { type: 'assistant' }>).content[0] as AssistantTool
    expect(resolveTaskChildSessionId(tool, SERVER)).toBe('ses_meta')
  })

  it('metadata 缺失时回落到绑定表（返回复合 key）', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '查认证' }))
    registerChild('ses_child_1', { title: '查认证' })
    sweepTaskChildBindings(SERVER, PARENT_KEY)

    const state = messageStore.getSessionState(PARENT_KEY)!
    const tool = (state.messages[0] as Extract<SessionMessageInfo, { type: 'assistant' }>).content[0] as AssistantTool
    expect(resolveTaskChildSessionId(tool, SERVER)).toBe(`${SERVER}::ses_child_1`)
  })

  it('既无 metadata 又无绑定：undefined', () => {
    loadMessages(taskMessage('m1', 'call_a', { description: '查认证' }))
    const state = messageStore.getSessionState(PARENT_KEY)!
    const tool = (state.messages[0] as Extract<SessionMessageInfo, { type: 'assistant' }>).content[0] as AssistantTool
    expect(resolveTaskChildSessionId(tool, SERVER)).toBeUndefined()
  })
})
