// ============================================
// WebsearchDock — websearch.provider 表单的专用交互
//
// 对齐官方 session/requests/session-websearch-dock.tsx + websearch.ts：
//
//   表单有两种形态（metadata.kind === 'websearch.provider'）：
//   - 非 specific（无 provider 字段）：选项 = 「任意」+ websearch.providers 列表；
//     「不使用搜索」→ answer {choice:'disable'}；
//     选「任意」启用 → {choice:'allow'}；
//     选具体 provider → 两段式：先 {choice:'choose'}，服务端再发一张 specific 表单，
//     到齐后自动回 {provider: 选中值}（官方 replyWebSearch L92-153 同款链路）。
//   - specific（带 provider string 字段 + options）：直接回 {provider: 选中值}。
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReturnIcon, SearchIcon, ChevronDownIcon, SpinnerIcon } from '../../components/Icons'
import { getWebsearchProviders } from '../../api/client'
import { usePresence } from '../../hooks'
import { useChatViewport } from './chatViewport'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import type { ApiFormInfo, FormAnswer } from '../../api'
import type { FormStringField } from '@opencode/client/promise'

interface WebsearchDockProps {
  form: ApiFormInfo
  /** 会话所在目录（providers 按 location 拉取） */
  directory?: string
  onReply: (form: ApiFormInfo, answer: FormAnswer) => Promise<boolean>
  isReplying?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

/** 官方 webSearchProviderField：specific 表单判定 */
function providerField(form: ApiFormInfo): FormStringField | undefined {
  return form.fields.find(
    (field): field is FormStringField => field.type === 'string' && field.key === 'provider' && !!field.options,
  )
}

/**
 * 两段式链路的跨挂载状态（sessionID → 选中的 provider）。
 *
 * 回 {choice:'choose'} 后第一张表单消失、dock 卸载，specific 表单到达时
 * dock 重新挂载——ref 会丢，所以按 sessionID 存模块级（官方用 events 监听
 * 保持 model 存活，效果等价）。
 */
const pendingChooseProvider = new Map<string, string>()

export function WebsearchDock({
  form,
  directory,
  onReply,
  isReplying = false,
  collapsed = false,
  onCollapsedChange,
}: WebsearchDockProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { presentation } = useChatViewport()
  const isCompact = presentation.isCompact
  const specific = useMemo(() => providerField(form), [form])
  const [selected, setSelected] = useState<string>('random')
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  const loadProviders = useCallback(() => {
    if (specific) {
      setOptions(specific.options ?? [])
      return
    }
    const requestForm = form
    setLoading(true)
    setLoadFailed(false)
    getWebsearchProviders(directory || undefined)
      .then(list => {
        setOptions(list)
        // 官方 selected 逻辑：specific 落到第一个选项；非 specific 默认 random
        setSelected(prev => (list.some(o => o.value === prev) ? prev : 'random'))
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
    return requestForm
  }, [form, specific, directory])

  useEffect(() => {
    if (specific) {
      setOptions(specific.options ?? [])
      setSelected(prev => (specific.options?.some(o => o.value === prev) ? prev : (specific.options?.[0]?.value ?? '')))
      return
    }
    loadProviders()
    // 换表单时重置（官方 createEffect on request().id）
    setFailed(false)
  }, [form.id, specific, loadProviders])

  const reply = useCallback(
    async (answer: FormAnswer) => {
      setSending(true)
      setFailed(false)
      try {
        const ok = await onReply(form, answer)
        if (!ok) setFailed(true)
      } catch {
        setFailed(true)
      } finally {
        setSending(false)
      }
    },
    [form, onReply],
  )

  // 两段式第二步：specific 表单到达且有待回 provider → 自动回复
  useEffect(() => {
    const pending = pendingChooseProvider.get(form.sessionID)
    if (!pending || !specific) return
    if (!specific.options?.some(o => o.value === pending)) return
    pendingChooseProvider.delete(form.sessionID)
    void reply({ provider: pending })
  }, [form.sessionID, specific, reply])

  const handleEnable = () => {
    if (sending) return
    if (specific) {
      if (selected) void reply({ provider: selected })
      return
    }
    if (selected === 'random') {
      void reply({ choice: 'allow' })
      return
    }
    // 两段式：先 choose，等 specific 表单
    pendingChooseProvider.set(form.sessionID, selected)
    void reply({ choice: 'choose' })
  }

  const handleDisable = () => {
    if (sending || specific) return
    void reply({ choice: 'disable' })
  }

  const allOptions = useMemo(
    () => [...(specific ? [] : [{ value: 'random', label: t('chat:websearch.any') }]), ...options],
    [specific, options, t],
  )
  const unavailable = loading || loadFailed || options.length === 0
  /** 回复在途（本地提交中或上层正在回复） */
  const busy = sending || isReplying

  /** 键盘：和提问/权限一致——send keybinding 启用，Escape 不使用搜索 */
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!specific) handleDisable()
      return
    }
    const sendKey = keybindingStore.getKey('sendMessage')
    if (sendKey && matchesKeybinding(event.nativeEvent, sendKey)) {
      event.preventDefault()
      if (!busy && !unavailable && selected) handleEnable()
    }
  }

