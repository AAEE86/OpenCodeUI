import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// 附件上传（Issue #182）
//
// `fs.write` 是 experimental 且不受 location 限制：附件上传是它唯一的新
// 业务调用点，因此路径拼装、tmp 目录缓存、文件名清洗、uuid 兜底都在
// api/file.ts 收口，这里逐条锁住行为。
// ============================================

const writeMock = vi.fn(async (_input: unknown) => ({ data: { path: '/srv/tmp/uploads/abc/report.zip' } }))
const infoMock = vi.fn(async () => ({
  version: '2.0.21',
  pid: 1,
  urls: [],
  paths: { tmp: '/srv/tmp' },
}))
const listMock = vi.fn(async (_input: unknown) => ({ data: [] as Array<{ path: string; type: string }> }))

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    file: { write: writeMock, list: listMock },
    server: { info: infoMock },
  }),
}))

// 进度上传走的是自建 XHR（绕过 SDK），这里只需要固定的 base/auth
vi.mock('./http', () => ({
  getApiBaseUrl: () => 'http://127.0.0.1:49374',
  getAuthHeader: () => ({ Authorization: 'Basic test-token' }),
}))

/** 最小 XHR 假件：记录请求，允许测试驱动 progress/load/error */
class FakeXhr {
  static instances: FakeXhr[] = []

  method = ''
  url = ''
  status = 0
  response: unknown = null
  responseType = ''
  body: unknown = null
  aborted = false
  headers: Record<string, string> = {}

  private listeners = new Map<string, Array<() => void>>()
  upload = {
    addEventListener: (type: string, handler: (event: { loaded: number; total: number }) => void) => {
      this.uploadListeners.set(type, handler)
    },
    listeners: new Map<string, (event: { loaded: number; total: number }) => void>(),
  }

  private uploadListeners = new Map<
    string,
    (event: { loaded: number; total: number; lengthComputable: boolean }) => void
  >()

  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = value
  }

  addEventListener(type: string, handler: () => void) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  send(body: unknown) {
    this.body = body
  }

  abort() {
    this.aborted = true
    this.emit('abort')
  }

  emit(type: string) {
    for (const handler of this.listeners.get(type) ?? []) handler()
  }

  emitProgress(loaded: number, total: number, lengthComputable = true) {
    this.uploadListeners.get('progress')?.({
      loaded,
      total: lengthComputable ? total : 0,
      lengthComputable,
    })
  }

  static last() {
    return FakeXhr.instances.at(-1)!
  }

  static reset() {
    FakeXhr.instances = []
  }
}

const { clearServerTmpDirectoryCache, createUploadId, getServerTmpDirectory, probeServerPath, uploadAttachment } =
  await import('./file')

function lastWriteInput() {
  return writeMock.mock.calls.at(-1)?.[0] as {
    path: string
    payload: Uint8Array
    location?: { directory?: string }
  }
}

