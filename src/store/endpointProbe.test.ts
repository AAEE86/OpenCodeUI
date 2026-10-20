// 多地址自动探测（Issue #183）：决策纯函数 + 一轮探测的集成行为。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EndpointProbeState } from './endpointProbe'
import type { ConnectionInfo } from '../api/events'

const LAN = 'http://192.168.1.5:4096'
const WAN = 'https://public.example.com'
const THIRD = 'https://third.example.com'

function state(reachable: boolean, ok = 0, fail = 0): EndpointProbeState {
  return { reachable, consecutiveOk: ok, consecutiveFail: fail, lastChecked: 0 }
}

function endpointsOf(...urls: string[]) {
  return urls.map((url, index) => ({ url, priority: index }))
}

const DWELL = 30_000

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
})

describe('decideEndpointSwitch', () => {
  it('单地址服务器不参与决策', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([[LAN, state(false, 0, 5)]])

    expect(decideEndpointSwitch(endpointsOf(LAN), null, states, Infinity)).toBeNull()
    expect(decideEndpointSwitch(undefined, null, states, Infinity)).toBeNull()
  })

  it('启动时默认地址不可达 → 立刻退到备用（首次选择不等失败阈值）', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(false, 0, 1)],
      [WAN, state(true, 1)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), null, states, DWELL)).toEqual({
      url: WAN,
      reason: 'failover',
    })
  })

  it('启动时默认地址可达 → 不动', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(true, 1)],
      [WAN, state(true, 1)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), null, states, DWELL)).toBeNull()
  })

  it('连续失败未达阈值不降级（抗单次抖动）', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(false, 0, 1)],
      [WAN, state(true, 5)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), LAN, states, 0)).toBeNull()
  })

  it('连续失败达阈值 → 降级到可达的备用地址', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(false, 0, 2)],
      [WAN, state(true, 1)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), LAN, states, 0)).toEqual({
      url: WAN,
      reason: 'failover',
    })
  })

  it('全部不可达 → 保持现状，不随机切', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(false, 0, 5)],
      [WAN, state(false, 0, 5)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), LAN, states, 0)).toBeNull()
  })

  it('当前是备用地址且失效 → 切到可达的高优先级地址（不卡在更低优先级）', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(true, 1)],
      [WAN, state(false, 0, 5)],
      [THIRD, state(true, 5)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN, THIRD), WAN, states, 0)).toEqual({
      url: LAN,
      reason: 'failover',
    })
  })

  it('高优先级恢复但未满成功阈值 → 不切回', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(true, 2)],
      [WAN, state(true, 10)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), WAN, states, DWELL)).toBeNull()
  })

  it('高优先级满成功阈值但滞回未到 → 不切回', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(true, 3)],
      [WAN, state(true, 10)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), WAN, states, DWELL - 1)).toBeNull()
  })

  it('高优先级满成功阈值 + 滞回已到 → 切回', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(true, 3)],
      [WAN, state(true, 10)],
    ])

    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), WAN, states, DWELL)).toEqual({
      url: LAN,
      reason: 'recover',
    })
  })

  it('当前地址不健康时不走升级分支（交给降级处理）', async () => {
    const { decideEndpointSwitch } = await import('./endpointProbe')
    const states = new Map([
      [LAN, state(true, 5)],
      [WAN, state(false, 0, 1)],
    ])

    // WAN 只是 1 次失败（未达降级阈值），也不该因为 LAN 恢复就切过去后
    // 又立刻依据升级逻辑……总之未达阈值一律不动
    expect(decideEndpointSwitch(endpointsOf(LAN, WAN), WAN, states, DWELL)).toBeNull()
  })
})

