// ============================================
// File API — OpenCode v2 原生
//
// ## v1 → v2 关键差异
//
//   - 列目录：v1 返回树形 `FileNode[]`（含 children）；
//     v2 `file.list` 返回 `{ location, data: FileSystemEntry[] }`，
//     元素只有 `{ path, type }` —— **扁平列表**，树形由 UI 构建。
//   - 读文件：v2 `file.read` 返回 **`Uint8Array`**（原始字节），
//     不再是带 patch/hunks 的 JSON。文本解码由调用方做。
//   - 写文件：v2 `file.write({ path, payload: Uint8Array })`。
//   - **搜索**：v2 删除了 `find.*`：
//       `find.files`   → `file.find`（返回条目数组，不是 path 字符串数组）
//       `find.symbols` → **已移除**（符号搜索在 v2 不存在）
//       `find.text`    → **已移除**（无全文检索端点）
//   - 文件 git 状态：v1 `file.status` → v2 `vcs.status`
// ============================================

import { getSDKClient } from './sdk'
import { locationParam } from './location'
import { getApiBaseUrl, getAuthHeader } from './http'
import { fileBaseName } from '../utils/pathUtils'
import { isTauri } from '../utils/tauri'
import type { FileContent, FileNode, FileStatusItem } from './types'
import { serverStore } from '../store/serverStore'

const ROOT_DIRECTORY_CACHE_TTL_MS = 10_000

// 路径工具是纯函数，放在 utils/pathUtils：
// 不经 api 桶文件导出，避免 mock 了 api 模块的测试拿到 undefined。
export { fileBaseName, toAbsoluteFilePath } from '../utils/pathUtils'

const rootDirectoryCache = new Map<string, { data: FileNode[]; expiresAt: number }>()
const rootDirectoryInflight = new Map<string, Promise<FileNode[]>>()

function isRootDirectoryPath(path: string): boolean {
  return path === '' || path === '.' || path === './'
}

function getRootDirectoryCacheKey(directory?: string, serverId?: string): string {
  return `${serverId ?? serverStore.getActiveServerId()}::${directory ?? ''}`
}

async function fetchDirectory(path: string, directory?: string, serverId?: string): Promise<FileNode[]> {
  const sdk = getSDKClient(serverId)

  // v2 的 file.list 接受绝对或相对 path，直接透传
  const result = await sdk.file.list({
    location: locationParam(directory, serverId),
    path,
  })
  return result.data
}

/**
 * 列出目录内容。
 *
 * v2 返回扁平条目（path + type），UI 侧负责组织成树。
 */
export async function listDirectory(path: string, directory?: string, serverId?: string): Promise<FileNode[]> {
  if (!isRootDirectoryPath(path)) {
    return fetchDirectory(path, directory, serverId)
  }

  const key = getRootDirectoryCacheKey(directory, serverId)
  const now = Date.now()
  const cached = rootDirectoryCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const inflight = rootDirectoryInflight.get(key)
  if (inflight) {
    return inflight
  }

  const request = fetchDirectory('.', directory, serverId)
    .then(data => {
      rootDirectoryCache.set(key, { data, expiresAt: Date.now() + ROOT_DIRECTORY_CACHE_TTL_MS })
      return data
    })
    .finally(() => {
      rootDirectoryInflight.delete(key)
    })

  rootDirectoryInflight.set(key, request)
  return request
}

export async function prefetchRootDirectory(directory?: string, serverId?: string): Promise<void> {
  await listDirectory('.', directory, serverId)
}

/**
 * 列出目录内容，并返回服务器回显的 location 根目录。
 *
 * v2 的条目 path 是**相对 location 根**的（不是相对被列出的目录），
 * 浏览到根之外时会带 `../`。需要拼绝对路径的调用方（如项目选择对话框）
 * 必须用这个变体，把条目按 `resolveEntryPath(entry.path, locationRoot)` 解析。
 */
export async function listDirectoryWithRoot(
  path: string,
  directory?: string,
  serverId?: string,
): Promise<{ locationRoot: string; entries: FileNode[] }> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.file.list({
    location: locationParam(directory, serverId),
    path,
  })
  return { locationRoot: result.location?.directory ?? '', entries: result.data }
}

