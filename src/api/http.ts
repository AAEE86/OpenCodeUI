// ============================================
// HTTP Utilities
// 仅保留给 SSE / PTY WebSocket 使用的 URL 与 auth 辅助函数
// ============================================

import { serverStore, makeBasicAuthHeader } from '../store/serverStore'

/**
 * 把相对 API 地址补成绝对地址。
 *
 * `@opencode/client` 内部用 `new URL(options.baseUrl)` 构造请求地址，
 * 只接受绝对 URL。Docker / standalone 镜像把 `VITE_API_BASE_URL` 设为
 * 同源前缀 `/api`，原样交给 SDK 会在**发请求前**抛 `Invalid URL`：
 * 健康检查走原生 fetch（支持相对路径）显示在线，但会话、模型、消息、
 * 终端等所有 SDK 请求全部失败。
 *
 * 这里按当前页面 origin 补全，既保留反代下的 `/api` 前缀部署方式，
 * 也兼容 Tauri / 桌面端直接配置绝对地址的场景。
 */
export function toAbsoluteBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl
  // 已是绝对 URL（带 scheme）就原样返回，不去尾部斜杠，避免改掉用户配置
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(baseUrl)) return baseUrl
  if (typeof window === 'undefined') return baseUrl
  // file:// 等非标准页面的 origin 是字符串 'null'，不能作为 URL base
  const origin = window.location.origin
  if (!origin || origin === 'null') return baseUrl
  return new URL(baseUrl, origin).toString().replace(/\/+$/, '')
}

/**
 * 获取 API Base URL
 * 优先使用 serverStore 中的活动服务器，回退到常量
 * 返回值保证是绝对地址（SDK / PTY 都要求完整 URL）
 * @param serverId 指定服务器（缺省用活动服务器）
 */
export function getApiBaseUrl(serverId?: string): string {
  const raw = serverId ? serverStore.getServerBaseUrl(serverId) : serverStore.getActiveBaseUrl()
  return toAbsoluteBaseUrl(raw)
}

/**
 * 获取指定服务器的 Authorization header
 * 如果服务器配置了密码则返回 Basic Auth header，否则返回 undefined
 * @param serverId 指定服务器（缺省用活动服务器）
 */
export function getAuthHeader(serverId?: string): Record<string, string> {
  const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
  if (auth?.password) {
    return { Authorization: makeBasicAuthHeader(auth) }
  }
  return {}
}

type QueryValue = string | number | boolean | undefined

/**
 * 构建查询字符串
 * 值会进行 URL 编码以安全处理空格、特殊字符等
 * （Go 后端的 r.URL.Query().Get() 会自动解码）
 */
export function buildQueryString(params: Record<string, QueryValue>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : ''
}
