import { normalizeToForwardSlash } from '../../../utils'

/**
 * 项目分组身份。
 *
 * 设计决策（2026-02）：worktree **不再合并**进根项目——每个目录（无论是
 * git 根还是 sandbox worktree）都按独立文件夹展示，用户侧栏里看到什么
 * 文件夹就是什么项目，更清晰。git 仓库的 worktree 管理入口在
 * WorktreePanel（创建/删除），在那里打开 worktree 时已经会把它
 * addDirectory 成独立文件夹。
 */
export function getProjectGroupIdentity(directory: string) {
  const normalizedDirectory = normalizeToForwardSlash(directory)

  return {
    projectId: normalizedDirectory,
    workspaceDirectories: undefined as string[] | undefined,
  }
}
