// 真实服务端上的切换延迟验证（默认跳过）。
//
// 场景：主地址是一个**必然拒绝连接**的端口（模拟换了网络后旧入口不可达），
// 备用地址是真实服务端。验证两轮探测内就切走，且切换后 SDK 真能拉到数据。
//
//   OPENCODE_PASSWORD=test123 opencode serve --port 4199 --hostname 0.0.0.0
//   VITE_OPENCODE_LIVE_E2E=1 npx vitest run src/test/endpoint-latency.live.test.ts
import { describe, it, expect } from 'vitest'
import { serverStore } from '../store/serverStore'
import { probeServerOnce, resetAllProbeStates } from '../store/endpointProbe'
import { getLocationInfo } from '../api/global'

const LIVE = import.meta.env.VITE_OPENCODE_LIVE_E2E === '1'
const LIVE_URL = 'http://127.0.0.1:4199'
/** 没有进程监听的端口：连接会被立即拒绝（等价于「这条入口已经不可达」） */
const DEAD_URL = 'http://127.0.0.1:4298'
const AUTH = { username: 'opencode', password: 'test123' }
const SERVER_ID = 'latency-live'

describe.skipIf(!LIVE)('切换延迟与端到端恢复', () => {
  it('主地址不可达 → 首次探测即切到备用（启动场景）', async () => {
    resetAllProbeStates()
    const server = serverStore.upsertServer({
      id: SERVER_ID,
      name: 'latency',
      url: DEAD_URL,
      endpoints: [
        { url: DEAD_URL, priority: 0 },
        { url: LIVE_URL, priority: 1 },
      ],
      auth: AUTH,
    })
    serverStore.setActiveServer(server.id)

    const startedAt = Date.now()
    await probeServerOnce(server.id)
    const elapsed = Date.now() - startedAt

    // 首次选择不等失败阈值：主地址探一次不通就直接用备用
    expect(serverStore.getServerBaseUrl(server.id)).toBe(LIVE_URL)
    // 连接拒绝是快速的，不该拖到探测超时（4s）
    expect(elapsed).toBeLessThan(5_000)
  }, 30000)

  it('主地址不可达且已在备用 → 保持，不乱切', async () => {
    await probeServerOnce(SERVER_ID)
    expect(serverStore.getServerBaseUrl(SERVER_ID)).toBe(LIVE_URL)
  }, 30000)

  it('切到备用后 SDK 立刻能拉到数据', async () => {
    const loc = await getLocationInfo(undefined, SERVER_ID)
    expect(loc.directory).toBeTruthy()
  }, 30000)
})
