// 多地址（Issue #183）：地址归一化、生效地址切换、锁定、持久化与门控语义。
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
})

describe('normalizeEndpoints', () => {
  it('去尾部斜杠、去重、按 priority 升序', async () => {
    const { normalizeEndpoints } = await import('./serverStore')

    expect(
      normalizeEndpoints([
        { url: 'https://public.example.com/', priority: 1 },
        { url: 'http://192.168.1.5:4096', priority: 0 },
        { url: 'http://192.168.1.5:4096/', priority: 0 },
      ]),
    ).toEqual([
      { url: 'http://192.168.1.5:4096', priority: 0 },
      { url: 'https://public.example.com', priority: 1 },
    ])
  })

  it('丢弃非法项，空结果返回 undefined（退回单地址语义）', async () => {
    const { normalizeEndpoints } = await import('./serverStore')

    expect(normalizeEndpoints([])).toBeUndefined()
    expect(normalizeEndpoints(null)).toBeUndefined()
    expect(normalizeEndpoints([null, 42, 'x', { url: '' }, {}])).toBeUndefined()
    expect(normalizeEndpoints([{ url: '  http://a.test// ', priority: 'bad' }])).toEqual([
      { url: 'http://a.test', priority: 0 },
    ])
  })

  it('保留 label，空 label 剔除', async () => {
    const { normalizeEndpoints } = await import('./serverStore')

    expect(
      normalizeEndpoints([
        { url: 'http://lan.test', priority: 0, label: ' 内网 ' },
        { url: 'http://wan.test', priority: 1, label: '   ' },
      ]),
    ).toEqual([
      { url: 'http://lan.test', priority: 0, label: '内网' },
      { url: 'http://wan.test', priority: 1 },
    ])
  })
})

