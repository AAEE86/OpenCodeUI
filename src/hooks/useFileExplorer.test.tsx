import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileExplorer } from './useFileExplorer'
import { changeScopeStore } from '../store/changeScopeStore'

const { listDirectory, getFileContent, getFileStatus, getSessionDiff, getVcsDiff, writeFileBytes, getServerTmpDirectory, createUploadId } =
  vi.hoisted(() => ({
  listDirectory: vi.fn(),
  getFileContent: vi.fn(),
  getFileStatus: vi.fn(),
  getSessionDiff: vi.fn(),
    getVcsDiff: vi.fn(),
    writeFileBytes: vi.fn(),
    getServerTmpDirectory: vi.fn(),
    createUploadId: vi.fn(() => "backup-id"),
  }))

vi.mock('../api', () => ({
  listDirectory,
  getFileContent,
  getFileStatus,
  getSessionDiff,
  getVcsDiff,
  writeFileBytes,
}))

vi.mock('../api/file', () => ({
  getServerTmpDirectory,
  createUploadId,
}))

describe('useFileExplorer change scope', () => {
  beforeEach(() => {
    changeScopeStore.clearAll()
    vi.clearAllMocks()

    listDirectory.mockResolvedValue([
      { name: 'src', path: 'src', absolute: '/repo/src', type: 'directory', ignored: false },
      { name: 'git.ts', path: 'src/git.ts', absolute: '/repo/src/git.ts', type: 'file', ignored: false },
      { name: 'turn.ts', path: 'src/turn.ts', absolute: '/repo/src/turn.ts', type: 'file', ignored: false },
    ])
    getFileContent.mockResolvedValue({ type: 'text', content: 'test' })
    getFileStatus.mockResolvedValue([])
    getVcsDiff.mockResolvedValue([
      {
        file: 'src/git.ts',
        before: 'const git = 1',
        after: 'const git = 2',
        additions: 1,
        deletions: 1,
      },
    ])
    getSessionDiff.mockResolvedValue([
      {
        file: 'src/turn.ts',
        before: '',
        after: 'const turn = 1',
        additions: 1,
        deletions: 0,
      },
    ])
  })

  it('updates file statuses when the shared change mode changes', async () => {
    // 与官方 review 对齐：turn → session.diff（不传 directory），git → vcs.diff(working)
    changeScopeStore.setMode('session-1', 'turn')
    const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true, sessionId: 'session-1' }))

    await waitFor(() => {
      expect(result.current.fileStatus.get('src/turn.ts')?.status).toBe('added')
    })

    expect(getSessionDiff).toHaveBeenCalledWith('session-1', undefined)

    act(() => {
      changeScopeStore.setMode('session-1', 'git')
    })

    await waitFor(() => {
      expect(result.current.fileStatus.get('src/git.ts')?.status).toBe('modified')
    })

    expect(result.current.fileStatus.get('src/turn.ts')).toBeUndefined()
    expect(getVcsDiff).toHaveBeenCalledWith('working', '/repo', undefined)
  })

  it('restores expanded folders per directory when switching projects', async () => {
    listDirectory.mockImplementation(async (parentPath: string, directory: string) => {
      if (parentPath === '') {
        return [{ name: 'src', path: 'src', absolute: `${directory}/src`, type: 'directory', ignored: false }]
      }

      if (parentPath === 'src') {
        return [
          {
            name: directory === '/repo-a' ? 'a.ts' : 'b.ts',
            path: `src/${directory === '/repo-a' ? 'a.ts' : 'b.ts'}`,
            absolute: `${directory}/src/${directory === '/repo-a' ? 'a.ts' : 'b.ts'}`,
            type: 'file',
            ignored: false,
          },
        ]
      }

      return []
    })

    const { result, rerender } = renderHook(
      ({ directory }) => useFileExplorer({ directory, autoLoad: true }),
      { initialProps: { directory: '/repo-a' } },
    )

    await waitFor(() => {
      expect(result.current.tree).toHaveLength(1)
    })

    act(() => {
      result.current.toggleExpand('src')
    })

    await waitFor(() => {
      expect(result.current.expandedPaths.has('src')).toBe(true)
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('src/a.ts')
    })

    rerender({ directory: '/repo-b' })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-b/src')
      expect(result.current.tree[0]?.children?.[0]?.path).toBeUndefined()
      expect(result.current.expandedPaths.has('src')).toBe(false)
    })

    rerender({ directory: '/repo-a' })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-a/src')
      expect(result.current.expandedPaths.has('src')).toBe(true)
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('src/a.ts')
    })
  })

  it('ignores stale child loads after switching directories', async () => {
    let resolveRepoAChildren: (nodes: Array<{ name: string; path: string; absolute: string; type: 'file'; ignored: boolean }>) => void

    listDirectory.mockImplementation((parentPath: string, directory: string) => {
      if (parentPath === '') {
        return Promise.resolve([{ name: 'src', path: 'src', absolute: `${directory}/src`, type: 'directory', ignored: false }])
      }

      if (parentPath === 'src' && directory === '/repo-a') {
        return new Promise(resolve => {
          resolveRepoAChildren = resolve
        })
      }

      if (parentPath === 'src' && directory === '/repo-b') {
        return Promise.resolve([
          { name: 'b.ts', path: 'src/b.ts', absolute: '/repo-b/src/b.ts', type: 'file', ignored: false },
        ])
      }

      return Promise.resolve([])
    })

    const { result, rerender } = renderHook(
      ({ directory }) => useFileExplorer({ directory, autoLoad: true }),
      { initialProps: { directory: '/repo-a' } },
    )

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-a/src')
    })

    act(() => {
      result.current.toggleExpand('src')
    })

    rerender({ directory: '/repo-b' })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-b/src')
    })

    act(() => {
      result.current.toggleExpand('src')
    })

    await waitFor(() => {
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('src/b.ts')
    })

    await act(async () => {
      resolveRepoAChildren!([
        { name: 'a.ts', path: 'src/a.ts', absolute: '/repo-a/src/a.ts', type: 'file', ignored: false },
      ])
    })

    expect(result.current.tree[0]?.absolute).toBe('/repo-b/src')
    expect(result.current.tree[0]?.children?.map(child => child.path)).toEqual(['src/b.ts'])
  })

  // issue #176：部分服务器（Windows v2）目录条目带尾斜杠（如 `castle-village-3d/`），
  // 不剥掉会让子条目拼出 `castle-village-3d//castle-village-3d/index.html` 的重复路径
  it('strips trailing slashes from directory entries so child paths are not duplicated', async () => {
    listDirectory.mockImplementation(async (parentPath: string, directory: string) => {
      if (parentPath === '') {
        return [{ name: 'castle-village-3d', path: 'castle-village-3d/', absolute: `${directory}/castle-village-3d`, type: 'directory', ignored: false }]
      }
      if (parentPath === 'castle-village-3d') {
        return [
          {
            name: 'index.html',
            path: 'castle-village-3d/index.html',
            absolute: `${directory}/castle-village-3d/index.html`,
            type: 'file',
            ignored: false,
          },
        ]
      }
      return []
    })

    const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true }))

    await waitFor(() => {
      expect(result.current.tree).toHaveLength(1)
    })

    // 根节点 path 不带尾斜杠，展开列子目录传的也是干净路径
    expect(result.current.tree[0]?.path).toBe('castle-village-3d')

    act(() => {
      result.current.toggleExpand('castle-village-3d')
    })

    await waitFor(() => {
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('castle-village-3d/index.html')
    })

    expect(listDirectory).toHaveBeenCalledWith('castle-village-3d', '/repo', undefined)

    // 预览读取用拼接后的根相对路径，不能再出现 `//` 重复段
    await act(async () => {
      await result.current.loadPreview('castle-village-3d/index.html')
    })
    expect(getFileContent).toHaveBeenCalledWith('castle-village-3d/index.html', '/repo', undefined)
  })

  // 切工作区后预览串内容：两个工作区都有同名相对路径文件时，预览缓存
  // 只按 path 命中会显示上一个工作区的内容（缓存键必须带目录维度）
  it('does not serve preview content cached from another workspace for the same relative path', async () => {
    getFileContent.mockImplementation(async (path: string, directory: string) => ({
      type: 'text',
      content: `${directory} 的 ${path}`,
    }))

    const { result, rerender } = renderHook(({ directory }: { directory: string }) => useFileExplorer({ directory, autoLoad: true }), {
      initialProps: { directory: '/repo-a' },
    })

    await waitFor(() => {
      expect(result.current.tree.length).toBeGreaterThan(0)
    })

    await act(async () => {
      await result.current.loadPreview('src/session.ts')
    })
    expect(result.current.previewContent?.content).toBe('/repo-a 的 src/session.ts')

    // 切到 /repo-b：同名文件必须重新拉取，不能命中 /repo-a 的缓存
    rerender({ directory: '/repo-b' })

    await act(async () => {
      await result.current.loadPreview('src/session.ts')
    })
    expect(result.current.previewContent?.content).toBe('/repo-b 的 src/session.ts')
    expect(getFileContent).toHaveBeenCalledWith('src/session.ts', '/repo-b', undefined)
    // 不能是缓存直出：确实发起了第二次请求
    expect(getFileContent.mock.calls.filter(call => call[0] === 'src/session.ts')).toHaveLength(2)
  })
})

