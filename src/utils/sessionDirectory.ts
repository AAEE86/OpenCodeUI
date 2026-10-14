// ============================================
// 会话路由目录提取
//
// v2 的 ApiSession 目录只在 location.directory（commit 16ea3ca8 迁移），
// 但命令面板等少数路径会补一个扁平 directory 字段。所有「按 session 打开
// 路由」的入口统一走这里，避免再有人读扁平字段拿到 undefined
// （活跃会话 tab 点了不切换工作区就是这个漏读导致的）。
// ============================================

export interface SessionDirectorySource {
  directory?: string
  location?: { directory?: string }
}

export function sessionRouteDirectory(session: SessionDirectorySource): string | undefined {
  return session.directory ?? session.location?.directory ?? undefined
}
