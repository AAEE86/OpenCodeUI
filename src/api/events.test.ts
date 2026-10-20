import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// 事件订阅测试（OpenCode v2）
//
// v1 时期这里测试的是**手写的 SSE 解析器**：UTF-8 分块、事件合并、
// 迟到的旧代次事件丢弃等。v2 把这些交给客户端的 `event.subscribe()`
// （内部 `/api/event` + text/event-stream），因此那些用例连同实现一起删除了。
//
// 仍然属于本仓库职责、值得测试的是：
//   1. 扁平 v2 事件被正确分派到对应的 EventCallbacks
//   2. 订阅生命周期（订阅/退订 / 连接状态广播 / 活动服务器迁移）
// ============================================

/** 一个可控的事件流：测试里手动往里推事件 */
function createEventStream() {
  let push: ((event: unknown) => void) | null = null
  let closed = false

  const stream = {
    [Symbol.asyncIterator]() {
      const queue: unknown[] = []
      const waiters: Array<(value: IteratorResult<unknown>) => void> = []

      push = (event: unknown) => {
        const waiter = waiters.shift()
        if (waiter) waiter({ value: event, done: false })
        else queue.push(event)
      }

      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false })
          }
          if (closed) return Promise.resolve({ value: undefined, done: true })
          return new Promise(resolve => waiters.push(resolve))
        },
        return(): Promise<IteratorResult<unknown>> {
          closed = true
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }

  return {
    stream,
    emit(event: unknown) {
      push?.(event)
    },
    close() {
      closed = true
    },
  }
}

const subscribeMock = vi.hoisted(() => vi.fn())

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    event: { subscribe: subscribeMock },
  }),
  invalidateSDKClient: () => {},
}))

/** 构造一个 v2 扁平事件 */
function v2Event(type: string, data: unknown) {
  return { id: `evt-${type}`, created: Date.now(), type, data }
}

