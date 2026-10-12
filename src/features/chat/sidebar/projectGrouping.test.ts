import { describe, expect, it } from 'vitest'
import { getProjectGroupIdentity } from './projectGrouping'

describe('getProjectGroupIdentity', () => {
  it('普通目录保持自身路径', () => {
    expect(getProjectGroupIdentity('/workspace/project-root/subdir-a/subdir-b')).toEqual({
      projectId: '/workspace/project-root/subdir-a/subdir-b',
      workspaceDirectories: undefined,
    })
  })

  it('worktree 不合并进根项目，按独立文件夹算', () => {
    // 设计决策：worktree 与根目录各自成为独立项目文件夹，
    // 不再按 git root 合并分组
    expect(getProjectGroupIdentity('/workspace/project-root')).toEqual({
      projectId: '/workspace/project-root',
      workspaceDirectories: undefined,
    })
    expect(getProjectGroupIdentity('/workspace/project-worktree')).toEqual({
      projectId: '/workspace/project-worktree',
      workspaceDirectories: undefined,
    })
  })

  it('统一正斜杠与尾斜杠', () => {
    expect(getProjectGroupIdentity('D:\\data\\backup\\')).toEqual({
      projectId: 'D:/data/backup',
      workspaceDirectories: undefined,
    })
  })
})
