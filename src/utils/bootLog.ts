// ============================================
// 启动记录（诊断用）
//
// 每次模块加载（= 真实整页启动：冷启动、整页重载、WebView 崩溃后
// 系统重载）记一个时间戳到 localStorage。SPA 路由切换不会触发。
// 「设置 → 关于 → 诊断」展示，用于判断用户感知的"刷新"是不是真重载。
// ============================================

const BOOT_LOG_KEY = 'ocui.bootLog'
const MAX_ENTRIES = 30

export function recordBoot(): void {
  try {
    const raw = localStorage.getItem(BOOT_LOG_KEY)
    const log: unknown = raw ? JSON.parse(raw) : []
    const entries = Array.isArray(log) ? log.filter((t): t is number => typeof t === 'number') : []
    entries.push(Date.now())
    localStorage.setItem(BOOT_LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // 隐私模式等 localStorage 不可写的场景，忽略
  }
}

export function readBootLog(): number[] {
  try {
    const raw = localStorage.getItem(BOOT_LOG_KEY)
    const log: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(log) ? log.filter((t): t is number => typeof t === 'number') : []
  } catch {
    return []
  }
}
