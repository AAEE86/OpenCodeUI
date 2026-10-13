/**
 * v2 CodeMode（execute 工具）的子调用分析。
 *
 * CodeMode 原理：模型不直接调工具，而是写一段 JS 传给 execute，
 * 代码里通过 `tools.xxx(...)`（含 `tools.ns["tool-name"](...)` 括号写法）
 * 调用目录里的工具。因此有两个数据源：
 *
 * - `metadata.toolCalls`：运行时真实调用记录（progress 流式推送），带状态
 * - `input.code`：静态解析代码里的 `tools.` 调用点，流式早期就可用
 */

import { currentToolInput, currentToolMetadata } from '../../../types/api/toolState'
import type { AssistantTool } from '../../../types/api/message'

export interface CodeModeSubCall {
  tool: string
  status?: 'running' | 'completed' | 'error'
}

/** 运行时子调用记录：`metadata.toolCalls: [{ tool, status, input? }]`，跳过畸形条目 */
export function executeSubCalls(metadata: Record<string, unknown>): CodeModeSubCall[] {
  const calls = metadata.toolCalls
  if (!Array.isArray(calls)) return []

  const result: CodeModeSubCall[] = []
  for (const call of calls) {
    if (!call || typeof call !== 'object' || Array.isArray(call)) continue
    const tool = (call as { tool?: unknown }).tool
    if (typeof tool !== 'string' || !tool) continue
    const status = (call as { status?: unknown }).status
    result.push({
      tool,
      status: status === 'running' || status === 'completed' || status === 'error' ? status : undefined,
    })
  }
  return result
}

/**
 * 从 CodeMode 代码里静态解析 `tools.` 调用路径（按出现顺序，保留重复）。
 * 支持点写法和括号写法：`tools.read(...)`、`tools.fs.read(...)`、
 * `tools.ns["tool-name"](...)`（括号访问与上一段之间没有点）。
 */
export function parseCodeModeToolCallNames(code: string): string[] {
  // tools. 后：首段为标识符或 ["字符串"]；续段为 .ident / .["x"] / 无点 ["x"]
  const pattern =
    /\btools\.((?:[A-Za-z_$][\w$]*|\[["'][^"']+["']])(?:(?:\.(?:[A-Za-z_$][\w$]*|\[["'][^"']+["']]))|(?:\[["'][^"']+["']\]))*)/g

  const names: string[] = []
  for (const match of code.matchAll(pattern)) {
    const path = match[1]
      // 括号段 ["tool-name"] → 点段 .tool-name，统一按点切
      .replace(/\[(["'])([^"']+)\1\]/g, '.$2')
      .split('.')
      .filter(Boolean)
      .join('.')
    if (path) names.push(path)
  }
  return names
}

// ============================================
// 折叠摘要字符串（连续同名 ×n，失败 ✗）
// ============================================

interface SubCallSegment {
  tool: string
  failed: boolean
  count: number
}

function formatSegments(segments: SubCallSegment[]): string | undefined {
  if (segments.length === 0) return undefined
  return segments
    .map(seg => `${seg.tool}${seg.count > 1 ? ` ×${seg.count}` : ''}${seg.failed ? ' ✗' : ''}`)
    .join(' → ')
}

function pushSegment(segments: SubCallSegment[], tool: string, failed: boolean) {
  const last = segments[segments.length - 1]
  if (last && last.tool === tool && last.failed === failed) {
    last.count += 1
  } else {
    segments.push({ tool, failed, count: 1 })
  }
}

/** 运行时子调用摘要，如 "read ×2 → bash ✗ → write"；无记录返回 undefined */
export function executeSubCallSummary(metadata: Record<string, unknown>): string | undefined {
  const segments: SubCallSegment[] = []
  for (const call of executeSubCalls(metadata)) {
    pushSegment(segments, call.tool, call.status === 'error')
  }
  return formatSegments(segments)
}

/** 代码静态解析摘要（无状态），如 "exa.web_search_exa → write"；无调用点返回 undefined */
export function parseCodeModeToolCalls(code: string): string | undefined {
  const segments: SubCallSegment[] = []
  for (const tool of parseCodeModeToolCallNames(code)) {
    pushSegment(segments, tool, false)
  }
  return formatSegments(segments)
}

/**
 * execute（v2 CodeMode）的子工具展开：优先运行时记录（metadata.toolCalls，带状态），
 * 否则静态解析 code 里的 tools.xxx(...) 调用点。
 * 非 execute / 探测不到任何子调用时返回 null（调用方自行兜底）。
 */
export function expandCodeModeSubCalls(part: AssistantTool): CodeModeSubCall[] | null {
  if (part.name.toLowerCase() !== 'execute') return null
  const runtime = executeSubCalls(currentToolMetadata(part))
  if (runtime.length > 0) return runtime
  const input = currentToolInput(part)
  const code = typeof input.code === 'string' ? input.code : ''
  if (!code.trim()) return null
  const names = parseCodeModeToolCallNames(code)
  return names.length > 0 ? names.map(tool => ({ tool })) : null
}
