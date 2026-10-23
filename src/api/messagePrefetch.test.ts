import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messageStore } from '../store/messageStore'
import { makeSessionKey } from '../utils/sessionKey'

const { getSessionMessagesPageMock } = vi.hoisted(() => ({ getSessionMessagesPageMock: vi.fn() }))

vi.mock('./message', () => ({
  getSessionMessagesPage: (...args: unknown[]) => getSessionMessagesPageMock(...args),
}))

const {
  clearSessionMessagesPrefetch,
  prefetchSessionMessages,
  takeSessionMessagesPrefetch,
} = await import('./messagePrefetch')

const SERVER = 'local'
const SESSION = 'ses_a'
const LIMIT = 20

const emptyPage = { messages: [], nextCursor: null }

describe('messagePrefetch', () => {
  beforeEach(() => {
    clearSessionMessagesPrefetch()
    getSessionMessagesPageMock.mockReset()
    getSessionMessagesPageMock.mockResolvedValue(emptyPage)
  })

  it('预取后会话页取走同一个请求，不会重发', async () => {
    prefetchSessionMessages(SERVER, SESSION, LIMIT)
    const taken = takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)

    expect(taken).toBeDefined()
    await expect(taken).resolves.toEqual(emptyPage)
    expect(getSessionMessagesPageMock).toHaveBeenCalledTimes(1)
    expect(getSessionMessagesPageMock).toHaveBeenCalledWith(SESSION, { limit: LIMIT }, SERVER)
  })

  it('一次性：取走后再次获取为 undefined（由调用方正常请求）', () => {
    prefetchSessionMessages(SERVER, SESSION, LIMIT)
    takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)
    expect(takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)).toBeUndefined()
  })

  it('重复预取复用同一个请求（连点列表不会打两次）', async () => {
    prefetchSessionMessages(SERVER, SESSION, LIMIT)
    prefetchSessionMessages(SERVER, SESSION, LIMIT)

    await takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)
    expect(getSessionMessagesPageMock).toHaveBeenCalledTimes(1)
  })

  it('未预取时返回 undefined', () => {
    expect(takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)).toBeUndefined()
  })

  it('按服务器与会话隔离', () => {
    prefetchSessionMessages(SERVER, SESSION, LIMIT)
    expect(takeSessionMessagesPrefetch('remote', SESSION, LIMIT)).toBeUndefined()
    expect(takeSessionMessagesPrefetch(SERVER, 'ses_other', LIMIT)).toBeUndefined()
  })

  it('会话已有可渲染缓存时不预取（切过去根本不会请求）', () => {
    messageStore.setMessages(makeSessionKey(SERVER, SESSION), [], { directory: '/workspace/demo' })
    messageStore.setMessages(
      makeSessionKey(SERVER, SESSION),
      [{ id: 'msg-1', type: 'user', text: 'hi', time: { created: 1 } }] as never,
      { directory: '/workspace/demo' },
    )

    prefetchSessionMessages(SERVER, SESSION, LIMIT)

    expect(getSessionMessagesPageMock).not.toHaveBeenCalled()
    messageStore.clearSession(makeSessionKey(SERVER, SESSION))
  })

  it('请求失败会清理槽位，且不产生 unhandled rejection', async () => {
    getSessionMessagesPageMock.mockRejectedValueOnce(new Error('boom'))
    prefetchSessionMessages(SERVER, SESSION, LIMIT)

    // 没人取走：等待微任务让 catch 跑道
    await Promise.resolve()
    await Promise.resolve()

    expect(takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)).toBeUndefined()
  })

  it('取走失败请求时调用方仍能拿到真实错误', async () => {
    const failure = new Error('boom')
    getSessionMessagesPageMock.mockRejectedValueOnce(failure)
    prefetchSessionMessages(SERVER, SESSION, LIMIT)

    await expect(takeSessionMessagesPrefetch(SERVER, SESSION, LIMIT)).rejects.toBe(failure)
  })
})
