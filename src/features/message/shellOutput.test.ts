import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followShellOutput, SHELL_OUTPUT_TAIL_BYTES } from './shellOutput'

const loadMock = vi.fn()
const notFoundMock = vi.fn()

vi.mock('../../api/shell', () => ({
  getShellOutput: (id: string, cursor: number) => loadMock(id, cursor),
}))

vi.mock('@opencode/client/promise', () => ({
  isShellNotFoundError: (cause: unknown) => notFoundMock(cause),
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 20))

describe('followShellOutput（官方 shell-output.ts 同款）', () => {
  beforeEach(() => {
    loadMock.mockReset()
    notFoundMock.mockReset()
  })

  it('按游标增量追加输出（非存活时一次读完全部分页）', async () => {
    loadMock.mockImplementation(async (_id: string, cursor: number) => {
      if (cursor === 0) return { output: 'hello ', cursor: 6, size: 11, truncated: false }
      return { output: 'world', cursor: 11, size: 11, truncated: false }
    })
    const outputs: string[] = []
    // running=false：补读路径在一次调用里翻完所有页直到 complete
    const dispose = followShellOutput({ id: 'sh-1', running: false, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    expect(outputs.at(-1)).toBe('hello world')
    expect(loadMock).toHaveBeenCalledWith('sh-1', 0)
    expect(loadMock).toHaveBeenCalledWith('sh-1', 6)
  })

  it('存活期间每轮只读一页（官方：running 时 1s 轮询推进）', async () => {
    loadMock.mockImplementation(async (_id: string, cursor: number) => {
      if (cursor === 0) return { output: 'hello ', cursor: 6, size: 11, truncated: false }
      return { output: 'world', cursor: 11, size: 11, truncated: false }
    })
    const outputs: string[] = []
    const dispose = followShellOutput({ id: 'sh-live', running: true, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    // 首轮只读到第一页；第二页要等下一次 1s 轮询
    expect(outputs.at(-1)).toBe('hello ')
  })

  it('not found 的 shell 标记 missing 且不再请求', async () => {
    notFoundMock.mockReturnValue(true)
    loadMock.mockRejectedValue(new Error('Shell not found'))
    const outputs: string[] = []
    const dispose = followShellOutput({ id: 'sh-gone', running: true, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    const calls = loadMock.mock.calls.length
    // 再挂载一次：missing 状态直接短路，不再请求
    followShellOutput({ id: 'sh-gone', running: true, onOutput: () => {} })
    await flush()
    expect(loadMock.mock.calls.length).toBe(calls)
  })

  it('输出超过 64KB 时只保留尾部', async () => {
    const big = 'x'.repeat(SHELL_OUTPUT_TAIL_BYTES + 100)
    loadMock.mockResolvedValue({ output: big, cursor: big.length, size: big.length, truncated: false })
    const outputs: string[] = []
    const dispose = followShellOutput({ id: 'sh-big', running: true, onOutput: o => outputs.push(o) })
    await flush()
    dispose()
    expect(outputs.at(-1)?.length).toBe(SHELL_OUTPUT_TAIL_BYTES)
  })

  it('重挂载时从记忆的游标续读，不回零', async () => {
    loadMock.mockImplementation(async (_id: string, cursor: number) =>
      cursor === 0
        ? { output: 'chunk', cursor: 5, size: 100, truncated: false }
        : { output: '', cursor, size: 100, truncated: false },
    )
    const first = followShellOutput({ id: 'sh-resume', running: false, onOutput: () => {} })
    await flush()
    first()

    const outputs: string[] = []
    const second = followShellOutput({ id: 'sh-resume', running: false, onOutput: o => outputs.push(o) })
    await flush()
    second()
    // 有缓存输出直接回放；续读游标之后无新增，不重复
    expect(outputs[0]).toBe('chunk')
    expect(outputs.at(-1)).toBe('chunk')
    // 续读请求用的是记忆游标，不是 0
    expect(loadMock.mock.calls.at(-1)?.[1]).toBe(5)
  })
})

// ============================================
// UTF-8 边界自愈
// 服务端 shell.output 按字节区间独立 decode（core/shell.ts），
// 多字节字符跨区间会被切成 U+FFFD。这里按字节流精确模拟分页，
// 验证累计文本永远干净。
// ============================================

// 'ab流cd' 的字节布局：a b [E4 B5 81] c d（流 = 3 字节）
function page(output: string, cursor: number, size: number) {
  return { output, cursor, size, truncated: false }
}

describe('followShellOutput UTF-8 边界自愈', () => {
  beforeEach(() => {
    loadMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('页尾切在字符第 1 字节后（r=1）：剥离回退，下页从 lead 字节干净续上', async () => {
    const outputs: string[] = []
    loadMock
      // [0,3)：'a','b',E4 → decode 'ab�'，游标 3
      .mockResolvedValueOnce(page('ab�', 3, 3))
      // 自愈后游标 2：[2,7) 从 lead 字节开始 → '流cd'
      .mockResolvedValueOnce(page('流cd', 7, 7))
      .mockResolvedValue(page('', 7, 7))

    const dispose = followShellOutput({ id: 'sh-r1', running: true, onOutput: o => outputs.push(o) })
    await vi.advanceTimersByTimeAsync(0)
    expect(outputs.at(-1)).toBe('ab')
    expect(loadMock.mock.calls[0][1]).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)
    // 第二轮请求用的是剥离后的游标 2
    expect(loadMock.mock.calls[1][1]).toBe(2)
    expect(outputs.at(-1)).toBe('ab流cd')
    dispose()
  })

  it('页尾切在第 2 字节后（r=2，猜测回退过头）：页头检查回滚存档点整段重读', async () => {
    const outputs: string[] = []
    loadMock
      // [0,4)：'a','b',E4,B5 → decode 'ab�'，游标 4；剥离 1 符 → 游标 3（落在字符中间）
      .mockResolvedValueOnce(page('ab�', 4, 4))
      // [3,7)：从 continuation 字节开始 → decode '�cd' → 页头检查失败，回滚到 0
      .mockResolvedValueOnce(page('�cd', 7, 7))
      // [0,7) 整段重读 → 干净
      .mockResolvedValueOnce(page('ab流cd', 7, 7))
      .mockResolvedValue(page('', 7, 7))

    const dispose = followShellOutput({ id: 'sh-r2', running: true, onOutput: o => outputs.push(o) })
    await vi.advanceTimersByTimeAsync(0)
    expect(outputs.at(-1)).toBe('ab')

    // 第二轮：游标 3 落在字符中间 → 页头检查 → 回滚到存档点 0
    await vi.advanceTimersByTimeAsync(1000)
    expect(loadMock.mock.calls[1][1]).toBe(3)

    // 第三轮：从存档点 0 整段重读，文本自愈
    await vi.advanceTimersByTimeAsync(1000)
    expect(loadMock.mock.calls[2][1]).toBe(0)
    expect(outputs.at(-1)).toBe('ab流cd')
    expect(outputs.at(-1)).not.toContain('�')
    dispose()
  })

  it('输出本身含 U+FFFD：同一位置不重复自愈，原样接受避免死循环', async () => {
    const outputs: string[] = []
    loadMock
      // 文件里真的有 U+FFFD（3 字节 EF BF BD），页尾恰好切在它后面
      .mockResolvedValueOnce(page('ab�', 5, 5))
      // 剥离 1 符游标 4 → [4,...) 从真实 U+FFFD 的第 3 字节开始 → 页头又是 �
      .mockResolvedValueOnce(page('�x', 7, 7))
      // 回滚到 0 重读：同样的页尾，同样剥离 → 游标又到 4 → 页头又失败
      .mockResolvedValueOnce(page('ab�', 5, 5))
      // 同一位置第二次 → 原样接受
      .mockResolvedValueOnce(page('�x', 7, 7))
      .mockResolvedValue(page('', 7, 7))

    const dispose = followShellOutput({ id: 'sh-real', running: true, onOutput: o => outputs.push(o) })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    // 最终接受原样内容：真实 U+FFFD 恰好恢复一次（不多不少），且轮询没有卡死
    expect(outputs.at(-1)).toBe('ab�x')
    dispose()
  })
})