describe('uploadAttachment', () => {
  beforeEach(() => {
    writeMock.mockClear()
    infoMock.mockClear()
    clearServerTmpDirectoryCache()
  })

  it('写到 {tmp}/uploads/<id>/<name>，并返回服务端解析后的路径', async () => {
    const payload = new TextEncoder().encode('zip-bytes')
    const result = await uploadAttachment(payload, 'report.zip', undefined, 'local')

    const input = lastWriteInput()
    expect(input.path.startsWith('/srv/tmp/uploads/')).toBe(true)
    expect(input.path.endsWith('/report.zip')).toBe(true)
    // 一层 uuid 目录，避免同名覆盖
    expect(input.path.split('/uploads/')[1]?.split('/')).toHaveLength(2)
    // 交给 SDK 的是同一份内容（跨 realm 时会重新包一层视图，按字节比较）
    expect(Array.from(input.payload)).toEqual(Array.from(payload))

    // 用服务端回显的路径，而不是自己拼的
    expect(result.path).toBe('/srv/tmp/uploads/abc/report.zip')
    expect(result.size).toBe(payload.byteLength)
  })

  it('服务端没回 data.path 时回落到自己拼的路径', async () => {
    writeMock.mockResolvedValueOnce({} as never)
    const result = await uploadAttachment(new Uint8Array([1, 2, 3]), 'a.bin', undefined, 'local')
    expect(result.path).toBe(lastWriteInput().path)
    expect(result.size).toBe(3)
  })

  it('tmp 目录按 serverId 缓存（只问一次 server.info）', async () => {
    await uploadAttachment(new Uint8Array([1]), 'a.bin', undefined, 'local')
    await uploadAttachment(new Uint8Array([1]), 'b.bin', undefined, 'local')
    expect(infoMock).toHaveBeenCalledTimes(1)

    await getServerTmpDirectory('local')
    expect(infoMock).toHaveBeenCalledTimes(1)

    await uploadAttachment(new Uint8Array([1]), 'c.bin', undefined, 'remote')
    expect(infoMock).toHaveBeenCalledTimes(2)
  })

  it('服务端未报告 tmp 目录时明确失败（不静默写到根目录）', async () => {
    infoMock.mockResolvedValueOnce({ version: '2.0.21', pid: 1, urls: [], paths: {} } as never)
    await expect(uploadAttachment(new Uint8Array([1]), 'a.bin', undefined, 'local')).rejects.toThrow(
      /temporary directory/i,
    )
  })

  it('文件名只保留最后一段并清洗保留字符', async () => {
    await uploadAttachment(new Uint8Array([1]), '..\\evil/../../pa<th>:|?*.zip', undefined, 'local')
    const written = lastWriteInput().path
    const name = written.split('/').pop()

    // 只取最后一段（路径穿越被吃掉），控制/保留字符替换为下划线
    expect(name).toBe('pa_th_____.zip')
    expect(name).not.toMatch(/[<>:"|?*]/)
    expect(written).not.toContain('..')
  })

  it('带目录时带上 location（与既有的 locationParam 收口一致）', async () => {
    await uploadAttachment(new Uint8Array([1]), 'a.bin', '/repo/project', 'local')
    expect(lastWriteInput().location).toEqual({ directory: '/repo/project' })
  })
})

describe('createUploadId', () => {
  it('优先用 crypto.randomUUID', () => {
    expect(createUploadId()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('非安全上下文（randomUUID 抛错）时回落到时间戳 + 随机数', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => {
          throw new Error('insecure context')
        },
      },
    })

    try {
      const id = createUploadId()
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/)
      expect(id).not.toContain('undefined')
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
    }
  })
})

// ============================================
// probeServerPath：服务端能不能读到这个本机路径
//
// 「URL 是不是 localhost」回答不了这个问题（本机也可能用局域网地址连自己，
// 容器也会把端口映射到回环），所以直接问服务端。
// ============================================

describe('probeServerPath', () => {
  beforeEach(() => {
    listMock.mockReset()
    listMock.mockResolvedValue({ data: [] })
  })

  it('父目录里存在同名文件 → 读得到（Windows 路径与 `../` 形态条目都能匹配）', async () => {
    listMock.mockResolvedValue({
      data: [
        { path: '../../../Temp/opencode/uploads/u1/probe.zip', type: 'file' },
        { path: '../../../Temp/opencode/uploads/u1/sub', type: 'directory' },
      ],
    })

    await expect(
      probeServerPath('C:\\Users\\x\\AppData\\Local\\Temp\\opencode\\uploads\\u1\\probe.zip', '/repo', 'local'),
    ).resolves.toBe(true)

    expect(listMock).toHaveBeenCalledWith({
      location: { directory: '/repo' },
      path: 'C:\\Users\\x\\AppData\\Local\\Temp\\opencode\\uploads\\u1',
    })
  })

  it('目录里没有该条目 → 读不到', async () => {
    listMock.mockResolvedValue({ data: [{ path: '../other/thing.zip', type: 'file' }] })
    await expect(probeServerPath('/host/dl/report.zip')).resolves.toBe(false)
  })

  it('同名但类型是目录 → 读不到', async () => {
    listMock.mockResolvedValue({ data: [{ path: '../dl/report.zip', type: 'directory' }] })
    await expect(probeServerPath('/host/dl/report.zip')).resolves.toBe(false)
  })

  it('符号链接也算读得到（服务端能顺着读）', async () => {
    listMock.mockResolvedValue({ data: [{ path: '../dl/report.zip', type: 'symlink' }] })
    await expect(probeServerPath('/host/dl/report.zip')).resolves.toBe(true)
  })

  it('服务端不可达 / 目录不存在 → 按读不到处理，不抛错', async () => {
    listMock.mockRejectedValue(new Error('Failed to fetch'))
    await expect(probeServerPath('/host/dl/report.zip')).resolves.toBe(false)
  })

  it('没有父目录的裸文件名 → 读不到（不去列服务端根目录）', async () => {
    await expect(probeServerPath('report.zip')).resolves.toBe(false)
    expect(listMock).not.toHaveBeenCalled()
  })
})

