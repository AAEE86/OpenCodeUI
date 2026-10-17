// ============================================
// Config API — OpenCode v2 原生
//
// ## v1 → v2 的重大变化
//
// v1：`config.get()` 返回一份扁平可读写 Config；
//     `config.update(config, dir)` 可写回任意字段；
//     另有 `global.config.get/update` 管全局配置；
//     `config.providers()` 拿 provider 列表。
//
// v2：
//   - `config.get({ location })` → **`ConfigEntry[]`**（配置来源清单，
//     按优先级从低到高排列）：
//       { type: 'document', path?, info }  真实配置文档，`info` 是内容
//       { type: 'directory', path }        目录来源标记
//     生效值 = **逐字段**取最后一个定义了该字段的 document
//     （官方 core 的 Config.latest 语义，不是整体深合并）。
//     第一个 `type: 'directory'` 条目是全局/项目配置的分界线：
//     它之前的是全局来源，之后（含）的是项目/目录级来源
//     （官方 app: settings/general/controllers.ts）。
//   - `config.update(input)` **只接受 `{ shell }`** —— 没有整份配置写回，
//     也没有 global 配置写入。
//   - `config.providers()` 被 `model.list()` / `provider.list()` 取代。
//   - `config.shells()` 提供可用 shell 列表（取代 v1 的 `pty.shells()`）。
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import type { ConfigDocument, ConfigSource, ConfigInfo, ConfigShellsResponse } from './types'

/**
 * 获取配置来源清单。
 *
 * v2 的 `config.get()` 直接返回 `ConfigEntry[]`（不是包装对象）。
 */
export async function getConfigSources(directory?: string, serverId?: string): Promise<ConfigSource[]> {
  const sdk = getSDKClient(serverId)
  return await sdk.config.get({ location: locationParam(directory, serverId) })
}

/**
 * 获取合并后的生效配置。
 *
 * v2 返回来源数组；这里按官方 `Config.latest` 语义逐字段取最后定义者，
 * 让调用点仍能拿到一份可读的配置对象。
 */
export async function getConfig(directory?: string, serverId?: string): Promise<ConfigInfo> {
  const sources = await getConfigSources(directory, serverId)
  return mergeConfigInfo(sources)
}

/** 官方探测的可写文档名，按优先级从低到高（写存在的最后一个）。 */
const CONFIG_DOCUMENT_NAMES = ['opencode.json', 'opencode.jsonc']

function isDocument(source: ConfigSource): source is ConfigDocument {
  return source.type === 'document'
}

/**
 * 取全局来源（第一个 `type: 'directory'` 标记之前）。
 *
 * 不带 location 的 `config.get()` 也会返回默认 location 的项目级来源，
 * 项目来源从那个 directory 条目开始（与官方 core 的 `Config.load` 一致）。
 */
function globalSources(sources: ConfigSource[]): ConfigSource[] {
  const boundary = sources.findIndex(source => source.type === 'directory')
  return boundary === -1 ? sources : sources.slice(0, boundary)
}

/** 拼一个配置文档路径，兼顾 Windows 与 POSIX 分隔符。 */
function joinDocumentPath(directory: string, name: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '')
  const separator = trimmed.includes('\\') ? '\\' : '/'
  return `${trimmed}${separator}${name}`
}

/**
 * 获取全局（无 location）配置。
 *
 * 只合并**有 `path` 的全局文档**：wellknown 远程文档没有 `path`，
 * 把它们的值当成可编辑基线会让用户不小心写进本地文件。
 */
export async function getGlobalConfig(serverId?: string): Promise<ConfigInfo> {
  const sdk = getSDKClient(serverId)
  const sources = await sdk.config.get()
  return mergeConfigInfo(globalSources(sources).filter(source => isDocument(source) && Boolean(source.path)))
}

/**
 * 合并若干配置文档为生效配置。
 *
 * 对齐官方 core 的 `Config.latest`：逐字段取最后一个定义了该字段的
 * document（嵌套对象**整体取代**，不做跨文档深并集）。
 */
export function mergeConfigInfo(sources: ConfigSource[]): ConfigInfo {
  const merged: Record<string, unknown> = {}
  for (const source of sources) {
    if (source.type !== 'document') continue
    for (const [key, value] of Object.entries(source.info as Record<string, unknown>)) {
      if (value !== undefined) merged[key] = value
    }
  }
  return merged as ConfigInfo
}

/**
 * 更新 shell。
 *
 * v2 的 `config.update` 只支持 shell 这一个字段。
 */
export async function updateShell(shell: string | null, serverId?: string): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.config.update({ shell })
}

/**
 * 定位全局可写配置文档。
 *
 * 官方 `Config.update` 的写入目标是**全局配置目录**里的
 * `opencode.json` → `opencode.jsonc`，取其中存在的最后一个；
 * 都不存在时新建 `opencode.jsonc`（见 core 的 `ConfigDiscovery.names` 与 `Config.update`）。
 * 这里与官方保持一致——不写项目级文档，避免编辑器把全局设置落到项目里。
 *
 * @returns 待写路径
 */
export async function findGlobalConfigDocumentPath(serverId?: string): Promise<string> {
  const sdk = getSDKClient(serverId)
  const sources = await sdk.config.get()
  const global = globalSources(sources)
  // 优先级顺序里最后一个存在的文档，写入它才不会被更低的来源覆盖
  const target = global.filter(isDocument).filter(source => source.path).at(-1)
  if (target?.path) return target.path

  const directory = global.find(source => source.type === 'directory')
  if (directory) return joinDocumentPath(directory.path, CONFIG_DOCUMENT_NAMES[CONFIG_DOCUMENT_NAMES.length - 1])

  throw new Error('No global config directory found')
}

/**
 * 把配置对象写回**全局**配置文档。
 *
 * ⚠️ 这是整文件写入：会以标准 JSON 覆盖原文件，**JSONC 注释与原始排版会丢失**。
 * v2 没有字段级写入接口，这是唯一能真正持久化配置的途径。
 *
 * @returns 写入的路径
 */
export async function writeGlobalConfigDocument(config: ConfigInfo, serverId?: string): Promise<string> {
  const path = await findGlobalConfigDocumentPath(serverId)

  const sdk = getSDKClient(serverId)
  const payload = new TextEncoder().encode(`${JSON.stringify(config, null, 2)}\n`)
  await sdk.file.write({ path, payload })
  return path
}

/**
 * 获取可用 shell 列表（取代 v1 的 `pty.shells()`）。
 */
export async function getAvailableShells(serverId?: string): Promise<ConfigShellsResponse> {
  const sdk = getSDKClient(serverId)
  return await sdk.config.shells()
}
