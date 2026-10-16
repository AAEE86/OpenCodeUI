import { beforeEach, describe, expect, it } from 'vitest'
import { activeSessionStore } from './activeSessionStore'

describe('activeSessionStore scoped refresh handling', () => {
  beforeEach(() => {
    activeSessionStore.reset()
  })

  it('drops same-server sessions missing from the snapshot (snapshot is absolute per server)', () => {
    // 断连期间 child 已结束（active() 只列运行中），快照不含它就必须落 idle——
    // 否则永远卡在 busy（断流恢复后「信息流状态不刷新」的根因）
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
      'local::child': { type: 'busy' },
    })

    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('keeps other servers’ entries when applying one server’s snapshot', () => {
    // keepOtherServers（多服务器 merge 策略）只跨 server 保留，不影响本 server 的绝对语义
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
      'wsl::child': { type: 'busy' },
    })

    activeSessionStore.applyServerStatusSnapshot('local', {}, { keepOtherServers: true })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['wsl::child'])
  })

  it('drops missing sessions on full status replacement refreshes', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
      'local::child': { type: 'busy' },
    })

    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['local::root'])
  })

  it('overrides the snapshot with status events that arrive while the fetch is in flight', () => {
    // 官方 activeUpdates 缓冲同款：拉取窗口内 session 开始运行（事件），
    // 旧快照里没有它——快照应用时事件必须赢，否则 busy 丢失
    activeSessionStore.beginStatusSnapshot('local')
    activeSessionStore.updateStatus('local::late', { type: 'busy' })

    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })
    activeSessionStore.endStatusSnapshot('local')

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId).sort()).toEqual([
      'local::late',
      'local::root',
    ])
  })

  it('an idle event in flight wins over a stale busy snapshot entry', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })

    activeSessionStore.beginStatusSnapshot('local')
    activeSessionStore.updateStatus('local::root', { type: 'idle' })

    // 快照（拉取开始时发出）仍认为 root 在跑——事件更新更晚，必须覆盖
    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })
    activeSessionStore.endStatusSnapshot('local')

    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('keeps existing pending child requests during scoped pending refresh merges', () => {
    activeSessionStore.addPendingRequest('req-child', 'child', 'question', 'Need approval')

    activeSessionStore.mergePendingRequests([], [])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'Need approval',
    })
  })

  it('reuses the busySessions array reference when content is unchanged', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })
    activeSessionStore.setSessionMeta('local::root', 'Root', '/repo')

    const first = activeSessionStore.getBusySessionsSnapshot()
    activeSessionStore.applyServerStatusSnapshot('local', {
      'local::root': { type: 'busy' },
    })
    const second = activeSessionStore.getBusySessionsSnapshot()

    expect(second).toBe(first)
    expect(second).toEqual([
      {
        sessionId: 'local::root',
        status: { type: 'busy' },
        title: 'Root',
        directory: '/repo',
        pendingAction: undefined,
      },
    ])
  })

  it('replaces the busySessions array reference when status content changes', () => {
    activeSessionStore.initialize({
      'local::root': { type: 'busy' },
    })
    const first = activeSessionStore.getBusySessionsSnapshot()

    activeSessionStore.updateStatus('local::root', {
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: 1000,
    })
    const second = activeSessionStore.getBusySessionsSnapshot()

    expect(second).not.toBe(first)
    expect(second[0]?.status).toEqual({
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: 1000,
    })
  })

  it('drops a replayed pending request after it has been replied', () => {
    // 症状：本地乐观回复清掉了 store，但 useGlobalEvents 闭包里的
    // latePendingRequests 没清；下一次 fetch 重放就把已回复的请求补回来，
    // 侧边栏徽标卡住不消失。settled 记录必须把它挡住。
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'bash: rm -rf')
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'bash: rm -rf',
    })

    activeSessionStore.resolvePendingRequest('req-1')

    // 模拟下一次 fetch 快照里的迟到事件重放
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'bash: rm -rf')

    expect(activeSessionStore.getBusySessions()).toEqual([])
  })

  it('still accepts a fresh request id after another one settled', () => {
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'question', 'first')
    activeSessionStore.resolvePendingRequest('req-1')
    activeSessionStore.addPendingRequest('req-2', 'local::root', 'question', 'second')

    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'second',
    })
  })

  it('lets a server snapshot revive a request the local side had settled', () => {
    // 服务端快照是权威：它说还 pending 就要显示（本地乐观回复可能没真正生效），
    // 所以 settled 只拦 addPendingRequest，不拦 applyPendingSnapshot。
    activeSessionStore.addPendingRequest('req-1', 'local::root', 'permission', 'x')
    activeSessionStore.resolvePendingRequest('req-1')

    activeSessionStore.initializePendingRequests(
      [{ id: 'req-1', sessionID: 'local::root', action: 'bash', resources: ['x'] }],
      [],
    )

    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'permission',
      description: 'bash: x',
    })
  })
})
