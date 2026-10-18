import { describe, expect, it } from 'vitest'
import { buildPathAttachment, decideNativeFileRoute } from './attachmentUpload'

// ============================================
// 桌面端拖入的本机文件该走哪条路（需求二）
//
// 服务端与客户端同机时**不上传**：原生媒体内联，其余沿用原有的 @ 引用
// （服务端自己读得到那个路径）。服务端在远端时只能上传。
// ============================================

const allCaps = { image: true, pdf: true, audio: true, video: true }
const noCaps = { image: false, pdf: false, audio: false, video: false }
const MB = 1024 * 1024

describe('decideNativeFileRoute', () => {
  it('同机 + 原生媒体 → 内联（读本机字节，不上传）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'image/png',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/pics/a.png',
      }),
    ).toEqual({ kind: 'inline' })
  })

  it('同机 + 白名单外（zip）→ 走原有的 @ 引用，不上传', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/dl/piui-source.zip',
      }),
    ).toEqual({ kind: 'mention' })
  })

  it('同机 + 原生媒体但超过内联上限 → 也是 @ 引用（不上传）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'image/png',
        size: 21 * MB,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/pics/huge.png',
      }),
    ).toEqual({ kind: 'mention' })
  })

  it('同机 + 超大文件也不拒绝（根本不上传，没有上限问题）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 500 * MB,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/dl/huge.zip',
      }),
    ).toEqual({ kind: 'mention' })
  })

  it('远端 + 白名单外 → 上传', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 1024,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/dl/piui-source.zip',
      }),
    ).toEqual({ kind: 'upload', pathOnly: false })
  })

  it('远端 + 超过 20MB → 上传但只作路径引用', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 21 * MB,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/dl/big.zip',
      }),
    ).toEqual({ kind: 'upload', pathOnly: true })
  })

  it('远端 + 超过上传上限 → 拒绝', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 300 * MB,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/dl/huge.zip',
      }),
    ).toEqual({ kind: 'reject' })
  })

  it('远端 + 模型没有原生能力 + 图片 → 上传（不丢弃）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'image/png',
        size: 1024,
        caps: noCaps,
        serverIsLocal: false,
        nativePath: 'C:/pics/a.png',
      }),
    ).toEqual({ kind: 'upload', pathOnly: false })
  })
})

describe('buildPathAttachment', () => {
  it('用 file:// 引用服务端路径，原始文件名用于展示', () => {
    expect(
      buildPathAttachment({
        id: 'a1',
        path: 'C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/report.zip',
        filename: 'report.zip',
        mime: 'application/zip',
        size: 262,
        pathOnly: false,
      }),
    ).toEqual({
      id: 'a1',
      type: 'file',
      displayName: 'report.zip',
      url: 'file:///C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/report.zip',
      mime: 'application/zip',
      relativePath: 'C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/report.zip',
      size: 262,
    })
  })

  it('pathOnly 时标记出来（不进 prompt.files[]）', () => {
    const attachment = buildPathAttachment({
      id: 'a2',
      path: '/tmp/uploads/u1/big.bin',
      filename: 'big.bin',
      mime: 'application/octet-stream',
      size: 21 * MB,
      pathOnly: true,
    })
    expect(attachment.pathOnly).toBe(true)
    expect(attachment.url).toBe('file:///tmp/uploads/u1/big.bin')
  })
})
