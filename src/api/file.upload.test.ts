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

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    file: { write: writeMock },
    server: { info: infoMock },
  }),
}))

const { clearServerTmpDirectoryCache, createUploadId, getServerTmpDirectory, uploadAttachment } = await import('./file')

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
