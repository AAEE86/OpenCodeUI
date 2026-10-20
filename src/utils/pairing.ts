// ============================================
// pair 配对链接（v2 服务端 v2.0.17+）
//
// `opencode pair` 打印一次性链接 `<server>/auth/connect/<code>`
// （5 分钟有效、一次性），二维码内容是 JSON {"code","urls":[...]}。
// 兑换：GET /auth/connect/<code> + Accept: application/json → { token }，
// token 即 Basic Auth 密码（用户名固定 opencode）。
//
// 语义对齐官方 packages/app/src/servers/connect/pairing.ts：
//   - 多地址并行竞速兑换，但优先保留第一个地址（QR 里地址的顺序是
//     用户挑选的顺序；局域网地址离开网络就失效，公网地址未必更近）
//   - 只有服务器的 401 回答才证明 code 已作废；地址不可达 ≠ 过期
//   - 旧版 `/connect#<credentials>` 链接单独识别，给出升级提示
// ============================================

export interface PairingLink {
  /** 可兑换的服务器地址（QR 载荷可能带多个） */
  urls: string[]
  code: string
}

export type RedeemResult =
  | {
      type: 'paired'
      /** 兑换实际使用的地址（竞速赢家 / 首选地址） */
      url: string
      /**
       * QR 载荷里的**全部**地址（归一化去重后，保持原顺序）。
       *
       * 兑换只证明 code 有效、token 可用；token 在服务器所有地址上通用，
       * 因此这里把完整地址集交给调用方保存为多地址（Issue #183）。
       */
      urls: string[]
      token: string
    }
  | { type: 'expired' }
  | { type: 'unreachable' }

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/

/** 纯服务器地址（无凭据/查询/片段），去掉尾部斜杠；非法返回 undefined */
function serverAddress(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.includes('://') && !/^https?:\/\//i.test(trimmed)) return undefined
  const url = URL.parse(trimmed)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return undefined
  if (url.username || url.password || url.search || url.hash) return undefined
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''))
}

/**
 * 解析 pair 链接或 QR 载荷。返回 undefined 表示「根本不是配对链接」，
 * 调用方按普通服务器地址或报错处理。
 */
export function parsePairingLink(value: string): PairingLink | undefined {
  const trimmed = value.trim()

  // QR 载荷：{"code","urls":[...]}
  if (trimmed.startsWith('{')) {
    let payload: unknown
    try {
      payload = JSON.parse(trimmed)
    } catch {
      return undefined
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
    const { code, urls } = payload as { code?: unknown; urls?: unknown }
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return undefined
    if (!Array.isArray(urls) || urls.length === 0) return undefined
    const addresses = urls.map(item => (typeof item === 'string' ? serverAddress(item) : undefined))
    if (addresses.some(address => address === undefined)) return undefined
    // 归一化后去重（原始字符串的尾部斜杠差异不代表不同地址）
    return { urls: [...new Set(addresses as string[])], code }
  }

  // 链接形态：<origin>/auth/connect/<code>
  const url = URL.parse(trimmed)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return undefined
  const code = /^\/auth\/connect\/([^/]+)$/.exec(url.pathname)?.[1]
  const address = serverAddress(url.origin)
  if (!code || !CODE_PATTERN.test(code) || !address) return undefined
  return { urls: [address], code }
}

/** 旧版 `/connect#<credentials>` / `/connect?data=` 配对链接（v2.0.17 之前） */
export function isLegacyPairingLink(value: string): boolean {
  const url = URL.parse(value.trim())
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false
  return url.pathname === '/connect' && (url.hash.length > 1 || url.searchParams.has('data'))
}

/**
 * 混合内容拦截：https 页面（在线版）访问 http 服务器会被浏览器拦，
 * 但 Secure Contexts 视 loopback http 为可信（localhost / *.localhost / 127.x / [::1]）。
 */
export function isMixedContent(pageUrl: string, address: string): boolean {
  const page = URL.parse(pageUrl)
  if (!page || page.protocol !== 'https:') return false
  const normalized = serverAddress(address)
  if (!normalized) return false
  const url = new URL(normalized)
  if (url.protocol !== 'http:') return false
  const host = url.hostname.replace(/\.$/, '')
  return !(host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(?:\.\d+){3}$/.test(host))
}

const REDEEM_TIMEOUT_MS = 5_000
const PREFER_FIRST_GRACE_MS = 1_000

type Attempt = { url: string; ok: boolean; token?: string; unauthorized?: boolean }

async function attemptRedeem(url: string, code: string): Promise<Attempt> {
  try {
    const response = await fetch(`${url}/auth/connect/${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS),
    })
    if (response.status === 401) return { url, ok: false, unauthorized: true }
    if (!response.ok) return { url, ok: false }
    const body: unknown = await response.json()
    const token =
      body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string'
        ? (body as { token: string }).token
        : undefined
    return token ? { url, ok: true, token } : { url, ok: false }
  } catch {
    return { url, ok: false }
  }
}

/**
 * 兑换配对 code。所有地址并行竞速（每个地址可能都可达同一台服务器，
 * 但 code 一次性，至多一个成功）；竞速赢家不是首选地址时，给首选地址
 * 1 秒宽限——它若也答了，用首选（官方 preferFirst 同款）。
 */
export async function redeemPairingLink(link: PairingLink): Promise<RedeemResult> {
  const attempts = link.urls.map(url => attemptRedeem(url, link.code))

  const firstSuccess = await Promise.any(
    attempts.map(promise => promise.then(attempt => (attempt.ok ? attempt : Promise.reject()))),
  ).catch(() => undefined)

  if (firstSuccess?.ok && firstSuccess.token) {
    let winner: { url: string; token: string } = { url: firstSuccess.url, token: firstSuccess.token }
    const preferred = link.urls[0]
    if (preferred && winner.url !== preferred) {
      const preferredAttempt = await Promise.race([
        attempts[0],
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), PREFER_FIRST_GRACE_MS)),
      ])
      if (preferredAttempt?.ok && preferredAttempt.token) {
        winner = { url: preferredAttempt.url, token: preferredAttempt.token }
      }
    }
    return { type: 'paired', url: winner.url, urls: link.urls, token: winner.token }
  }

  const settled = await Promise.all(attempts)
  return settled.some(attempt => attempt.unauthorized) ? { type: 'expired' } : { type: 'unreachable' }
}
