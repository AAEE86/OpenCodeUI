// ============================================
// useSessionModelRestore —— 进入会话对齐输入框模型
// ============================================
//
// 覆盖 v2 迁移后丢掉的场景：会话模型来源从「user 消息」换成「会话级 durable 值」，
// 而 durable 值（`session.get`）与模型目录都可能晚于消息到达，一次性锁不能提前落下。

import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '../api'
import type { SessionMessageInfo } from '../types/api/event'
import { messageStore, useSessionState } from '../store'
import { useModelSelection } from './useModelSelection'
import { useSessionModelRestore } from './useSessionModelRestore'

const { storage, raw, parse } = vi.hoisted(() => {
  const storage = new Map<string, string>()
  const raw = (key: string) => storage.get(key) ?? null
  const parse = <T,>(key: string): T | null => {
    const value = raw(key)
    if (!value) return null
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return { storage, raw, parse }
})

vi.mock('../utils/perServerStorage', () => ({
  subscribePerServerStorageVersion: () => () => undefined,
  serverStorage: {
    get: raw,
    set: (key: string, value: string) => {
      storage.set(key, value)
    },
    remove: (key: string) => {
      storage.delete(key)
    },
    getJSON: parse,
    setJSON: (key: string, value: unknown) => {
      storage.set(key, JSON.stringify(value))
    },
    getFor: raw,
    setFor: (key: string, value: string) => {
      storage.set(key, value)
    },
    getJSONFor: parse,
    setJSONFor: (key: string, value: unknown) => {
      storage.set(key, JSON.stringify(value))
    },
  },
}))

const SESSION = 'local::session-1'
const OTHER_SESSION = 'local::session-2'

function model(providerID: string, id: string, variants: string[] = []): Model {
  return {
    id,
    name: `${providerID}/${id}`,
    providerID,
    enabled: true,
    status: 'active',
    limit: { context: 200000, output: 32000 },
    capabilities: { input: ['text'], output: ['text'], tools: true },
    variants: variants.map(variant => ({ id: variant })),
  } as unknown as Model
}

const MIMO = model('opencode', 'mimo-v2.6-flash-free')
const DEEPSEEK = model('opencode', 'deepseek-v4.1-flash-free', ['low', 'high', 'max'])
const KIMI = model('kimi-code-plan-cn', 'k3-256k', ['low', 'high'])
/** 目录里的第一个模型：没恢复成功时输入框会显示它 */
const FIRST = model('openai', 'gpt-5.4')

function modelRef(id: string, providerID: string, variant?: string) {
  return variant ? { id, providerID, variant } : { id, providerID }
}

/** 构造一条助手消息（v2 的助手消息必带 model） */
function assistantMessage(id: string, ref?: ReturnType<typeof modelRef>): SessionMessageInfo {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    ...(ref ? { model: ref } : {}),
    content: [],
    time: { created: Date.now() },
  } as unknown as SessionMessageInfo
}

type SelectionApi = ReturnType<typeof useModelSelection>

interface HarnessProps {
  sessionId: string | null
  models: Model[]
  /** 把 hook 的 API 暴露给测试（只在 effect 里写，避免渲染副作用） */
  apiRef?: { current: SelectionApi | null }
}

function Harness({ sessionId, models, apiRef }: HarnessProps) {
  const state = useSessionState(sessionId)
  const current = useModelSelection({ models, sessionId })

  useEffect(() => {
    if (apiRef) apiRef.current = current
  })

  useSessionModelRestore({
    sessionId,
    messages: state?.messages ?? [],
    loadState: state?.loadState ?? 'idle',
    sessionModel: state?.model,
    models,
    restoreFromMessage: current.restoreFromMessage,
  })

  return <span data-testid="selected">{current.selectedModelKey ?? 'none'}</span>
}

function selected(): string | null {
  const text = screen.getByTestId('selected').textContent ?? ''
  return text === 'none' ? null : text
}

