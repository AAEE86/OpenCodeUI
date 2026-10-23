import { describe, expect, it } from 'vitest'
import { isCompleteSessionInfo, sessionInfoCache } from './sessionInfoCache'
import type { Session } from '../types/api/session'

const SERVER = 'local'

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    title: `title-${id}`,
    location: { directory: '/workspace/demo' },
    time: { created: 1, updated: 2 },
    ...patch,
  } as Session
}

describe('sessionInfoCache', () => {
  it('remember 之后可以命中（列表 → 会话页的交接）', () => {
    sessionInfoCache.remember(SERVER, session('ses_a'))
    expect(sessionInfoCache.get(SERVER, 'ses_a')?.title).toBe('title-ses_a')
    sessionInfoCache.forget(SERVER, 'ses_a')
  })

  it('按服务器隔离：同 id 不同服务器不串数据', () => {
    sessionInfoCache.remember(SERVER, session('ses_shared', { title: 'local-title' }))
    sessionInfoCache.remember('remote', session('ses_shared', { title: 'remote-title' }))

    expect(sessionInfoCache.get(SERVER, 'ses_shared')?.title).toBe('local-title')
    expect(sessionInfoCache.get('remote', 'ses_shared')?.title).toBe('remote-title')

    sessionInfoCache.clear()
  })

  it('未命中返回 undefined（深链、刷新走正常请求）', () => {
    sessionInfoCache.clear()
    expect(sessionInfoCache.get(SERVER, 'ses_missing')).toBeUndefined()
  })

  it('forget 之后不再命中（删除会话）', () => {
    sessionInfoCache.remember(SERVER, session('ses_gone'))
    sessionInfoCache.forget(SERVER, 'ses_gone')
    expect(sessionInfoCache.get(SERVER, 'ses_gone')).toBeUndefined()
  })

  it('update 就地刷新标题（重命名后 TTL 内不再显示旧标题）', () => {
    sessionInfoCache.remember(SERVER, session('ses_rename'))
    sessionInfoCache.update(SERVER, 'ses_rename', { title: '新标题' })
    expect(sessionInfoCache.get(SERVER, 'ses_rename')?.title).toBe('新标题')
    // 其余字段保持不变，不能因为 patch 把对象弄残
    expect(sessionInfoCache.get(SERVER, 'ses_rename')?.location?.directory).toBe('/workspace/demo')
    sessionInfoCache.forget(SERVER, 'ses_rename')
  })

  it('update 命中不存在的条目时什么都不做（不凭空造数据）', () => {
    sessionInfoCache.clear()
    sessionInfoCache.update(SERVER, 'ses_absent', { title: 'x' })
    expect(sessionInfoCache.get(SERVER, 'ses_absent')).toBeUndefined()
  })
})

describe('isCompleteSessionInfo', () => {
  it('完整 SessionInfo 通过', () => {
    expect(isCompleteSessionInfo(session('ses_full'))).toBe(true)
  })

  it('半截对象（缺 time / location）拒绝写入缓存', () => {
    expect(isCompleteSessionInfo({ id: 'ses_partial', location: { directory: '/x' } })).toBe(false)
    expect(isCompleteSessionInfo({ id: 'ses_partial' })).toBe(false)
    expect(isCompleteSessionInfo(null)).toBe(false)
    expect(isCompleteSessionInfo(undefined)).toBe(false)
  })
})
