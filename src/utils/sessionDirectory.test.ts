import { describe, expect, it } from 'vitest'
import { sessionRouteDirectory } from './sessionDirectory'

describe('sessionRouteDirectory', () => {
  it('v2 ApiSession：目录在 location.directory', () => {
    expect(sessionRouteDirectory({ location: { directory: '/repo/a' } })).toBe('/repo/a')
  })

  it('命令面板形态：扁平 directory 优先', () => {
    expect(sessionRouteDirectory({ directory: '/repo/b', location: { directory: '/repo/a' } })).toBe('/repo/b')
  })

  it('两者都没有：undefined（路由保持当前目录）', () => {
    expect(sessionRouteDirectory({})).toBeUndefined()
    expect(sessionRouteDirectory({ location: {} })).toBeUndefined()
  })
})