describe('applyProbeResult', () => {
  it('可达累加 ok、清零 fail', async () => {
    const { applyProbeResult } = await import('./endpointProbe')

    const first = applyProbeResult({ reachable: false, consecutiveOk: 0, consecutiveFail: 3, lastChecked: 0 }, true, 42, 100)
    expect(first).toEqual({ reachable: true, latency: 42, consecutiveOk: 1, consecutiveFail: 0, lastChecked: 100 })

    const second = applyProbeResult(first, true, 50, 200)
    expect(second.consecutiveOk).toBe(2)
  })

  it('不可达累加 fail、清零 ok、丢弃延迟', async () => {
    const { applyProbeResult } = await import('./endpointProbe')

    const next = applyProbeResult({ reachable: true, latency: 30, consecutiveOk: 5, consecutiveFail: 0, lastChecked: 0 }, false, undefined, 100)
    expect(next).toEqual({ reachable: false, latency: undefined, consecutiveOk: 0, consecutiveFail: 1, lastChecked: 100 })
  })

  it('首次探测（无前值）也能正确计数', async () => {
    const { applyProbeResult } = await import('./endpointProbe')

    expect(applyProbeResult(undefined, false, undefined, 7)).toEqual({
      reachable: false,
      latency: undefined,
      consecutiveOk: 0,
      consecutiveFail: 1,
      lastChecked: 7,
    })
  })
})

describe('probeServerOnce（集成）', () => {
  it('并发探测所有地址，并按降级决策切换生效地址', async () => {
    const { serverStore } = await import('./serverStore')
    const { probeServerOnce, resetAllProbeStates } = await import('./endpointProbe')
    resetAllProbeStates()

    const server = serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    // 内网不可达、公网可达
    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockImplementation(async url =>
      url === LAN ? null : 12,
    )

    // 第一轮：启动时默认地址不可达 → 立刻换
    await probeServerOnce(server.id)
    expect(serverStore.getServerBaseUrl(server.id)).toBe(WAN)

    // 第二轮：公网健康，保持
    await probeServerOnce(server.id)
    expect(serverStore.getServerBaseUrl(server.id)).toBe(WAN)

    expect(probeSpy).toHaveBeenCalledTimes(4)
    probeSpy.mockRestore()
  })

  it('锁定期间完全让位，不改生效地址', async () => {
    const { serverStore } = await import('./serverStore')
    const { probeServerOnce, resetAllProbeStates } = await import('./endpointProbe')
    resetAllProbeStates()

    const server = serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })
    serverStore.setLockedEndpoint(server.id, WAN)

    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockResolvedValue(null)
    await probeServerOnce(server.id)

    expect(serverStore.getServerBaseUrl(server.id)).toBe(WAN)
    // 锁定后连探测都不发
    expect(probeSpy).not.toHaveBeenCalled()
    probeSpy.mockRestore()
  })

  it('并发探测同一台只跑一轮（15s 主循环与 3s 归位探测会撞车）', async () => {
    const { serverStore } = await import('./serverStore')
    const { probeServerOnce, resetAllProbeStates, getProbeState } = await import('./endpointProbe')
    resetAllProbeStates()

    const server = serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    const resolvers: Array<() => void> = []
    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockImplementation(
      () =>
        new Promise<number>(resolve => {
          resolvers.push(() => resolve(10))
        }),
    )

    // 两个入口同时进来：第二个必须被去重，否则一轮里 consecutiveOk 涨两次，
    // 升级/降级阈值被变相减半 → 来回横跳
    const first = probeServerOnce(server.id)
    const second = probeServerOnce(server.id)
    await Promise.resolve()
    for (const resolve of resolvers) resolve()
    await Promise.all([first, second])

    // 每台地址每轮只探一次
    expect(probeSpy.mock.calls.length).toBe(2) // 两个地址各一次，不是四个
    expect(getProbeState(server.id, LAN)?.consecutiveOk).toBe(1)

    probeSpy.mockRestore()
  })

  it('单地址服务器不发探测', async () => {    const { serverStore } = await import('./serverStore')
    const { probeServerOnce, resetAllProbeStates } = await import('./endpointProbe')
    resetAllProbeStates()

    const server = serverStore.addServer({ name: 'single', url: LAN })
    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockResolvedValue(10)

    await probeServerOnce(server.id)
    expect(probeSpy).not.toHaveBeenCalled()
    probeSpy.mockRestore()
  })

  it('内网恢复后累计成功 + 滞回到期 → 切回内网', async () => {
    const { serverStore } = await import('./serverStore')
    const { probeServerOnce, resetAllProbeStates } = await import('./endpointProbe')
    resetAllProbeStates()

    const server = serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockImplementation(async url =>
      url === LAN ? 5 : 20,
    )

    // 现在在公网（模拟此前已降级）
    serverStore.setActiveEndpoint(server.id, WAN)

    // 连续 3 轮内网可达 → 满足成功阈值；但滞回窗口按真实时间算，直接
    // 用「未来时刻」驱动探测，模拟已经稳定运行很久
    const future = performance.now() + 60_000
    await probeServerOnce(server.id, future)
    await probeServerOnce(server.id, future)
    await probeServerOnce(server.id, future)

    expect(serverStore.getServerBaseUrl(server.id)).toBe(LAN)
    probeSpy.mockRestore()
  })
})