  // 弹出/收起动画
  const { shouldRender, ref: animRef } = usePresence<HTMLDivElement>(!collapsed, {
    from: { opacity: 0, transform: 'translateY(16px)' },
    to: { opacity: 1, transform: 'translateY(0px)' },
    duration: 0.2,
  })

  if (!shouldRender) return null

  return (
    <div ref={animRef} className="absolute bottom-0 left-0 right-0 z-[10]" onKeyDown={handleKeyDown}>
      <div
        className="mx-auto max-w-[min(100%,var(--oc-chat-input-width,48rem))] pointer-events-auto transition-[max-width] duration-300 ease-in-out pb-2"
        style={{
          paddingLeft: isCompact ? 6 : 14,
          paddingRight: isCompact ? 6 : 14,
          paddingBottom: 'max(8px, var(--safe-area-inset-bottom, 8px))',
        }}
      >
        <div
          data-component="session-websearch-dock"
          aria-label={t('chat:websearch.title')}
          aria-busy={busy}
          className="border border-border-300/40 rounded-[14px] shadow-float bg-bg-100 overflow-hidden"
        >
          <div className="bg-bg-000 rounded-t-[14px]">
            {/* Header —— 与权限/提问同款：图标 + 标题 + 收起 */}
            <div className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center text-text-100 w-5 h-5">
                  <SearchIcon />
                </div>
                <h3 className="text-[length:var(--fs-base)] leading-none font-medium text-text-100">
                  {t('chat:websearch.title')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onCollapsedChange?.(true)}
                className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200 transition-colors"
                title={t('chat:websearch.minimize')}
                aria-label={t('chat:websearch.minimize')}
              >
                <ChevronDownIcon size={16} />
              </button>
            </div>

            <div className="border-t border-border-300/30" />

            {/* 内容：搜索源选择 */}
            <div className="px-4 py-3 space-y-3 max-h-[45vh] overflow-y-auto custom-scrollbar">
              <div>
                <p className="text-[length:var(--fs-sm)] text-text-400 mb-2">{t('chat:websearch.description')}</p>
                <select
                  aria-label={t('chat:websearch.provider')}
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  disabled={busy || unavailable}
                  className="w-full bg-bg-000 border border-border-200 rounded-md px-2.5 py-2 text-[length:var(--fs-base)] text-text-100 focus:outline-none focus:border-accent-main-100/50 disabled:opacity-50"
                >
                  {allOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-[length:var(--fs-xs)] text-text-400" aria-live="polite">
                {loading && (
                  <span className="inline-flex items-center gap-1.5">
                    <SpinnerIcon size={10} className="animate-spin" />
                    {t('common:loading')}
                  </span>
                )}
                {!loading && failed && <span className="text-danger-100">{t('chat:websearch.failed')}</span>}
                {!loading && !failed && loadFailed && (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-danger-100">{t('chat:websearch.loadFailed')}</span>
                    <button type="button" onClick={loadProviders} className="text-accent-main-100 hover:underline">
                      {t('chat:websearch.retry')}
                    </button>
                  </span>
                )}
                {!loading && !failed && !loadFailed && options.length === 0 && (
                  <span>{t('chat:websearch.empty')}</span>
                )}
              </div>
            </div>

            {/* Actions —— 与权限/提问同款的全宽行按钮 */}
            <div className="px-3 py-3 space-y-[6px]">
              <button
                type="button"
                onClick={handleEnable}
                disabled={busy || unavailable || !selected}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-text-100 text-bg-000 hover:bg-text-200 transition-colors font-medium text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{busy ? t('common:sending') : t('chat:websearch.enable')}</span>
                {!busy && <ReturnIcon />}
              </button>

              {!specific && (
                <button
                  type="button"
                  onClick={handleDisable}
                  disabled={busy}
                  className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-text-300 hover:bg-bg-200 transition-colors text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{t('chat:websearch.disable')}</span>
                  <span className="text-[length:var(--fs-sm)] text-text-500">{t('common:esc')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
