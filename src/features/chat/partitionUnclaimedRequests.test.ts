/**
 * partitionUnclaimedRequests 契约测试
 *
 * inlineToolRequests 开启时，工具卡片只渲染匹配上的权限/提问；
 * 无人认领的 family 请求必须出现在「未认领」组里，由会话级弹窗兜底——
 * 否则刷新后运行中的子代理权限会彻底不可见（沉浸模式强制 inline，假死）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { partitionUnclaimedRequests } from './InlineToolRequestContext'
import { messageStore } from '../../store/messageStore'
import { childSessionStore } from '../../store/childSessionStore'
import type { ApiSession } from '../../api/types'
import type { ApiPermissionRequest, ApiFormInfo } from '../../api'
import type { AssistantTool, SessionMessageInfo } from '../../types/api/message'

vi.mock('../../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
    onServerChange: () => () => {},
  },
}))

const SERVER = 'local'
const ROOT_KEY = `${SERVER}::ses_parent`

function permission(id: string, sessionID: string, sourceId?: string): ApiPermissionRequest {
  return {
    id,
    sessionID,
    action: 'bash',
    resources: ['npm test'],
    metadata: {},
    ...(sourceId ? { source: { type: 'tool', messageID: 'm1', id: sourceId } } : {}),
  } as ApiPermissionRequest
}

function question(id: string, sessionID: string, toolCallId?: string): ApiFormInfo {
  return {
    id,
    sessionID,
    title: 'Questions',
    fields: [{ key: 'q0', type: 'string' }],
    ...(toolCallId ? { metadata: { kind: 'question', tool: { messageID: 'm1', id: toolCallId } } } : {}),
  } as ApiFormInfo
}

function taskMessage(partId: string, input: Record<string, unknown>, metadata?: Record<string, string>) {
  const tool: AssistantTool = {
    type: 'tool',
    id: partId,
    name: 'subagent',
    time: { created: 1 },
    state: { status: 'running', input, metadata: metadata ?? {} } as AssistantTool['state'],
  }
  return {
    id: `msg_${partId}`,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content: [tool],
    time: { created: 1 },
  } as SessionMessageInfo
}

function bashMessage(partId: string) {
  return {
    id: `msg_${partId}`,
    type: 'assistant',
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content: [
      {
        type: 'tool',
        id: partId,
        name: 'bash',
        time: { created: 1 },
        state: { status: 'running', input: { command: 'ls' }, metadata: {} },
      },
    ],
    time: { created: 1 },
  } as SessionMessageInfo
}

function registerChild(id: string, parentRaw = 'ses_parent') {
  childSessionStore.registerChildSession(
    { id, parentID: parentRaw, title: '', time: { created: 1000 } } as unknown as ApiSession,
    SERVER,
  )
}

beforeEach(() => {
  messageStore.clearAll()
  childSessionStore.clearAll()
})

describe('partitionUnclaimedRequests', () => {
  it('父 session 普通工具的权限（source.id 直配）算已认领', () => {
    const messages = [bashMessage('call_bash')]
    const request = permission('perm-1', 'ses_parent', 'call_bash')

    const result = partitionUnclaimedRequests(messages, [request], [], SERVER, ROOT_KEY)
    expect(result.permissions).toEqual([])
  })

  it('子 session 权限经 metadata.sessionID 挂载到 task 卡片 → 已认领', () => {
    registerChild('ses_child')
    const messages = [taskMessage('call_task', { description: '任务' }, { sessionID: 'ses_child' })]
    const request = permission('perm-1', `${SERVER}::ses_child`)

    const result = partitionUnclaimedRequests(messages, [request], [], SERVER, ROOT_KEY)
    expect(result.permissions).toEqual([])
  })

  it('metadata 丢失（刷新后）经绑定表挂载 → 已认领', () => {
    registerChild('ses_child')
    const messages = [taskMessage('call_task', { description: '任务' })]
    // 模拟早期绑定（session.created 配对的结果）
    childSessionStore.bindToolPart(SERVER, 'call_task', `${SERVER}::ses_child`)
    const request = permission('perm-1', 'ses_child')

    const result = partitionUnclaimedRequests(messages, [request], [], SERVER, ROOT_KEY)
    expect(result.permissions).toEqual([])
  })

  it('family 内但没有卡片认领的请求 → 未认领（会话级兜底）', () => {
    // 子 session 已注册（family 成员），但消息里没有任何 task 卡片关联它
    registerChild('ses_orphan')
    const request = permission('perm-1', 'ses_orphan')

    const result = partitionUnclaimedRequests([], [request], [], SERVER, ROOT_KEY)
    expect(result.permissions).toEqual([request])
  })

  it('非 family 的请求不进未认领组（别的会话的 pending 不弹在这个 pane）', () => {
    const request = permission('perm-1', 'ses_other_session')

    const result = partitionUnclaimedRequests([], [request], [], SERVER, ROOT_KEY)
    expect(result.permissions).toEqual([])
  })

  it('孙 session 的请求经卡片认领（递归 family 匹配）', () => {
    registerChild('ses_child')
    registerChild('ses_grand', 'ses_child')
    const messages = [taskMessage('call_task', { description: '任务' }, { sessionID: 'ses_child' })]
    const request = permission('perm-1', 'ses_grand')

    const result = partitionUnclaimedRequests(messages, [request], [], SERVER, ROOT_KEY)
    expect(result.permissions).toEqual([])
  })

  it('提问：metadata.tool.id 直配认领；子 session 归属认领；无认领进未认领组', () => {
    registerChild('ses_child')
    const messages = [
      bashMessage('call_q'),
      taskMessage('call_task', { description: '任务' }, { sessionID: 'ses_child' }),
    ]
    const direct = question('frm-1', 'ses_parent', 'call_q')
    const childForm = question('frm-2', 'ses_child')
    const orphan = question('frm-3', 'ses_parent')

    const result = partitionUnclaimedRequests(messages, [], [direct, childForm, orphan], SERVER, ROOT_KEY)
    expect(result.questions).toEqual([orphan])
  })

  it('rootSessionKey 缺省时未认领组为空（无会话上下文不兜底）', () => {
    registerChild('ses_orphan')
    const request = permission('perm-1', 'ses_orphan')

    const result = partitionUnclaimedRequests([], [request], [], SERVER)
    expect(result.permissions).toEqual([])
  })
})
