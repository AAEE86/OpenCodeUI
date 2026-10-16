import { describe, expect, it } from 'vitest'
import { extractPermissionDiff } from './permissionDiff'

describe('extractPermissionDiff', () => {
  it('returns empty when metadata is missing', () => {
    expect(extractPermissionDiff(undefined)).toEqual({})
  })

  it('reads v1 unified diff string', () => {
    expect(extractPermissionDiff({ diff: '@@ -1 +1 @@', filepath: 'a.ts' })).toEqual({
      diff: '@@ -1 +1 @@',
      filePath: 'a.ts',
    })
  })

  it('prefers v1 filediff patch over diff string', () => {
    const result = extractPermissionDiff({
      filediff: { patch: 'PATCH', additions: 1, deletions: 1 },
      diff: 'DIFF',
    })
    expect(result.diff).toBe('PATCH')
  })

  it('reads v1 filediff before/after when no patch', () => {
    const result = extractPermissionDiff({ filediff: { before: 'old', after: 'new' } })
    expect(result).toEqual({ before: 'old', after: 'new' })
  })

  it('reads v2 files[].patch and file (FileDiff.Info)', () => {
    const result = extractPermissionDiff({
      files: [{ file: 'src/a.ts', patch: 'PATCH2', additions: 2, deletions: 0, status: 'modified' }],
    })
    expect(result).toEqual({ diff: 'PATCH2', filePath: 'src/a.ts' })
  })

  it('prefers filediff over files, and files over top-level diff', () => {
    // filediff 优先
    expect(
      extractPermissionDiff({
        filediff: { patch: 'FD' },
        files: [{ file: 'a', patch: 'F' }],
      }).diff,
    ).toBe('FD')
    // files 优先于顶层 diff
    expect(
      extractPermissionDiff({
        files: [{ file: 'a', patch: 'F' }],
        diff: 'D',
      }).diff,
    ).toBe('F')
  })

  it('skips files entries without a patch and falls back to top-level diff', () => {
    const result = extractPermissionDiff({ files: [{ file: 'a' }], diff: 'D' })
    expect(result.diff).toBe('D')
  })

  it('uses files[].file over top-level filepath', () => {
    const result = extractPermissionDiff({
      files: [{ file: 'from-files.ts', patch: 'P' }],
      filepath: 'top-level.ts',
    })
    expect(result.filePath).toBe('from-files.ts')
  })
})