// ============================================
// 带进度的上传（浏览器）：fetch 报不了上传进度，所以要走 XHR
// 官方做法同款：packages/app/src/composer/attachments/destination.ts:43-61
// ============================================

describe('uploadAttachment — XHR 进度传输', () => {
  beforeEach(() => {
    writeMock.mockClear()
    infoMock.mockClear()
    clearServerTmpDirectoryCache()
    FakeXhr.reset()
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  function uploadWithProgress(onProgress: (fraction: number) => void, directory?: string) {
    return uploadAttachment(new Blob(['zip-bytes']), 'report.zip', directory, 'local', { onProgress })
  }

  /** 起一个上传并等到 XHR 真的被创建（前面有 await，必须让微任务先跑） */
  async function startUpload(onProgress: (fraction: number) => void, directory?: string) {
    const pending = uploadWithProgress(onProgress, directory)
    await vi.waitFor(() => {
      expect(FakeXhr.instances.length).toBeGreaterThan(0)
    })
    return { pending, xhr: FakeXhr.last() }
  }

  it('交出 File/Blob 本体（浏览器能从磁盘流式发送），query 带 location 与 path', async () => {
    const { pending, xhr } = await startUpload(vi.fn())

    expect(xhr.method).toBe('POST')
    expect(xhr.url).toContain('http://127.0.0.1:49374/api/experimental/fs/write?')
    expect(xhr.url).toContain('path=')
    expect(xhr.url).toContain('uploads')
    expect(xhr.url).toContain('report.zip')
    // 缺省不带 location（交给服务端回落默认工作目录）
    expect(xhr.url).not.toContain('location%5Bdirectory%5D')
    expect(xhr.headers['content-type']).toBe('application/octet-stream')
    expect(xhr.headers['authorization']).toBe('Basic test-token')
    expect(xhr.body).toBeInstanceOf(Blob)

    xhr.status = 200
    xhr.response = { data: { path: '/srv/tmp/uploads/u1/report.zip' } }
    xhr.emit('load')
    await expect(pending).resolves.toEqual({ path: '/srv/tmp/uploads/u1/report.zip', size: 9 })
  })

  it('带目录时 query 里带上 location[directory]', async () => {
    const { xhr } = await startUpload(vi.fn(), '/repo/project')
    expect(xhr.url).toContain('location%5Bdirectory%5D=%2Frepo%2Fproject')
  })

  it('progress 事件换算成 0~1 的回调', async () => {
    const onProgress = vi.fn()
    const { xhr } = await startUpload(onProgress)

    xhr.emitProgress(0, 100)
    xhr.emitProgress(25, 100)
    xhr.emitProgress(100, 100)

    expect(onProgress.mock.calls.map(call => call[0])).toEqual([0, 0.25, 1])
  })

  it('非 200 抛错（供失败分类识别状态码）', async () => {
    const { pending, xhr } = await startUpload(vi.fn())

    xhr.status = 500
    xhr.emit('load')
    await expect(pending).rejects.toThrow('Upload failed with status 500')
  })

  it('网络错误与取消分别抛出可分类的错误', async () => {
    const first = await startUpload(vi.fn())
    first.xhr.emit('error')
    await expect(first.pending).rejects.toThrow(/network error/i)

    const second = await startUpload(vi.fn())
    second.xhr.abort()
    await expect(second.pending).rejects.toThrow(/aborted/i)
  })

  it('Tauri 下即使要进度也不走 XHR（webview 的 CORS/网络策略不可靠，仍走 SDK）', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    try {
      await uploadAttachment(new Blob(['x']), 'report.zip', undefined, 'local', { onProgress: vi.fn() })
      expect(writeMock).toHaveBeenCalledTimes(1)
      expect(FakeXhr.instances).toHaveLength(0)
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    }
  })
})