/**
 * 搜索文件 / 目录。
 *
 * v1 的 `find.files` 返回 path 字符串数组；v2 的 `file.find` 返回条目数组，
 * 这里投影成 path 数组，保持调用点不变。
 */
export async function searchFiles(
  query: string,
  options: {
    directory?: string
    type?: 'file' | 'directory'
    limit?: number
    serverId?: string
  } = {},
): Promise<string[]> {
  const sdk = getSDKClient(options.serverId)
  const result = await sdk.file.find({
    query,
    location: locationParam(options.directory, options.serverId),
    type: options.type,
    limit: options.limit,
  })
  return result.data.map(entry => entry.path)
}

/**
 * 搜索目录（便捷方法）
 */
export async function searchDirectories(query: string, baseDirectory?: string, limit: number = 50): Promise<string[]> {
  return searchFiles(query, {
    directory: baseDirectory,
    type: 'directory',
    limit,
  })
}

/**
 * 读取文件原始字节。
 */
export async function getFileBytes(path: string, directory?: string, serverId?: string): Promise<Uint8Array> {
  const sdk = getSDKClient(serverId)
  return await sdk.file.read({ path, location: locationParam(directory, serverId) })
}

/**
 * 读取文件内容（文本）。
 *
 * v2 的 `file.read` 返回原始字节，这里解码为文本，
 * 并用 TextDecoder 的 fatal 模式判断是否为二进制。
 */
export async function getFileContent(path: string, directory?: string, serverId?: string): Promise<FileContent> {
  const bytes = await getFileBytes(path, directory, serverId)

  let isBinary = false
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    isBinary = true
  }

  return {
    path,
    content: text,
    isBinary,
    size: bytes.byteLength,
    bytes,
  }
}

/**
 * 写入文件原始字节。
 */
export async function writeFileBytes(
  path: string,
  payload: Uint8Array,
  directory?: string,
  serverId?: string,
): Promise<void> {
  const sdk = getSDKClient(serverId)
  await sdk.file.write({ path, payload, location: locationParam(directory, serverId) })
}

// ============================================
// 附件上传（Issue #182：拖入任意文件 → 服务端临时目录 → 路径附件）
//
// `fs.write` 是 experimental 且**不受 location 限制**：它能写到任意绝对
// 路径、自动建父目录。附件上传是它唯一的新业务调用点，因此全部收口在本文件。
// ============================================

/** 服务端临时目录（`server.info().paths.tmp`）按 serverId 缓存 */
const serverTmpDirectoryCache = new Map<string, string>()

/**
 * 取服务端的临时目录绝对路径。
 *
 * 这是官方钦定的附件落点：core 的内置指令让模型优先使用它，默认 agent
 * 权限里 `<tmp>/*` 也是 allow（通配符跨目录分隔符）——因此模型读上传
 * 文件不会弹外部目录批准框。
 */
export async function getServerTmpDirectory(serverId?: string): Promise<string> {
  const cacheKey = serverId ?? serverStore.getActiveServerId()
  const cached = serverTmpDirectoryCache.get(cacheKey)
  if (cached) return cached

  const sdk = getSDKClient(serverId)
  const info = await sdk.server.info()
  const tmp = info.paths?.tmp
  if (!tmp) throw new Error('Server did not report a temporary directory')

  serverTmpDirectoryCache.set(cacheKey, tmp)
  return tmp
}

/** 清理临时目录缓存（服务器切换 / 单测） */
export function clearServerTmpDirectoryCache(): void {
  serverTmpDirectoryCache.clear()
}

/**
 * 生成上传目录名。
 *
 * `crypto.randomUUID` 只在安全上下文可用，而本应用可能被局域网 http
 * （`http://192.168.x.x`）访问，此时它是 undefined → 必须有兜底。
 */