describe('v2 event dispatch', () => {
  beforeEach(() => {
    vi.resetModules()
    subscribeMock.mockReset()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches flat v2 events to the matching callbacks', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')

    const onTextDelta = vi.fn()
    const onToolCalled = vi.fn()
    const onSessionIdle = vi.fn()
    const onFormCreated = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', {
      onTextDelta,
      onToolCalled,
      onSessionIdle,
      onFormCreated,
    })

    // 让 connectServer 的 for-await 真正挂上
    await Promise.resolve()

    harness.emit(
      v2Event('session.text.delta', {
        sessionID: 's1',
        assistantMessageID: 'm1',
        ordinal: 0,
        delta: 'hello',
      }),
    )
    harness.emit(
      v2Event('session.tool.called', {
        sessionID: 's1',
        assistantMessageID: 'm1',
        id: 'tool-1',
        input: {},
        executed: false,
      }),
    )
    harness.emit(v2Event('session.idle', { sessionID: 's1' }))
    harness.emit(v2Event('form.created', { id: 'f1', sessionID: 's1', title: 'Q', fields: [] }))

    await new Promise(resolve => setTimeout(resolve, 0))

    // 第二个参数是信封 facts（id / created / metadata），store 用它派生消息 id 与时间
    const facts = expect.objectContaining({ id: expect.any(String), created: expect.any(Number) })

    expect(onTextDelta).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 's1', ordinal: 0, delta: 'hello' }),
      facts,
    )
    expect(onToolCalled).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool-1' }), facts)
    expect(onSessionIdle).toHaveBeenCalledWith({ sessionID: 's1' }, facts)
    expect(onFormCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), facts)

    unsubscribe()
  })

  /**
   * 真机验证（v2 服务端 v2.0.14）：`provider.updated` / `model.updated` 在连接
   * 建立后与配置变更时确实会推，负载为空 `{}`。此前完全没有分发，导致
   * `useModels` 的模块级缓存陈旧（模型选择器显示旧目录）。
   */
  it('dispatches provider/model catalog-invalidation events', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')

    const onProviderUpdated = vi.fn()
    const onModelUpdated = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', { onProviderUpdated, onModelUpdated })
    await Promise.resolve()

    harness.emit(v2Event('provider.updated', {}))
    harness.emit(v2Event('model.updated', {}))
    await new Promise(resolve => setTimeout(resolve, 0))

    const facts = expect.objectContaining({ id: expect.any(String), created: expect.any(Number) })
    expect(onProviderUpdated).toHaveBeenCalledWith({}, facts)
    expect(onModelUpdated).toHaveBeenCalledWith({}, facts)

    unsubscribe()
  })

  /**
   * `server.connected` 是**唯一**信封里没有 `created` 的事件
   *（真机抓包确认：信封只有 `{id, type, data}`，data 为 `{}`）。
   * 分发层必须用 `in` 收窄而不是整体强转，否则该事件会让 `event.created` 报错。
   */
  it('tolerates server.connected, the only envelope without created', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')

    const onTextDelta = vi.fn()
    const unsubscribe = subscribeToServerEvents('test-server', { onTextDelta })
    await Promise.resolve()

    // 不带 created 的信封（真机形状）
    harness.emit({ id: 'evt_connected', type: 'server.connected', data: {} })
    await new Promise(resolve => setTimeout(resolve, 0))

    // 不应抛错；后续带 created 的事件仍能拿到它
    harness.emit(v2Event('session.text.delta', { sessionID: 's1', assistantMessageID: 'm1', ordinal: 0, delta: 'x' }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onTextDelta).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 'x' }),
      expect.objectContaining({ created: expect.any(Number) }),
    )

    unsubscribe()
  })

  it('ignores event types the UI does not consume', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')
    const onTextDelta = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', { onTextDelta })
    await Promise.resolve()

    // v2 有 100 种事件；UI 只消费其中一部分，其余的必须安全忽略
    harness.emit(v2Event('models-dev.refreshed', {}))
    harness.emit(v2Event('credential.updated', {}))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onTextDelta).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('dispatches inbox delivery.changed to its callback', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents } = await import('./events')
    const onInboxDeliveryChanged = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', { onInboxDeliveryChanged })
    await Promise.resolve()

    harness.emit(
      v2Event('session.inbox.delivery.changed', {
        sessionID: 's1',
        inboxID: 'msg_1',
        delivery: 'steer',
      }),
    )
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onInboxDeliveryChanged).toHaveBeenCalledWith(
      expect.objectContaining({ inboxID: 'msg_1', delivery: 'steer' }),
      expect.anything(),
    )
    unsubscribe()
  })

  it('reports connection state transitions', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents, getServerConnectionInfo } = await import('./events')

    expect(getServerConnectionInfo('test-server').state).toBe('disconnected')

    const unsubscribe = subscribeToServerEvents('test-server', {})
    await Promise.resolve()
    expect(getServerConnectionInfo('test-server').state).toBe('connecting')

    // 收到任意事件后标记为已连接
    harness.emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getServerConnectionInfo('test-server').state).toBe('connected')
    unsubscribe()
  })

  it('stops delivering after unsubscribe', async () => {
    const harness = createEventStream()
    subscribeMock.mockReturnValue(harness.stream)

    const { subscribeToServerEvents, getServerConnectionInfo } = await import('./events')
    const onTextDelta = vi.fn()

    const unsubscribe = subscribeToServerEvents('test-server', { onTextDelta })
    await Promise.resolve()

    harness.emit(v2Event('session.text.delta', { sessionID: 's', assistantMessageID: 'm', ordinal: 0, delta: 'a' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onTextDelta).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(getServerConnectionInfo('test-server').state).toBe('disconnected')
  })

  /**
   * 建连卡死自愈：SSE 建连 fetch 无超时，挂起时 isConnecting 会吞掉所有
   * 重连入口（永久断联）。看门狗应在 CONNECT_STALL_TIMEOUT 后掐断，
   * 并在底层 fetch 不认 abort 时于 5s 后强制复位重连。
   */
  it('recovers when the SSE connect hangs (stall watchdog + force reset)', async () => {
    vi.useFakeTimers()
    try {
      // 永不产出事件、也不响应 abort 的僵尸流
      subscribeMock.mockImplementation(() => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<unknown>>(() => {}),
            return: () => Promise.resolve({ value: undefined, done: true } as IteratorResult<unknown>),
          }
        },
      }))

      const { subscribeToServerEvents, getServerConnectionInfo } = await import('./events')
      const unsubscribe = subscribeToServerEvents('test-server', {})
      await Promise.resolve()

      expect(getServerConnectionInfo('test-server').state).toBe('connecting')
      expect(subscribeMock).toHaveBeenCalledTimes(1)

      // 看门狗 tick(15s) → 卡死阈值(>15s，第二个 tick 30s 触发) → 强制复位(5s)
      await vi.advanceTimersByTimeAsync(35_000)
      expect(getServerConnectionInfo('test-server').state).toBe('disconnected')

      // 复位后按退避排了重连（首次 attempt 延迟 1s）
      await vi.advanceTimersByTimeAsync(1_000)
      expect(subscribeMock).toHaveBeenCalledTimes(2)

      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * 断网又恢复：TCP 半开时流既不报错也不结束，连接状态会一直停在
   * connected，只能等看门狗（45s 静默 + 15s tick）才发现。期间 UI 完全
   * 不刷新 —— 用户的观感就是「网回来了但界面死的，得手动刷新」。
   *
   * online 事件是外部事实：网络确实变了，此时若连接已静默超过一个心跳
   * 周期，就该主动掐断重连，而不是相信 state === 'connected'。
   */
  it('forces a reconnect on online when the connected stream has gone silent', async () => {
    vi.useFakeTimers()
    try {
      const harnesses: Array<ReturnType<typeof createEventStream>> = []
      subscribeMock.mockImplementation(() => {
        const harness = createEventStream()
        harnesses.push(harness)
        return harness.stream
      })

      const { subscribeToServerEvents, getServerConnectionInfo } = await import('./events')
      const onReconnected = vi.fn()
      const unsubscribe = subscribeToServerEvents('test-server', { onReconnected })
      await Promise.resolve()

      // 建立连接并保持有心跳
      harnesses[0].emit(v2Event('session.idle', { sessionID: 's1' }))
      await vi.advanceTimersByTimeAsync(0)
      expect(getServerConnectionInfo('test-server').state).toBe('connected')

      // 断网：心跳停了，连接状态仍是 connected（半开），且已静默超过阈值。
      // 只推进到不足看门狗阈值，确保不是看门狗救的场。
      await vi.advanceTimersByTimeAsync(25_000)
      expect(getServerConnectionInfo('test-server').state).toBe('connected')

      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(6_000)

      // 半开连接被主动掐断并重连（不是等 45s 看门狗）
      expect(subscribeMock.mock.calls.length).toBeGreaterThanOrEqual(2)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * 端点变更重连必须广播 onReconnected：否则订阅者不做补偿拉取，
   * WSL 端口变化等场景下状态/权限/消息全部陈旧。
   */
  it('broadcasts onReconnected after reconnectServerSSE so subscribers refetch', async () => {
    const harnesses: Array<ReturnType<typeof createEventStream>> = []
    subscribeMock.mockImplementation(() => {
      const harness = createEventStream()
      harnesses.push(harness)
      return harness.stream
    })

    const { subscribeToServerEvents, reconnectServerSSE } = await import('./events')
    const onReconnected = vi.fn()
    const unsubscribe = subscribeToServerEvents('test-server', { onReconnected })
    await Promise.resolve()

    // 首次连接：不广播
    harnesses[0].emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onReconnected).not.toHaveBeenCalled()

    // 端点变更强制重连 → 新流的首个事件应触发补偿广播
    reconnectServerSSE('test-server')
    await Promise.resolve()
    expect(harnesses.length).toBe(2)

    harnesses[1].emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onReconnected).toHaveBeenCalledWith('server-switch')

    unsubscribe()
  })

  /**
   * 从未连上过（本地 serve 启动竞态：初始拉取在端点就绪前已失败），
   * 端点变更强制重连后的首个成功连接也必须广播补偿，否则失败态不自愈。
   */
  it('broadcasts onReconnected on first connect after reconnectServerSSE when never connected', async () => {
    const harnesses: Array<ReturnType<typeof createEventStream>> = []
    subscribeMock.mockImplementation(() => {
      const harness = createEventStream()
      harnesses.push(harness)
      return harness.stream
    })

    const { subscribeToServerEvents, reconnectServerSSE } = await import('./events')
    const onReconnected = vi.fn()
    const unsubscribe = subscribeToServerEvents('test-server', { onReconnected })
    await Promise.resolve()

    // 首条流不推任何事件 → hasConnectedBefore 保持 false（从未连上）
    reconnectServerSSE('test-server')
    await Promise.resolve()
    expect(harnesses.length).toBe(2)

    harnesses[1].emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onReconnected).toHaveBeenCalledWith('server-switch')

    unsubscribe()
  })

  /**
   * 换入口地址（Issue #183）：重连照做，但补偿广播必须是 'network'。
   * 广播成 'server-switch' 会被 SessionContext / useSessions 显式跳过
   * （那条路径假定 onServerChange 链负责重拉），换地址没有那条链，跳过就没人刷。
   */
  it('broadcasts onReconnected with network reason on endpoint switch reconnect', async () => {
    const harnesses: Array<ReturnType<typeof createEventStream>> = []
    subscribeMock.mockImplementation(() => {
      const harness = createEventStream()
      harnesses.push(harness)
      return harness.stream
    })

    const { subscribeToServerEvents, reconnectServerSSE } = await import('./events')
    const onReconnected = vi.fn()
    const unsubscribe = subscribeToServerEvents('test-server', { onReconnected })
    await Promise.resolve()

    // 先建立一次连接，让 hasConnectedBefore = true
    harnesses[0].emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onReconnected).not.toHaveBeenCalled()

    reconnectServerSSE('test-server', { reason: 'network' })
    await Promise.resolve()
    expect(harnesses.length).toBe(2)

    harnesses[1].emit(v2Event('session.idle', { sessionID: 's1' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onReconnected).toHaveBeenCalledWith('network')

    unsubscribe()
  })

  /**
   * 对没有任何订阅（因此没有连接）的服务器重连是空操作：
   * 不该凭空创建连接对象，否则多地址探测每次切换都会往 Map 里塞死条目。
   */
  it('reconnectServerSSE is a no-op for a server with no connection', async () => {
    const { reconnectServerSSE } = await import('./events')
    expect(() => reconnectServerSSE('never-subscribed', { reason: 'network' })).not.toThrow()
  })
})