// ============================================
// 传输层信号驱动的快速探测
//
// SSE 断开是「当前入口可能死了」的最快信号。只靠 15s 轮询的话，切网络后
// 要等下一轮才知道；这里验证断线会立刻触发探测并在确认失败后尽快切走。
// ============================================

describe('传输层报错 → 快速探测', () => {
  it('曾经连上过、现在掉了 → 立刻探测（不等 15s 轮询）', async () => {
    vi.resetModules()
    const { serverStore } = await import('./serverStore')
    const { startEndpointProbe, stopEndpointProbe, resetAllProbeStates } = await import('./endpointProbe')

    resetAllProbeStates()
    const server = serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    // 捕获连接状态订阅回调
    const connectionCallbacks = new Map<string, (info: ConnectionInfo) => void>()
    const eventsModule = await import('../api/events')
    vi.spyOn(eventsModule, 'subscribeToServerConnectionState').mockImplementation(
      (serverId: string, fn: (info: ConnectionInfo) => void) => {
        connectionCallbacks.set(serverId, fn)
        return () => connectionCallbacks.delete(serverId)
      },
    )

    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockImplementation(async url =>
      url === LAN ? null : 20,
    )

    vi.useFakeTimers()
    try {
      startEndpointProbe()
      // 首轮立即探测：内网已不可达 → 首次选择直接切到公网
      await vi.advanceTimersByTimeAsync(0)
      expect(serverStore.getServerBaseUrl(server.id)).toBe(WAN)

      // 模拟：当前生效的公网地址也掉了（连接状态从 connected 变 error）
      connectionCallbacks.get(server.id)?.({ state: 'connected', lastEventTime: 0, reconnectAttempt: 0 })
      const callsBefore = probeSpy.mock.calls.length
      connectionCallbacks.get(server.id)?.({ state: 'error', lastEventTime: 0, reconnectAttempt: 1 })

      // 确认延迟后立刻探测，而不是等 15s
      await vi.advanceTimersByTimeAsync(1_600)
      expect(probeSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    } finally {
      stopEndpointProbe()
      vi.useRealTimers()
      probeSpy.mockRestore()
    }
  })

  it('从未连上过就不触发（首次连接失败不该反复探测）', async () => {
    vi.resetModules()
    const { serverStore } = await import('./serverStore')
    const { startEndpointProbe, stopEndpointProbe, resetAllProbeStates } = await import('./endpointProbe')

    resetAllProbeStates()
    serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    const connectionCallbacks = new Map<string, (info: ConnectionInfo) => void>()
    const eventsModule = await import('../api/events')
    vi.spyOn(eventsModule, 'subscribeToServerConnectionState').mockImplementation(
      (serverId: string, fn: (info: ConnectionInfo) => void) => {
        connectionCallbacks.set(serverId, fn)
        return () => connectionCallbacks.delete(serverId)
      },
    )

    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockResolvedValue(20)

    vi.useFakeTimers()
    try {
      startEndpointProbe()
      await vi.advanceTimersByTimeAsync(0)
      const callsBefore = probeSpy.mock.calls.length

      // 只有 error，没有先连上 → 不出手
      for (const [, cb] of connectionCallbacks) cb({ state: 'error', lastEventTime: 0, reconnectAttempt: 1 })
      await vi.advanceTimersByTimeAsync(1_600)
      expect(probeSpy.mock.calls.length).toBe(callsBefore)
    } finally {
      stopEndpointProbe()
      vi.useRealTimers()
      probeSpy.mockRestore()
    }
  })
})

// ============================================
// 归位探测：降级状态下加密探测，别让用户干等 15s 轮询
// ============================================

describe('降级状态的归位探测', () => {
  it('停在低优先级地址时，用 3s 节奏探测并在连续成功后切回', async () => {
    vi.resetModules()
    const { serverStore } = await import('./serverStore')
    const { startEndpointProbe, stopEndpointProbe, resetAllProbeStates } = await import('./endpointProbe')

    resetAllProbeStates()
    const server = serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    // 两个地址都可达
    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockResolvedValue(15)

    vi.useFakeTimers()
    try {
      startEndpointProbe()
      await vi.advanceTimersByTimeAsync(0)

      // 先手动降到公网（模拟「内网刚挂了」之后的状态）
      serverStore.setActiveEndpoint(server.id, WAN)
      expect(serverStore.getServerBaseUrl(server.id)).toBe(WAN)

      // 滞回窗口未过 → 即使连续成功也不切回
      await vi.advanceTimersByTimeAsync(3_500)
      expect(serverStore.getServerBaseUrl(server.id)).toBe(WAN)

      // 把「上次切换时刻」推回 60s 前（等价于已经稳定运行很久）
      const runtime = serverStore.getEndpointRuntime(server.id)
      // @ts-expect-error 测试里直接改运行时状态，模拟时间流逝
      runtime.lastSwitchAt = performance.now() - 60_000

      // 3s 节奏下，3 次成功 ≈ 9s 内就该切回（而不是等 15s 轮询的 45s）
      await vi.advanceTimersByTimeAsync(10_000)
      expect(serverStore.getServerBaseUrl(server.id)).toBe(LAN)
    } finally {
      stopEndpointProbe()
      vi.useRealTimers()
      probeSpy.mockRestore()
    }
  })

  it('未降级时归位探测不发多余请求', async () => {
    vi.resetModules()
    const { serverStore } = await import('./serverStore')
    const { startEndpointProbe, stopEndpointProbe, resetAllProbeStates } = await import('./endpointProbe')

    resetAllProbeStates()
    serverStore.addServer({
      name: 'dual',
      url: LAN,
      endpoints: [
        { url: LAN, priority: 0 },
        { url: WAN, priority: 1 },
      ],
    })

    const probeSpy = vi.spyOn(serverStore, 'probeEndpoint').mockResolvedValue(15)

    vi.useFakeTimers()
    try {
      startEndpointProbe()
      await vi.advanceTimersByTimeAsync(0)
      const afterFirstRound = probeSpy.mock.calls.length

      // 正常状态（生效的是 priority 0）：归位探测应该什么都不做。
      // 只推进 10s（不足 15s 全局轮询周期），请求数不该增长。
      await vi.advanceTimersByTimeAsync(10_000)
      expect(probeSpy.mock.calls.length).toBe(afterFirstRound)
    } finally {
      stopEndpointProbe()
      vi.useRealTimers()
      probeSpy.mockRestore()
    }
  })
})