export function createUploadId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // 非安全上下文：走下面的兜底
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 只保留最后一段文件名，去掉路径分隔符与各平台保留字符 */
function sanitizeUploadFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? ''
  // 先剔除控制字符（避免正则里的控制字符类），再替换各平台保留字符
  const printable = Array.from(base)
    .filter(char => char.charCodeAt(0) > 31)
    .join('')
  const cleaned = printable.replace(/[<>:"|?*]/g, '_').trim()
  return cleaned || 'file'
}

export interface UploadAttachmentOptions {
  /**
   * 上传进度（0~1）。
   *
   * 给了它并且不在 Tauri 里时走 `XMLHttpRequest`：fetch 无法上报上传进度，
   * 而 XHR 可以直接把 `File` 交给浏览器从磁盘流式发送（渲染进程不驻留整份文件）。
   * 桌面端仍走 SDK（`@tauri-apps/plugin-http`，经 Rust 发包，不受 CORS 限制），
   * 代价是没有进度——要进度得在 Rust 侧实现。
   */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * 用 XHR 写文件（浏览器侧的唯一理由：真实上传进度 + 流式发 File）。
 *
 * 官方 app 也是这么做的（packages/app/src/composer/attachments/destination.ts:43-61）：
 * "fetch cannot report upload progress and Chromium only streams request bodies over HTTP/2"。
 */
function writeWithXhr(input: {
  url: string
  body: Blob
  authorization?: string
  onProgress: (fraction: number) => void
  signal?: AbortSignal
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', input.url)
    xhr.responseType = 'json'
    xhr.setRequestHeader('content-type', 'application/octet-stream')
    if (input.authorization) xhr.setRequestHeader('authorization', input.authorization)

    xhr.upload.addEventListener('progress', event => {
      const total = event.lengthComputable ? event.total : input.body.size
      if (total > 0) input.onProgress(Math.min(1, event.loaded / total))
    })

    xhr.addEventListener('load', () => {
      if (xhr.status !== 200) {
        reject(new Error(`Upload failed with status ${xhr.status}`))
        return
      }
      const resolved = (xhr.response as { data?: { path?: string } } | null)?.data?.path
      resolve(resolved || '')
    })
    xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')))
    xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')))

    if (input.signal) {
      if (input.signal.aborted) {
        xhr.abort()
        return
      }
      input.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(input.body)
  })
}

/** 上传目标：`{tmp}/uploads/<uuid>/<清洗后的文件名>`（每次单独一层 uuid 目录） */
async function buildUploadTarget(serverId: string | undefined, filename: string): Promise<string> {
  const tmp = await getServerTmpDirectory(serverId)
  return `${tmp.replace(/[/\\]+$/, '')}/uploads/${createUploadId()}/${sanitizeUploadFilename(filename)}`
}

/** Tauri 侧 Rust 上传命令的进度事件（见 src-tauri/src/app/commands/upload.rs） */
interface RustUploadEvent {
  type: 'progress'
  loaded: number
  total: number
}

/**
 * 上传**本机文件**（桌面端拖入 / 选择器拿到的是绝对路径）。
 *
 * Tauri 下走 Rust 命令：reqwest 流式发送 + 进度事件。这样做有三个好处：
 * 不把整份文件读进渲染进程、不受 webview 同源策略约束、有真实进度。
 * 非 Tauri 环境理论到不了这里（浏览器拿不到真实路径），退化为读字节上传。
 */
export async function uploadLocalFile(
  sourcePath: string,
  filename: string,
  directory?: string,
  serverId?: string,
  options: UploadAttachmentOptions = {},
): Promise<{ path: string; size: number }> {
  const target = await buildUploadTarget(serverId, filename)

  if (isTauri()) {
    const { Channel, invoke } = await import('@tauri-apps/api/core')

    const channel = new Channel<RustUploadEvent>()
    channel.onmessage = event => {
      if (event.type === 'progress' && event.total > 0) {
        options.onProgress?.(Math.min(1, event.loaded / event.total))
      }
    }

    const auth = serverId ? serverStore.getServerAuth(serverId) : serverStore.getActiveAuth()
    const result = await invoke<{ path: string; size: number }>('upload_attachment', {
      url: getApiBaseUrl(serverId),
      target,
      sourcePath,
      password: auth?.password ?? null,
      directory: directory ?? null,
      onEvent: channel,
    })

    return { path: result?.path || target, size: result?.size ?? 0 }
  }

  const { readFile } = await import('@tauri-apps/plugin-fs')
  const bytes = await readFile(sourcePath)
  return uploadAttachment(bytes, filename, directory, serverId, options)
}

/**
 * 上传附件到服务端临时目录，返回**服务端上的绝对路径**与字节数。
 *
 * 用响应的 `data.path`，不要用自己拼的路径：服务端会规范化分隔符
 * （Windows 路径尤其重要）。每次上传单独一层 uuid 目录，避免同名覆盖。
 */
export async function uploadAttachment(
  payload: Blob | Uint8Array,
  filename: string,
  directory?: string,
  serverId?: string,
  options: UploadAttachmentOptions = {},
): Promise<{ path: string; size: number }> {
  const target = await buildUploadTarget(serverId, filename)

  // 浏览器 + 要进度 → XHR（File 直接交给浏览器流式发送）
  if (options.onProgress && !isTauri() && typeof XMLHttpRequest !== 'undefined') {
    // 拷贝一份独立 buffer，避免 SharedArrayBuffer 后端类型与 BlobPart 不兼容
    const body: Blob = ArrayBuffer.isView(payload)
      ? new Blob([payload.slice().buffer as ArrayBuffer])
      : payload
    const base = getApiBaseUrl(serverId).replace(/\/+$/, '')

    // 目录缺省时不带 location，交给服务端回落自己的默认工作目录
    const params = new URLSearchParams({ path: target })
    if (directory) params.set('location[directory]', directory)

    const resolved = await writeWithXhr({
      url: `${base}/api/experimental/fs/write?${params}`,
      body,
      authorization: getAuthHeader(serverId)['Authorization'],
      onProgress: options.onProgress,
      signal: options.signal,
    })

    return { path: resolved || target, size: body.size }
  }

  // ArrayBuffer.isView 是跨 realm 安全的 brand check（`instanceof Uint8Array`
  // 在跨 window/worker 传进来的 typed array 上会失手）
  const bytes = ArrayBuffer.isView(payload)
    ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
    : new Uint8Array(await payload.arrayBuffer())

  const sdk = getSDKClient(serverId)
  const result = await sdk.file.write({
    path: target,
    payload: bytes,
    location: locationParam(directory, serverId),
  })

  const resolved = result?.data?.path
  return { path: resolved || target, size: bytes.byteLength }
}

/**
 * 服务端能不能读到这个路径。
 *
 * 桌面端拖入的文件里存的是**客户端**的绝对路径；能不能直接把它交给服务端引用，
 * 取决于服务端进程是否也看得见这个路径——这与「URL 是不是 localhost」并不等价：
 * - 本机但用**局域网地址**连自己 → URL 判非本地，实际同机（能读到）
 * - 容器把端口映射到回环 → URL 判本地，容器里读不到宿主路径（读不到）
 * 所以直接问服务端最可靠：列一次父目录，看目标条目在不在。
 *
 * 任何异常（目录不存在、无权限、服务端不可达）都按「读不到」处理。
 */
export async function probeServerPath(path: string, directory?: string, serverId?: string): Promise<boolean> {
  const name = fileBaseName(path)
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (!name || separatorIndex <= 0) return false

  const parent = path.slice(0, separatorIndex)

  try {
    const sdk = getSDKClient(serverId)
    const result = await sdk.file.list({
      location: locationParam(directory, serverId),
      path: parent,
    })
    // 条目 path 可能是 location 相对路径，也可能是绝对路径（越界列举时实测如此），
    // 所以只比最后一段；symlink 也算读得到（服务端能顺着读）。
    return result.data.some(entry => entry.type !== 'directory' && fileBaseName(entry.path) === name)
  } catch {
    return false
  }
}

/**
 * 获取文件的版本控制状态。
 *
 * v1 的 `file.status` 在 v2 由 `vcs.status` 提供。
 * v2 字段为 `{ file, additions, deletions, status }`，这里换算成 UI 的
 * `{ file, added, removed, status }`。
 */
export async function getFileStatus(directory?: string, serverId?: string): Promise<FileStatusItem[]> {
  const sdk = getSDKClient(serverId)
  const result = await sdk.vcs.status({ location: locationParam(directory, serverId) })
  return result.data.map(entry => ({
    file: entry.file,
    added: entry.additions,
    removed: entry.deletions,
    status: entry.status,
  }))
}
