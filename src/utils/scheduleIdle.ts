// ============================================
// 空闲调度
//
// 会话切换时有些恢复动作（子会话关系、task 卡片绑定校验、权限补拉）
// 功能上必需，但不该和首屏消息抢同源连接。等到浏览器空闲再跑，
// 并用 timeout 兜底：后台标签页里 requestIdleCallback 可能长期不触发。
// ============================================

interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

type RequestIdleCallback = (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number
type CancelIdleCallback = (handle: number) => void

interface IdleWindow {
  requestIdleCallback?: RequestIdleCallback
  cancelIdleCallback?: CancelIdleCallback
}

/**
 * 在空闲时执行一次任务，返回取消函数。
 *
 * 任务最多执行一次；取消后不会再执行。没有 requestIdleCallback 的环境
 * （测试 / 旧内核）退化为定时器，保证任务一定有机会执行。
 */
export function scheduleIdle(task: () => void, timeoutMs = 500): () => void {
  let done = false
  let idleHandle: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const idleWindow = typeof window === 'undefined' ? undefined : (window as unknown as IdleWindow)

  const clear = () => {
    if (idleHandle !== null && idleWindow?.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(idleHandle)
    }
    idleHandle = null
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const run = () => {
    if (done) return
    done = true
    clear()
    task()
  }

  if (idleWindow?.requestIdleCallback) {
    idleHandle = idleWindow.requestIdleCallback(run, { timeout: timeoutMs })
  }
  // rIC 迟迟不派发（后台标签页）时由定时器接管
  timer = setTimeout(run, timeoutMs)

  return () => {
    done = true
    clear()
  }
}
