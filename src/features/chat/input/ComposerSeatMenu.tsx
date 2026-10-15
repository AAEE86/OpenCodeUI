/**
 * ComposerSeatMenu - DSH 风格的输入框汇总选择器
 *
 * 单个触发器显示「模型 · 推理等级 · Agent」，菜单根面板是行式列表
 * （标签 + 当前值 + 右箭头），推理/Agent 行下钻到各自的单选面板。
 * 模型行复用完整 ModelSelector（隐藏锚点由 InputToolbar 挂载），
 * 点击后关闭本菜单并打开模型选择菜单，保证搜索/置顶/键盘导航不丢。
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from '../../../components/Icons'
import { DropdownMenu } from '../../../components/ui'
import type { ApiAgent } from '../../../api/client'

type Pane = 'root' | 'variant' | 'agent'

interface ComposerSeatMenuProps {
  /** 当前模型显示名（空表示未选） */
  modelLabel: string
  modelsLoading?: boolean

  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void

  /** 已过滤的可选 agent 列表（非 subagent、非 hidden） */
  agents: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void

  disabled?: boolean
  /** 约束菜单边界的容器 ref（输入框容器） */
  constrainToRef?: React.RefObject<HTMLDivElement | null>
  /** 打开完整模型选择菜单（隐藏锚点 ModelSelector） */
  onOpenModelMenu: () => void
  /** 关闭菜单后把焦点还给输入框 */
  focusComposer: () => void
}

function formatVariantLabel(variant: string): string {
  return variant.charAt(0).toUpperCase() + variant.slice(1)
}

