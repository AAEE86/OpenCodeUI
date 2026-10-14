import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileExplorer } from './useFileExplorer'
import { changeScopeStore } from '../store/changeScopeStore'

const { listDirectory, getFileContent, getFileStatus, getSessionDiff, getLastTurnDiff, getVcsDiff } = vi.hoisted(
  () => ({
    listDirectory: vi.fn(),
    getFileContent: vi.fn(),
    getFileStatus: vi.fn(),
    getSessionDiff: vi.fn(),
    getLastTurnDiff: vi.fn(),
    getVcsDiff: vi.fn(),
  }),
)

vi.mock('../api', () => ({
  listDirectory,
  getFileContent,
  getFileStatus,
  getSessionDiff,
  getLastTurnDiff,
  getVcsDiff,
}))

describe('useFileExplorer change scope', () => {
  beforeEach(() => {
    changeScopeStore.clearAll()
    vi.clearAllMocks()

    listDirectory.mockResolvedValue([
      { name: 'src', path: 'src', absolute: '/repo/src', type: 'directory', ignored: false },
      { name: 'session.ts', path: 'src/session.ts', absolute: '/repo/src/session.ts', type: 'file', ignored: false },
      { name: 'turn.ts', path: 'src/turn.ts', absolute: '/repo/src/turn.ts', type: 'file', ignored: false },
    ])
    getFileContent.mockResolvedValue({ type: 'text', content: 'test' })
    getFileStatus.mockResolvedValue([])
    getVcsDiff.mockResolvedValue([])
    getSessionDiff.mockResolvedValue([
      {
        file: 'src/session.ts',
        before: 'const session = 1',
        after: 'const session = 2',
        additions: 1,
        deletions: 1,
      },
    ])
    getLastTurnDiff.mockResolvedValue([
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
    const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true, sessionId: 'session-1' }))

    await waitFor(() => {
      expect(result.current.fileStatus.get('src/turn.ts')?.status).toBe('added')
    })

    expect(getLastTurnDiff).toHaveBeenCalledWith('session-1', '/repo', undefined)

    act(() => {
      changeScopeStore.setMode('session-1', 'session')
    })

    await waitFor(() => {
      expect(result.current.fileStatus.get('src/session.ts')?.status).toBe('modified')
    })

    expect(result.current.fileStatus.get('src/turn.ts')).toBeUndefined()
    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo', undefined)
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
