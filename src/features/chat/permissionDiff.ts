/**
 * 权限请求 metadata 的 diff 提取。
 *
 * v1 时代是 `metadata.diff`（unified diff 字符串）或 `metadata.filediff`
 * （`{ patch }` 或 `{ before, after }`）；v2 改为
 * `metadata.files: [FileDiff.Info]`（官方 edit.ts:180 / write.ts:82 的
 * permission.assert），单文件形状是 `{ file, patch, additions, deletions, status }`。
 *
 * 三条来源按优先级取：filediff > files[].patch > diff。
 */

export interface PermissionDiffData {
  /** unified / patch 字符串 */
  diff?: string
  before?: string
  after?: string
  filePath?: string
}

export function extractPermissionDiff(metadata: Record<string, unknown> | undefined): PermissionDiffData {
  const result: PermissionDiffData = {}
  if (!metadata) return result

  // v1.4.0+：filediff（优先 patch 字符串，其次 before/after）
  if (metadata.filediff && typeof metadata.filediff === 'object') {
    const fd = metadata.filediff as Record<string, unknown>
    if (typeof fd.patch === 'string') result.diff = fd.patch
    if (fd.before !== undefined) result.before = String(fd.before)
    if (fd.after !== undefined) result.after = String(fd.after)
  }

  // v2：files: [FileDiff.Info]，取第一个带 patch/diff 的文件
  if (!result.diff && Array.isArray(metadata.files)) {
    for (const entry of metadata.files as Record<string, unknown>[]) {
      if (!entry || typeof entry !== 'object') continue
      const patch =
        typeof entry.patch === 'string' ? entry.patch : typeof entry.diff === 'string' ? entry.diff : undefined
      if (!patch) continue
      result.diff = patch
      const file = entry.file ?? entry.filePath
      if (typeof file === 'string') result.filePath = file
      break
    }
  }

  // v1 旧：unified diff 字符串
  if (!result.diff && typeof metadata.diff === 'string') {
    result.diff = metadata.diff
  }

  // filePath 兜底：v1 顶层 filepath
  if (!result.filePath && typeof metadata.filepath === 'string') {
    result.filePath = metadata.filepath
  }

  return result
}
