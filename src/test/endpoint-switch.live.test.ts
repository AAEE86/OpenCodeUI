// 真实服务端上的完整切换链验证（默认跳过）：
// 死地址 + 活地址 → 自动降级 → SDK 指向新地址 → 能真正拉到数据。
//
//   OPENCODE_PASSWORD=test123 opencode serve --port 4199 --hostname 0.0.0.0
//   VITE_OPENCODE_LIVE_E2E=1 npx vitest run src/test/endpoint-switch.live.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serverStore } from '../store/serverStore'
import { probeServerOnce, resetAllProbeStates } from '../store/endpointProbe'
import { getSessions } from '../api/session'
import { getLocationInfo } from '../api/global'

const LIVE = import.meta.env.VITE_OPENCODE_LIVE_E2E === '1'
const LIVE_URL = 'http://127.0.0.1:4199'
const DEAD_URL = 'http://127.0.0.1:4198'
const AUTH = { username: 'opencode', password: 'test123' }
const SERVER_ID = 'switch-live'

describe.skipIf(!LIVE)('endpoint switch against a live server', () => {
  beforeAll(() => {
    resetAllProbeStates()
    serverStore.upsertServer({
      id: SERVER_ID,
      name: 'dual live',
      url: DEAD_URL,
      endpoints: [
        { url: DEAD_URL, priority: 0 },
        { url: LIVE_URL, priority: 1 },
      ],
      auth: AUTH,
    })
    serverStore.setActiveServer(SERVER_ID)
  })

  it('死的内网地址 → 自动降级到可达地址', async () => {
    await probeServerOnce(SERVER_ID)
    expect(serverStore.getServerBaseUrl(SERVER_ID)).toBe(LIVE_URL)
    expect(serverStore.getActiveBaseUrl()).toBe(LIVE_URL)
  }, 30000)

  it('降级后 SDK / http 层真的连到新地址，能拉到数据', async () => {
    const loc = await getLocationInfo(undefined, SERVER_ID)
    expect(loc.directory).toBeTruthy()

    const sessions = await getSessions({ limit: 3 }, SERVER_ID)
    expect(Array.isArray(sessions)).toBe(true)
  }, 30000)

  it('锁定后探测让位，生效地址不变', async () => {
    serverStore.setLockedEndpoint(SERVER_ID, LIVE_URL)
    resetAllProbeStates()

    // 即便主地址（死的）被判可达，锁定也不让它切
    await probeServerOnce(SERVER_ID)
    expect(serverStore.getServerBaseUrl(SERVER_ID)).toBe(LIVE_URL)
    expect(serverStore.getLockedEndpointUrl(SERVER_ID)).toBe(LIVE_URL)
  }, 30000)

  it('解锁后恢复自动模式', async () => {
    serverStore.setLockedEndpoint(SERVER_ID, null)
    expect(serverStore.getLockedEndpointUrl(SERVER_ID)).toBeNull()
  })
})