describe('useFileExplorer · savePreview（保存事务）', () => {
  const enc = (text: string) => new TextEncoder().encode(text)
  const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
  const fileAt = (path: string, bytes: Uint8Array) => ({
    path,
    content: dec(bytes),
    isBinary: false,
    size: bytes.byteLength,
    bytes,
  })

  /**
   * 模拟"磁盘"：读到的是最近一次写进去的字节（没人写过就是初始内容）。
   * 这样写后校验（重读比对）才有意义，否则每次保存都会判成校验失败。
   */
  function mockDisk(initial: string) {
    const written = new Map<string, Uint8Array>()
    getFileContent.mockImplementation(async (path: string) => {
      const bytes = written.get(path) ?? enc(initial)
      return fileAt(path, bytes)
    })
    writeFileBytes.mockImplementation(async (target: string, payload: Uint8Array) => {
      // 备份路径不改变"磁盘内容"
      if (!target.includes("/backups/")) written.set(target, payload)
    })
    return { written }
  }

  beforeEach(() => {
    changeScopeStore.clearAll()
    vi.clearAllMocks()
    listDirectory.mockResolvedValue([])
    getFileStatus.mockResolvedValue([])
    getVcsDiff.mockResolvedValue([])
    getSessionDiff.mockResolvedValue([])
    getServerTmpDirectory.mockResolvedValue("/tmp/opencode")
  })

  function setup() {
    return renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: false }))
  }

  it('拒绝写入工作区外的路径（fs.write 不受 location 限制，必须自己拦）', async () => {
    const { result } = setup()
    mockDisk("root")

    const failure = await act(() => result.current.savePreview("../../etc/passwd", "hacked").catch(e => e))
    expect(failure.code).toBe('OUTSIDE_WORKSPACE')
    expect(writeFileBytes).not.toHaveBeenCalled()
  })

  it('文件已不存在时拒绝保存（不凭空创建文件）', async () => {
    const { result } = setup()
    getFileContent.mockRejectedValue(new Error("FileNotFoundError"))

    const failure = await act(() => result.current.savePreview("src/app.ts", "next", undefined, true).catch(e => e))
    expect(failure.code).toBe('FILE_MISSING')
    expect(writeFileBytes).not.toHaveBeenCalled()
  })

  it('基线不一致且未 force → STALE_REVISION（由 UI 弹重载/覆盖）', async () => {
    const { result } = setup()
    mockDisk("agent changed this")

    const failure = await act(() => result.current.savePreview('src/app.ts', 'my edit', 'stale-hash').catch(e => e))
    expect(failure.code).toBe('STALE_REVISION')
    expect(writeFileBytes).not.toHaveBeenCalled()
  })

  it('force 时无视基线直接写，并先备份磁盘当前内容', async () => {
    const { result } = setup()
    mockDisk("disk content\n")

    await act(() => result.current.savePreview('src/app.ts', 'mine\n', 'stale-hash', true))

    const targets = writeFileBytes.mock.calls.map(call => call[0] as string)
    expect(targets[0]).toContain("/tmp/opencode/backups/")
    expect(targets[1]).toBe("src/app.ts")
  })

  it('CRLF 原文保存后仍是 CRLF（保真）', async () => {
    const { result } = setup()
    const { written } = mockDisk("a\r\nb\r\n")

    await act(() => result.current.savePreview('src/app.ts', 'a\nb\nc\n', undefined, true))

    expect(dec(written.get("src/app.ts")!)).toBe("a\r\nb\r\nc\r\n")
  })

  it('混合行尾默认拒绝（code=MIXED_EOL）；unifyEol=true 时按多数行尾统一', async () => {
    const { result } = setup()
    const { written } = mockDisk("a\r\nb\r\nc\n")

    const failure = await act(() => result.current.savePreview('src/app.ts', 'x\ny\nz\n', undefined, true).catch(e => e))
    expect(failure.code).toBe('MIXED_EOL')
    expect(written.size).toBe(0)

    await act(() => result.current.savePreview('src/app.ts', 'x\ny\nz\n', undefined, true, true))
    expect(dec(written.get("src/app.ts")!)).toBe("x\r\ny\r\nz\r\n")
  })

  it('写后校验不一致 → VERIFY_FAILED（保留 dirty 让用户重试）', async () => {
    const { result } = setup()
    getFileContent
      .mockResolvedValueOnce(fileAt("src/app.ts", enc("old\n")))
      .mockResolvedValueOnce(fileAt("src/app.ts", enc("someone else wrote this\n")))

    const failure = await act(() => result.current.savePreview('src/app.ts', 'mine\n', undefined, true).catch(e => e))
    expect(failure.code).toBe('VERIFY_FAILED')
  })
})