describe('serverStore 多地址', () => {
  it('默认退化：无 endpoints 时 baseUrl 就是 server.url', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({ name: 'single', url: 'http://only.test/' })

    expect(server.endpoints).toBeUndefined()
    expect(serverStore.getServerBaseUrl(server.id)).toBe('http://only.test')
    expect(serverStore.getActiveEndpointUrl(server.id)).toBe('http://only.test')
  })

  it('addServer 归一化 endpoints 并按优先级排序', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'https://wan.test',
      endpoints: [
        { url: 'https://wan.test/', priority: 1 },
        { url: 'http://lan.test/', priority: 0 },
      ],
    })

    expect(server.endpoints).toEqual([
      { url: 'http://lan.test', priority: 0 },
      { url: 'https://wan.test', priority: 1 },
    ])
    // endpoints 存在时以「优先级最高」为默认入口——这就是 issue 要的
    // 「默认优先内网」：配对时把内网排第一即可，无需额外开关
    expect(serverStore.getServerBaseUrl(server.id)).toBe('http://lan.test')
    expect(serverStore.getActiveEndpointUrl(server.id)).toBe('http://lan.test')
  })

  it('setActiveEndpoint 切换 baseUrl 并广播 endpoint-switch（不是 server-switch）', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })
    const listener = vi.fn()
    serverStore.onServerChange(listener)

    expect(serverStore.setActiveEndpoint(server.id, 'https://wan.test')).toBe(true)

    expect(serverStore.getServerBaseUrl(server.id)).toBe('https://wan.test')
    expect(listener).toHaveBeenCalledWith(server.id, 'endpoint-switch')
  })

  it('setActiveEndpoint 拒绝不属于该服务器的地址', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({ name: 'single', url: 'http://only.test' })

    expect(serverStore.setActiveEndpoint(server.id, 'http://evil.test')).toBe(false)
    expect(serverStore.getServerBaseUrl(server.id)).toBe('http://only.test')
  })

  it('重复切到同一地址不广播（幂等）', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://a.test',
      endpoints: [
        { url: 'http://a.test', priority: 0 },
        { url: 'http://b.test', priority: 1 },
      ],
    })
    const listener = vi.fn()

    serverStore.setActiveEndpoint(server.id, 'http://b.test')
    serverStore.onServerChange(listener)
    expect(serverStore.setActiveEndpoint(server.id, 'http://b.test')).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('锁定地址后自动探测必须让位（lockedUrl 可读）', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })

    expect(serverStore.setLockedEndpoint(server.id, 'https://wan.test')).toBe(true)
    expect(serverStore.getLockedEndpointUrl(server.id)).toBe('https://wan.test')
    expect(serverStore.getServerBaseUrl(server.id)).toBe('https://wan.test')

    // 解锁恢复自动模式
    expect(serverStore.setLockedEndpoint(server.id, null)).toBe(true)
    expect(serverStore.getLockedEndpointUrl(server.id)).toBeNull()
  })

  it('删除地址后回收生效/锁定指针，避免指向已不存在的地址', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })
    serverStore.setLockedEndpoint(server.id, 'https://wan.test')

    // 编辑时把 wan 地址删掉
    serverStore.updateServer(server.id, { endpoints: [{ url: 'http://lan.test', priority: 0 }] })

    expect(serverStore.getLockedEndpointUrl(server.id)).toBeNull()
    expect(serverStore.getServerBaseUrl(server.id)).toBe('http://lan.test')
  })

  it('updateServer 传 endpoints: undefined 表示清空（编辑界面删光备用地址）', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })
    expect(serverStore.getServer(server.id)?.endpoints).toHaveLength(2)

    // 用 hasOwnProperty 判断而不是值判断：否则「清空」会被当成「本次没改」
    serverStore.updateServer(server.id, { endpoints: undefined })

    expect(serverStore.getServer(server.id)?.endpoints).toBeUndefined()
    expect(serverStore.getServerBaseUrl(server.id)).toBe('http://lan.test')
  })

  it('upsertServer 删掉地址后同样回收指针（WSL 重启重注册走这条路）', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.upsertServer({
      id: 'wsl-like',
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })
    serverStore.setLockedEndpoint(server.id, 'https://wan.test')
    expect(serverStore.getServerBaseUrl(server.id)).toBe('https://wan.test')

    // 外部模块（WSL 就绪推送）用新地址集覆盖：wan 没了
    serverStore.upsertServer({
      id: 'wsl-like',
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [{ url: 'http://lan.test', priority: 0 }],
    })

    // 不回收的话 baseUrl 会一直停在已经不存在的 wan 上
    expect(serverStore.getLockedEndpointUrl(server.id)).toBeNull()
    expect(serverStore.getServerBaseUrl(server.id)).toBe('http://lan.test')
  })

  it('getActiveBaseUrl 跟随生效地址（sdk/http 不传 serverId 时走这条路）', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })
    serverStore.setActiveServer(server.id)

    expect(serverStore.getActiveBaseUrl()).toBe('http://lan.test')

    serverStore.setActiveEndpoint(server.id, 'https://wan.test')
    expect(serverStore.getActiveBaseUrl()).toBe('https://wan.test')
  })

  it('isLocalServer 判的是当前生效地址，不是配置主地址', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://127.0.0.1:4096',
      endpoints: [
        { url: 'http://127.0.0.1:4096', priority: 0 },
        { url: 'http://192.168.1.5:4096', priority: 1 },
      ],
    })

    // 走回环入口 → 同机
    expect(serverStore.isLocalServer(server.id)).toBe(true)

    // 降级到内网 IP → 不再同机（拖入的文件必须上传）
    serverStore.setActiveEndpoint(server.id, 'http://192.168.1.5:4096')
    expect(serverStore.isLocalServer(server.id)).toBe(false)
  })

  it('endpoints 走 localStorage 持久化，重载后仍在', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })

    const stored = JSON.parse(localStorage.getItem('opencode-servers') ?? '[]') as Array<{
      id: string
      endpoints?: unknown
    }>
    const persisted = stored.find(item => item.id === server.id)
    expect(persisted?.endpoints).toEqual([
      { url: 'http://lan.test', priority: 0 },
      { url: 'https://wan.test', priority: 1 },
    ])

    // 重载：运行时的 activeUrl / lockedUrl 不持久化，必须重新判断
    vi.resetModules()
    const reloaded = await import('./serverStore')
    expect(reloaded.serverStore.getServer(server.id)?.endpoints).toHaveLength(2)
    expect(reloaded.serverStore.getServerBaseUrl(server.id)).toBe('http://lan.test')
  })

  it('删除服务器时清理运行时状态', async () => {
    const { serverStore } = await import('./serverStore')
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://a.test',
      endpoints: [
        { url: 'http://a.test', priority: 0 },
        { url: 'http://b.test', priority: 1 },
      ],
    })
    serverStore.setLockedEndpoint(server.id, 'http://b.test')
    expect(serverStore.getLockedEndpointUrl(server.id)).toBe('http://b.test')

    expect(serverStore.removeServer(server.id)).toBe(true)
    // 服务器已删除 → 运行时状态不应残留（读取返回空语义）
    expect(serverStore.getServer(server.id)).toBeNull()
    expect(serverStore.getLockedEndpointUrl(server.id)).toBeNull()
  })

  /**
   * `server.url` 是主地址的镜像。设置页里地址列表是唯一数据源，
   * 若两者能各走各的，「主地址」和「生效地址」就成了两个概念。
   */
  it('server.url 始终等于 endpoints[0]，无论调用方传什么', async () => {
    const { serverStore } = await import('./serverStore')

    // 添加时 url 与 endpoints[0] 不一致 → 以 endpoints 为准
    const server = serverStore.addServer({
      name: 'dual',
      url: 'http://stale.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    })
    expect(server.url).toBe('http://lan.test')

    // 只改 endpoints 不传 url → url 跟着首项走
    serverStore.updateServer(server.id, {
      endpoints: [
        { url: 'https://wan.test', priority: 0 },
        { url: 'http://lan.test', priority: 1 },
      ],
    })
    expect(serverStore.getServer(server.id)?.url).toBe('https://wan.test')

    // 清空 endpoints → url 保持最后的值（单地址语义）
    serverStore.updateServer(server.id, { endpoints: undefined })
    expect(serverStore.getServer(server.id)?.url).toBe('https://wan.test')
    expect(serverStore.getServer(server.id)?.endpoints).toBeUndefined()
  })
})

describe('endpoint-switch 的门控语义', () => {
  it('换地址不影响数据主体：两种绑定都返回 false', async () => {
    const { affectsBoundServer } = await import('./serverChangeScope')

    // 跟随 active：不触发「清空 → 重拉」
    expect(affectsBoundServer(undefined, 'local', 'endpoint-switch', 'local')).toBe(false)
    // 固定绑定同一台：同样不重置数据（旧地址可能仍可达，重置只会闪）
    expect(affectsBoundServer('local', 'local', 'endpoint-switch', 'local')).toBe(false)
  })

  it('对比：server-runtime-updated 在固定绑定时仍需重置（旧端口已死）', async () => {
    const { affectsBoundServer } = await import('./serverChangeScope')

    expect(affectsBoundServer('local', 'local', 'server-runtime-updated', 'local')).toBe(true)
  })
})
