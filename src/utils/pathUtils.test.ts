import { describe, it, expect } from 'vitest'
import { absolutePathToFileUrl, canonicalizePath, resolveEntryPath, fileBaseName, toAbsoluteFilePath } from './pathUtils'

describe('canonicalizePath', () => {
  it('折叠 .. 段（Windows 盘符根）', () => {
    expect(canonicalizePath('D:/data/../../../../../data/backup/')).toBe('D:/data/backup')
  })

  it('折叠 . 与 .. 混合段', () => {
    expect(canonicalizePath('C:/a/./b/../c')).toBe('C:/a/c')
  })

  it('统一反斜杠为正斜杠', () => {
    expect(canonicalizePath('D:\\data\\..\\backup')).toBe('D:/backup')
  })

  it('Unix 根路径', () => {
    expect(canonicalizePath('/home/user/../other')).toBe('/home/other')
  })

  it('根之上多余的 .. 被丢弃（与 path.resolve 一致）', () => {
    expect(canonicalizePath('C:/../x')).toBe('C:/x')
    expect(canonicalizePath('/../../etc')).toBe('/etc')
  })

  it('相对路径保留开头的 ..', () => {
    expect(canonicalizePath('../../a/b')).toBe('../../a/b')
  })

  it('空路径返回空', () => {
    expect(canonicalizePath('')).toBe('')
  })
})

describe('absolutePathToFileUrl', () => {
  it('Windows 盘符保留冒号，路径分段做 URL 编码', () => {
    expect(absolutePathToFileUrl('C:\\Users\\me\\My File.txt')).toBe('file:///C:/Users/me/My%20File.txt')
    expect(absolutePathToFileUrl('C:/tmp/a#b?c%d.txt')).toBe('file:///C:/tmp/a%23b%3Fc%25d.txt')
  })

  it('Unix 绝对路径与相对路径都给出三斜杠形态', () => {
    expect(absolutePathToFileUrl('/workspace/my file.ts')).toBe('file:///workspace/my%20file.ts')
    expect(absolutePathToFileUrl('src/my file.ts')).toBe('file:///src/my%20file.ts')
  })

  it('中文与保留字符可被 new URL 原样还原', () => {
    const path = '/tmp/目录/报告 (最终版)#2.txt'
    const url = absolutePathToFileUrl(path)
    expect(new URL(url).hash).toBe('')
    expect(decodeURIComponent(new URL(url).pathname)).toBe(path)
  })
})

describe('resolveEntryPath', () => {  // v2 file.list 的条目 path 相对 location 根，浏览到根之外时带 ../
  it('根之内的条目直接拼到根上', () => {
    expect(resolveEntryPath('src/components/', 'D:/work/project')).toBe('D:/work/project/src/components')
  })

  it('根之外的条目（带 ../）折叠为正确的绝对路径', () => {
    expect(resolveEntryPath('../../../../../data/backup/', 'D:/a/b/c/d/e')).toBe('D:/data/backup')
  })

  it('Windows 反斜杠条目（Windows 服务器 path.sep = \\）', () => {
    expect(resolveEntryPath('..\\..\\data\\backup\\', 'D:\\a\\b')).toBe('D:/data/backup')
  })

  it('条目本身就是绝对路径时原样规范化', () => {
    expect(resolveEntryPath('D:/data/backup', 'D:/work/project')).toBe('D:/data/backup')
    expect(resolveEntryPath('/etc/nginx', '/home/user')).toBe('/etc/nginx')
  })

  it('"." 与空条目解析为根本身', () => {
    expect(resolveEntryPath('.', 'D:/work/project')).toBe('D:/work/project')
  })
})

describe('fileBaseName / toAbsoluteFilePath 回归', () => {
  it('basename 兼容两种分隔符与尾斜杠', () => {
    expect(fileBaseName('D:/data/backup/')).toBe('backup')
    expect(fileBaseName('D:\\data\\backup')).toBe('backup')
  })

  it('toAbsoluteFilePath 行为不变', () => {
    expect(toAbsoluteFilePath('src/a.ts', 'D:/repo')).toBe('D:/repo/src/a.ts')
    expect(toAbsoluteFilePath('D:/x.ts', 'D:/repo')).toBe('D:/x.ts')
  })
})