describe('useSessionModelRestore', () => {
  beforeEach(() => {
    storage.clear()
    messageStore.clearAll()
  })

  it('durable 会话模型晚于消息到达时，仍会恢复（不能提前落锁）', async () => {
    // 纯 SSE 暂存出来的会话：消息已经在 store 里，loadState 还是 idle，会话级模型还没读到
    act(() => {
      messageStore.handleStepStarted({
        sessionID: SESSION,
        assistantMessageID: 'msg-a1',
        agent: 'build',
        model: modelRef('mimo-v2.6-flash-free', 'opencode'),
        started: Date.now(),
      } as never)
    })

    const models = [FIRST, MIMO, DEEPSEEK]
    render(<Harness sessionId={SESSION} models={models} />)

    // 快照没落地 → 先保持原样（模型目录第一个）
    expect(selected()).toBe('openai:gpt-5.4')

    // `session.get` 落地：durable 模型 + loadState loaded
    act(() => {
      messageStore.updateSessionMetadata(SESSION, {
        model: modelRef('deepseek-v4.1-flash-free', 'opencode', 'high'),
        loadState: 'loaded',
      })
    })

    await waitFor(() => expect(selected()).toBe('opencode:deepseek-v4.1-flash-free'))
  })

  it('模型目录晚于会话到达时，等目录到了再恢复（不能在空目录上落锁）', () => {
    act(() => {
      messageStore.setMessages(SESSION, [assistantMessage('msg-a1', modelRef('mimo-v2.6-flash-free', 'opencode'))], {
        model: modelRef('mimo-v2.6-flash-free', 'opencode'),
      })
    })

    const { rerender } = render(<Harness sessionId={SESSION} models={[]} />)
    expect(selected()).toBeNull()

    rerender(<Harness sessionId={SESSION} models={[FIRST, MIMO]} />)
    expect(selected()).toBe('opencode:mimo-v2.6-flash-free')
  })

  it('只在进入会话时更新一次：用户改过的模型不会被后续消息覆盖', () => {
    act(() => {
      messageStore.setMessages(SESSION, [assistantMessage('msg-a1', modelRef('mimo-v2.6-flash-free', 'opencode'))], {
        model: modelRef('mimo-v2.6-flash-free', 'opencode'),
      })
    })

    const models = [FIRST, MIMO, DEEPSEEK]
    const apiRef: { current: SelectionApi | null } = { current: null }
    render(<Harness sessionId={SESSION} models={models} apiRef={apiRef} />)
    expect(selected()).toBe('opencode:mimo-v2.6-flash-free')

    // 用户手动改成 deepseek
    act(() => {
      apiRef.current?.handleModelChange('opencode:deepseek-v4.1-flash-free', DEEPSEEK)
    })
    expect(selected()).toBe('opencode:deepseek-v4.1-flash-free')

    // 会话继续输出（消息变化）不应该把用户的选择冲掉
    act(() => {
      messageStore.handleStepStarted({
        sessionID: SESSION,
        assistantMessageID: 'msg-a2',
        agent: 'build',
        model: modelRef('mimo-v2.6-flash-free', 'opencode'),
        started: Date.now(),
      } as never)
    })
    expect(selected()).toBe('opencode:deepseek-v4.1-flash-free')
  })

  it('切到另一个会话时，各恢复各自的模型', () => {
    act(() => {
      messageStore.setMessages(SESSION, [assistantMessage('msg-a1')], {
        model: modelRef('mimo-v2.6-flash-free', 'opencode'),
      })
      messageStore.setMessages(OTHER_SESSION, [assistantMessage('msg-b1')], {
        model: modelRef('k3-256k', 'kimi-code-plan-cn', 'high'),
      })
    })

    const models = [FIRST, MIMO, DEEPSEEK, KIMI]
    const { rerender } = render(<Harness sessionId={SESSION} models={models} />)
    expect(selected()).toBe('opencode:mimo-v2.6-flash-free')

    rerender(<Harness sessionId={OTHER_SESSION} models={models} />)
    expect(selected()).toBe('kimi-code-plan-cn:k3-256k')
  })

  it('会话级模型缺失时，用最后一条助手消息的模型兜底', () => {
    act(() => {
      messageStore.setMessages(
        SESSION,
        [
          assistantMessage('msg-a1', modelRef('mimo-v2.6-flash-free', 'opencode')),
          assistantMessage('msg-a2', modelRef('deepseek-v4.1-flash-free', 'opencode', 'high')),
        ],
        {},
      )
    })

    render(<Harness sessionId={SESSION} models={[FIRST, MIMO, DEEPSEEK]} />)
    expect(selected()).toBe('opencode:deepseek-v4.1-flash-free')
  })

  it('空会话没有模型时不恢复，也不影响之后的模型选择', async () => {
    act(() => {
      messageStore.setMessages(SESSION, [], {})
    })

    const models = [FIRST, MIMO]
    render(<Harness sessionId={SESSION} models={models} />)
    expect(selected()).toBe('openai:gpt-5.4')

    // 会话级模型迟到（用户在这个空会话里换过模型）也不能再回头覆盖
    act(() => {
      messageStore.updateSessionMetadata(SESSION, { model: modelRef('mimo-v2.6-flash-free', 'opencode') })
    })
    await waitFor(() => expect(messageStore.getSessionState(SESSION)?.model).toBeDefined())
    expect(selected()).toBe('openai:gpt-5.4')
  })
})
