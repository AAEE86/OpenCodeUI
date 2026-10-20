// 多地址探测的真实服务端验证（默认跳过，不提交为常规套件）。
// 需要本机跑着 v2 服务端：
//   OPENCODE_PASSWORD=test123 opencode serve --port 4199 --hostname 0.0.0.0
// 然后：
//   VITE_OPENCODE_LIVE_E2E=1 npx vitest run src/test/endpoint-probe.live.test.ts
import { describe, it, expect } from 'vitest'
import { serverStore } from '../store/serverStore'
import { probeServerOnce, getProbeState, resetAllProbeStates } from '../store/endpointProbe'

const LIVE = import.meta.env.VITE_OPENCODE_LIVE_E2E === '1'
const LIVE_URL = 'http://127.0.0.1:4199'
/** 关掉的端口，用来模拟不可达地址 */
const DEAD_URL = 'http://127.0.0.1:4198'
const AUTH = { username: 'opencode', password: 'test123' }

describe.skipIf(!LIVE)('endpoint probe against a live server', () => {
  it('可达地址返回延迟', async () => {
    const latency = await serverStore.probeEndpoint(LIVE_URL, AUTH)
    expect(typeof latency).toBe('number')
    expect(latency).toBeGreaterThanOrEqual(0)
  }, 15000)

  it('凭据错误仍算可达（401 = 地址通，只是认证不过）', async () => {
    const latency = await serverStore.probeEndpoint(LIVE_URL, { username: 'opencode', password: 'wrong' })
    expect(typeof latency).toBe('number')
  }, 15000)

  it('死端口返回 null', async () => {
    expect(await serverStore.probeEndpoint(DEAD_URL, AUTH)).toBeNull()
  }, 15000)

  it('探测不污染 per-server 健康状态', async () => {
    serverStore.upsertServer({ id: 'probe-live', name: 'probe', url: LIVE_URL, auth: AUTH })
    const before = serverStore.getHealth('probe-live')
    await serverStore.probeEndpoint(LIVE_URL, AUTH)
    expect(serverStore.getHealth('probe-live')).toBe(before)
  }, 15000)

  it('内网地址死、公网（回环）活 → 自动降级到可达地址', async () => {
    resetAllProbeStates()
    serverStore.removeServer('probe-live')

    const server = serverStore.upsertServer({
      id: 'probe-switch',
      name: 'dual live',
      url: DEAD_URL,
      endpoints: [
        { url: DEAD_URL, priority: 0 },
        { url: LIVE_URL, priority: 1 },
      ],
      auth: AUTH,
    })

    await probeServerOnce(server.id)
    expect(serverStore.getServerBaseUrl(server.id)).toBe(LIVE_URL)
    expect(getProbeState(server.id, DEAD_URL)?.reachable).toBe(false)
    expect(getProbeState(server.id, LIVE_URL)?.reachable).toBe(true)
  }, 30000)
})
