// ============================================
// useSessionModelRestore —— 进入会话时对齐输入框模型
// ============================================
//
// 需求：点进某个 session 时，把输入框的模型选择更新成**这个会话正在跑的模型**，
// 而且只在进入的那一下更新一次（之后用户在输入框里改的模型必须留住）。
//
// 模型来源有两条，按可靠性排序：
//
//   1. durable 会话级模型（`SessionInfo.model`，由 `session.get` 落地，
//      `session.model.selected` 事件增量维护）——权威值，v2 里「这个会话在用哪个模型」
//      就是这个字段（v1 是挂在每条 user 消息上的）。
//   2. 最后一条助手消息的 `model`——v2 的助手消息**必带** model，会话级字段还空着时
//      用它兜底（纯 SSE 暂存出来的会话就属于这种情况）。
//
// 什么时候落「一次」的锁：
//
//   只有**确认试过恢复**才锁。会话 durable 快照还没落地、或者目标模型还不在模型目录里
//   （目录还在拉、模型被隐藏、模型已下线）时先不锁——那种情况下 `restoreFromMessage`
//   会静默什么都不做，锁了就等于「这个会话永远恢复不了模型」，这正是 v2 迁移后丢功能的地方。
//   锁落在 sessionId 上，所以切到别的会话会重新走一遍。

import { useEffect, useMemo, useRef } from 'react'
import type { ModelRef } from '@opencode/client/promise'
import type { Model } from '../api'
import type { SessionMessageInfo } from '../types/api/event'
import { findModelByKey } from '../utils/modelUtils'

/** 最后一条带模型的助手消息的 model（v2 助手消息必带） */
function lastAssistantModel(messages: SessionMessageInfo[]): ModelRef | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === 'assistant' && message.model) return message.model
  }
  return undefined
}

interface UseSessionModelRestoreOptions {
  /** 当前会话 key（routeSessionId）；空值 = 首页 / 新建会话 */
  sessionId: string | null
  /** 会话可见消息（undo 生效后的视图），用于兜底取助手模型 */
  messages: SessionMessageInfo[]
  /** 会话加载状态：只有 loaded / error 才算 durable 快照已落地 */
  loadState: 'idle' | 'loading' | 'loaded' | 'error'
  /** durable 会话级模型（`SessionStateSnapshot.model`） */
  sessionModel: ModelRef | undefined
  /** 可选模型目录（已排除隐藏项）；恢复目标必须能在里面找到 */
  models: Model[]
  restoreFromMessage: (
    model: { providerID: string; modelID: string } | null | undefined,
    variant: string | null | undefined,
  ) => void
}

export function useSessionModelRestore({
  sessionId,
  messages,
  loadState,
  sessionModel,
  models,
  restoreFromMessage,
}: UseSessionModelRestoreOptions): void {
  const restoredSessionRef = useRef<string | null>(null)

  // 引用稳定：流式期间 messages 每次都是新数组，但助手消息的 model 对象不变，
  // 因此下面的 effect 不会因为流式内容增长而重跑。
  const messageModel = useMemo(() => lastAssistantModel(messages), [messages])

  useEffect(() => {
    // 这个会话已经恢复过了（或者还在首页）→ 跳过
    if (!sessionId || restoredSessionRef.current === sessionId) return
    // durable 会话快照还没落地：此刻 sessionModel 缺失只代表「还没读到」，
    // 不代表「这个会话没有模型」，等下一轮
    if (loadState !== 'loaded' && loadState !== 'error') return

    const target = sessionModel ?? messageModel
    if (!target) {
      // 快照已落地，消息里也没有任何模型 → 这个会话确实没有可恢复的模型
      restoredSessionRef.current = sessionId
      return
    }

    // 目标模型不在目录里：restoreFromMessage 会静默匹配失败，锁了就再也补不回来
    if (!findModelByKey(models, `${target.providerID}:${target.id}`)) return

    restoredSessionRef.current = sessionId
    restoreFromMessage({ providerID: target.providerID, modelID: target.id }, target.variant ?? null)
  }, [sessionId, loadState, sessionModel, messageModel, models, restoreFromMessage])
}
