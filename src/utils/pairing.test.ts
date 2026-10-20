import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLegacyPairingLink, isMixedContent, parsePairingLink, redeemPairingLink } from './pairing'

// ============================================
// pair 配对链接（对齐官方 servers/connect/pairing.ts 语义）
// ============================================

describe('parsePairingLink', () => {
  it('解析 <origin>/auth/connect/<code> 链接', () => {
    expect(parsePairingLink(' http://192.168.1.2:49374/auth/connect/abc_DEF-123 ')).toEqual({
      urls: ['http://192.168.1.2:49374'],
      code: 'abc_DEF-123',
    })
  })

  it('解析 QR 载荷 {"code","urls"} 并去重', () => {
    expect(
      parsePairingLink(
        JSON.stringify({
          code: 'abc',
          urls: ['http://192.168.1.2:49374', 'https://route.device.opentunnel.xyz', 'http://192.168.1.2:49374/'],
        }),
      ),
    ).toEqual({
      urls: ['http://192.168.1.2:49374', 'https://route.device.opentunnel.xyz'],
      code: 'abc',
    })
  })

  it('拒绝非配对输入', () => {
    expect(parsePairingLink('http://192.168.1.2:49374/auth/connect/')).toBeUndefined()
    expect(parsePairingLink('http://192.168.1.2:49374/auth/connect/abc/extra')).toBeUndefined()
    expect(parsePairingLink('http://192.168.1.2:49374/connect#abc')).toBeUndefined()
    expect(parsePairingLink('opencode-ios://auth/connect/abc')).toBeUndefined()
    expect(parsePairingLink('192.168.1.2:49374')).toBeUndefined()
    expect(parsePairingLink('http://192.168.1.2:49374/auth/connect/a b')).toBeUndefined()
    expect(parsePairingLink(JSON.stringify({ code: 'abc', urls: [] }))).toBeUndefined()
    expect(parsePairingLink(JSON.stringify({ code: 'a/b', urls: ['http://192.168.1.2:49374'] }))).toBeUndefined()
    expect(parsePairingLink(JSON.stringify({ urls: ['http://192.168.1.2:49374'] }))).toBeUndefined()
    expect(parsePairingLink('{not json')).toBeUndefined()
    expect(parsePairingLink('')).toBeUndefined()
  })

  it('链接里内嵌的凭据被剥离（官方同款：只取 origin），QR 地址带凭据/查询则拒绝', () => {
    expect(parsePairingLink('http://user:pass@192.168.1.2:49374/auth/connect/abc')).toEqual({
      urls: ['http://192.168.1.2:49374'],
      code: 'abc',
    })
    expect(parsePairingLink(JSON.stringify({ code: 'abc', urls: ['http://192.168.1.2:49374?x=1'] }))).toBeUndefined()
    expect(
      parsePairingLink(JSON.stringify({ code: 'abc', urls: ['http://user:pass@192.168.1.2:49374'] })),
    ).toBeUndefined()
  })
})

describe('isLegacyPairingLink', () => {
  it('识别旧版 /connect#... 与 /connect?data= 链接', () => {
    expect(isLegacyPairingLink('http://192.168.1.2:49374/connect#abc')).toBe(true)
    expect(isLegacyPairingLink('http://192.168.1.2:49374/connect?data=abc')).toBe(true)
    expect(isLegacyPairingLink('http://192.168.1.2:49374/auth/connect/abc')).toBe(false)
    expect(isLegacyPairingLink('not a url')).toBe(false)
  })
})

describe('isMixedContent', () => {
  const page = 'https://lehhair.github.io/OpenCodeUI/'

  it('https 页面 + http 远程地址 → 拦截', () => {
    expect(isMixedContent(page, 'http://192.168.1.2:49374')).toBe(true)
  })

  it('loopback http 视为可信（Secure Contexts）', () => {
    expect(isMixedContent(page, 'http://127.0.0.1:49374')).toBe(false)
    expect(isMixedContent(page, 'http://localhost:49374')).toBe(false)
    expect(isMixedContent(page, 'http://[::1]:49374')).toBe(false)
  })

  it('http 页面或 https 目标不拦截', () => {
    expect(isMixedContent('http://localhost:3000', 'http://192.168.1.2:49374')).toBe(false)
    expect(isMixedContent(page, 'https://route.device.opentunnel.xyz')).toBe(false)
  })
})

// ============================================
// 兑换
// ============================================

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('redeemPairingLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功兑换返回 token 与地址', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { token: 'secret-token' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await redeemPairingLink({ urls: ['http://server'], code: 'abc' })

    // urls 回传完整地址集（Issue #183：兑换后要保存全部地址）
    expect(result).toEqual({
      type: 'paired',
      url: 'http://server',
      urls: ['http://server'],
      token: 'secret-token',
    })
    const [requestUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(requestUrl).toBe('http://server/auth/connect/abc')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  it('401 → expired（只有服务器的回答才能证明 code 作废）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401)))
    await expect(redeemPairingLink({ urls: ['http://server'], code: 'abc' })).resolves.toEqual({ type: 'expired' })
  })

  it('网络错误 → unreachable（不是过期）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(redeemPairingLink({ urls: ['http://server'], code: 'abc' })).resolves.toEqual({ type: 'unreachable' })
  })

  it('一个地址 401、其余不可达 → expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('http://a')) return jsonResponse(401)
        throw new TypeError('fetch failed')
      }),
    )
    await expect(redeemPairingLink({ urls: ['http://a', 'http://b'], code: 'abc' })).resolves.toEqual({
      type: 'expired',
    })
  })

  it('首选地址稍后也成功 → 优先保留首选地址（官方 preferFirst）', async () => {
    let resolveFirst!: (value: Response) => void
    const firstPromise = new Promise<Response>(resolve => {
      resolveFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('http://first')) return firstPromise
        return Promise.resolve(jsonResponse(200, { token: 'token-from-second' }))
      }),
    )

    const pending = redeemPairingLink({ urls: ['http://first', 'http://second'], code: 'abc' })
    // 让竞速先被 second 赢下，再在 1s 宽限内放行 first
    await new Promise(resolve => setTimeout(resolve, 20))
    resolveFirst(jsonResponse(200, { token: 'token-from-first' }))

    await expect(pending).resolves.toEqual({
      type: 'paired',
      url: 'http://first',
      urls: ['http://first', 'http://second'],
      token: 'token-from-first',
    })
  })

  it('首选地址不可达 → 用竞速赢家的地址', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('http://first')) return Promise.reject(new TypeError('fetch failed'))
        return Promise.resolve(jsonResponse(200, { token: 'token-from-second' }))
      }),
    )

    await expect(redeemPairingLink({ urls: ['http://first', 'http://second'], code: 'abc' })).resolves.toEqual({
      type: 'paired',
      url: 'http://second',
      urls: ['http://first', 'http://second'],
      token: 'token-from-second',
    })
  })

  it('200 但载荷缺 token → 视为失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { notToken: true })))
    await expect(redeemPairingLink({ urls: ['http://server'], code: 'abc' })).resolves.toEqual({ type: 'unreachable' })
  })
})