export function ComposerSeatMenu({
  modelLabel,
  modelsLoading = false,
  variants = [],
  selectedVariant,
  onVariantChange,
  agents,
  selectedAgent,
  onAgentChange,
  disabled = false,
  constrainToRef,
  onOpenModelMenu,
  focusComposer,
}: ComposerSeatMenuProps) {
  const { t } = useTranslation('chat')
  const [isOpen, setIsOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // 委托打开模型菜单时瞬时关闭本菜单（跳过退出动画），避免两个浮层叠化
  const [instantClose, setInstantClose] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const currentAgent = agents.find(a => a.id === selectedAgent || a.name === selectedAgent)
  const variantLabel = selectedVariant ? formatVariantLabel(selectedVariant) : t('inputToolbar.default')
  const agentLabel = currentAgent?.name ?? selectedAgent ?? 'build'
  const showVariantRow = variants.length > 0
  const showAgentRow = agents.length > 1

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      setIsOpen(false)
      setPane('root')
      if (restoreFocus) window.setTimeout(focusComposer, 0)
    },
    [focusComposer],
  )

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setIsOpen(false)
        setPane('root')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Escape 关闭（下钻面板先退回根面板）
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (pane !== 'root') {
        setPane('root')
      } else {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [isOpen, pane])

  // 面板内方向键导航
  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
      )
      if (items.length === 0) return
      const currentIndex = items.findIndex(item => item === document.activeElement)

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        items[(currentIndex + 1 + items.length) % items.length]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        items[(currentIndex - 1 + items.length) % items.length]?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        items[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        items[items.length - 1]?.focus()
      } else if (event.key === 'ArrowLeft' && pane !== 'root') {
        event.preventDefault()
        setPane('root')
      }
    },
    [pane],
  )

  // 切换面板后聚焦首项
  useEffect(() => {
    if (!isOpen) return
    const timerId = window.setTimeout(() => {
      const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
      ;(selected ?? first)?.focus()
    }, 0)
    return () => clearTimeout(timerId)
  }, [isOpen, pane])

  const openModelMenu = () => {
    setInstantClose(true)
    setIsOpen(false)
    setPane('root')
    // 本菜单当帧卸载后再开模型菜单，避免两个浮层抢焦点
    window.setTimeout(() => {
      onOpenModelMenu()
      setInstantClose(false)
    }, 0)
  }

  const rootRow = (
    label: string,
    value: string,
    onClick: () => void,
    valueColor?: string,
  ) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-bg-200 cursor-pointer"
    >
      <span className="text-[length:var(--fs-sm)] text-text-400 shrink-0">{label}</span>
      <span
        className="flex-1 min-w-0 text-right text-[length:var(--fs-sm)] text-text-200 truncate"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
      <span className="shrink-0 text-text-500">
        <ChevronRightIcon size={14} />
      </span>
    </button>
  )

  // 下钻面板：纯文字单选列表，无图标、无返回行（重开菜单即回根面板）
  const radioItem = (
    key: string,
    label: string,
    selected: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
        selected ? 'bg-accent-main-100/10 text-text-100' : 'text-text-300 hover:bg-bg-200'
      }`}
    >
      <span className="flex-1 min-w-0 text-[length:var(--fs-sm)] truncate">{label}</span>
      {selected && (
        <span className="shrink-0 text-accent-main-100">
          <CheckIcon size={14} />
        </span>
      )}
    </button>
  )

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // 无论开关都回到根面板：开着时点按钮 = 关闭，再开应从根面板开始
          setPane('root')
          setIsOpen(open => !open)
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('inputToolbar.seatMenu')}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all duration-150 hover:bg-bg-200 active:scale-95 cursor-pointer min-w-0 max-w-full overflow-hidden"
        title={[
          modelLabel || t('inputToolbar.seatSelectModel'),
          ...(showVariantRow ? [variantLabel] : []),
          ...(showAgentRow ? [agentLabel] : []),
        ].join(' · ')}
      >
        {/* 宽度不设固定上限：空间够就完整显示，不够时由 flex 收缩 + truncate 出省略号。
            固定上限（曾经是 160/72px）会在有余量时也无谓压缩模型名。 */}
        <span className="text-[length:var(--fs-sm)] font-medium text-text-200 min-w-0 truncate">
          {/* 有缓存标签就始终显示：后台刷新（provider/model/config 事件触发 refetch）
              期间 isLoading 短暂为 true，若让 '…' 抢占标签会造成可见闪烁 */}
          {modelLabel || (modelsLoading ? '…' : t('inputToolbar.seatSelectModel'))}
        </span>
        {(showVariantRow || showAgentRow) && <span className="text-text-500 shrink-0">·</span>}
        {showVariantRow && (
          <span className="text-[length:var(--fs-sm)] text-text-400 min-w-0 truncate">{variantLabel}</span>
        )}
        {showVariantRow && showAgentRow && <span className="text-text-500 shrink-0">·</span>}
        {showAgentRow && (
          <span
            className="text-[length:var(--fs-sm)] text-text-400 min-w-0 truncate"
            style={currentAgent?.color ? { color: currentAgent.color } : undefined}
          >
            {agentLabel}
          </span>
        )}
        <span className={`text-text-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDownIcon size={14} />
        </span>
      </button>

      <DropdownMenu
        triggerRef={triggerRef}
        isOpen={isOpen}
        position="top"
        align="left"
        minWidth="280px"
        width="300px"
        constrainToRef={constrainToRef}
        exitDuration={instantClose ? 0 : 200}
      >
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('inputToolbar.seatMenu')}
          onKeyDown={handleMenuKeyDown}
        >
          {pane === 'root' && (
            <>
              {rootRow(
                t('inputToolbar.seatModel'),
                modelLabel || t('inputToolbar.seatSelectModel'),
                openModelMenu,
              )}
              {showVariantRow && rootRow(t('inputToolbar.seatEffort'), variantLabel, () => setPane('variant'))}
              {showAgentRow &&
                rootRow(t('inputToolbar.seatAgent'), agentLabel, () => setPane('agent'), currentAgent?.color)}
            </>
          )}

          {pane === 'variant' && (
            <>
              {radioItem('default', t('inputToolbar.default'), !selectedVariant, () => {
                onVariantChange?.(undefined)
                closeMenu(true)
              })}
              {variants.map(variant =>
                radioItem(variant, formatVariantLabel(variant), selectedVariant === variant, () => {
                  onVariantChange?.(variant)
                  closeMenu(true)
                }),
              )}
            </>
          )}

          {pane === 'agent' && (
            <>
              {agents.map(agent =>
                radioItem(
                  agent.id,
                  agent.name,
                  selectedAgent === agent.id || selectedAgent === agent.name,
                  () => {
                    onAgentChange?.(agent.id)
                    closeMenu(true)
                  },
                ),
              )}
            </>
          )}
        </div>
      </DropdownMenu>
    </div>
  )
}
