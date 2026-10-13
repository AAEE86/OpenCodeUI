import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDelayedRender } from '../../hooks/useDelayedRender'

type DropdownPosition = 'top' | 'bottom'
type DropdownAlign = 'left' | 'right'

interface DropdownMenuProps {
  triggerRef: React.RefObject<HTMLElement | null>
  isOpen: boolean
  position?: DropdownPosition
  align?: DropdownAlign
  width?: number | string
  minWidth?: number | string
  maxWidth?: number | string
  /** 移动端（<640px）全宽展开，左右留 gap 间距 */
  mobileFullWidth?: boolean
  /** 约束菜单在此容器的边界内（宽度 ≤ 容器 65%，不溢出左右） */
  constrainToRef?: React.RefObject<HTMLElement | null>
  /** z-index，默认 100；在 Dialog 等高 z-index 容器内使用时需要调高 */
  zIndex?: number
  /** 关闭后延迟卸载（ms），默认 200；传 0 立即卸载（用于菜单间直接切换） */
  exitDuration?: number
  className?: string
  children: React.ReactNode
}

/** 受管的定位/尺寸样式键，重算前先清空再写新值 */
const POS_KEYS = ['left', 'right', 'top', 'bottom'] as const
const SIZE_KEYS = ['width', 'minWidth', 'maxWidth'] as const

/**
 * Dropdown menu that renders via portal to avoid overflow clipping.
 * 无进场/退场动画，要的是「跟手」：定位在 callback ref（commit 阶段、绘制前）
 * 直接写 DOM style，首帧就在正确位置，不经过 React state，没有任何等待。
 */
export function DropdownMenu({
  triggerRef,
  isOpen,
  position = 'bottom',
  align = 'left',
  width,
  minWidth = '200px',
  maxWidth = 'min(320px, 90vw)',
  mobileFullWidth = false,
  constrainToRef,
  zIndex = 100,
  exitDuration = 200,
  className = '',
  children,
}: DropdownMenuProps) {
  const menuElRef = useRef<HTMLDivElement | null>(null)
  const shouldRender = useDelayedRender(isOpen, exitDuration)

  // 根据 trigger 位置计算定位并直接写入 DOM（数字值补 px）
  const applyStyles = useCallback(() => {
    const el = menuElRef.current
    if (!el || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 8

    const pos: Partial<Record<(typeof POS_KEYS)[number], number>> = {}
    const size: Partial<Record<(typeof SIZE_KEYS)[number], number | string>> = {}

    // --- 垂直定位 ---
    if (position === 'top') {
      pos.bottom = window.innerHeight - rect.top + gap
    } else {
      pos.top = rect.bottom + gap
    }

    // --- 水平定位 + 宽度 ---
    // constrainToRef 优先级最高
    if (constrainToRef?.current) {
      const cRect = constrainToRef.current.getBoundingClientRect()
      // 按钮中点相对容器位置，决定对齐方向
      const btnCenter = (rect.left + rect.right) / 2
      const containerCenter = (cRect.left + cRect.right) / 2

      if (btnCenter > containerCenter) {
        // 按钮偏右 → 右对齐，maxWidth = 按钮右边缘到容器左边缘
        pos.right = window.innerWidth - rect.right
        size.maxWidth = rect.right - cRect.left
      } else {
        // 按钮偏左 → 左对齐，maxWidth = 容器右边缘到按钮左边缘
        pos.left = rect.left
        size.maxWidth = cRect.right - rect.left
      }
    } else if (mobileFullWidth && window.innerWidth < 640) {
      // 移动端全宽（无 constrainToRef 时的 fallback）
      pos.left = 12
      pos.right = 12
    } else {
      // 普通模式
      if (align === 'right') {
        pos.right = window.innerWidth - rect.right
      } else {
        pos.left = rect.left
      }
      size.width = width || 'auto'
      size.minWidth = minWidth
      size.maxWidth = maxWidth
    }

    for (const key of POS_KEYS) el.style[key] = ''
    for (const key of SIZE_KEYS) el.style[key] = ''
    for (const [key, value] of Object.entries(pos)) {
      el.style[key as (typeof POS_KEYS)[number]] = `${value}px`
    }
    for (const [key, value] of Object.entries(size)) {
      el.style[key as (typeof SIZE_KEYS)[number]] = typeof value === 'number' ? `${value}px` : String(value)
    }
  }, [triggerRef, position, align, width, minWidth, maxWidth, mobileFullWidth, constrainToRef])

  // callback ref：commit 阶段（绘制前）同步定位，首帧即正确
  const setMenuEl = useCallback(
    (el: HTMLDivElement | null) => {
      menuElRef.current = el
      if (el) applyStyles()
    },
    [applyStyles],
  )

  // 打开期间按需同步位置与宽度，避免常驻 rAF 轮询
  useEffect(() => {
    if (!shouldRender) return

    let rafId: number | null = null
    const scheduleUpdate = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        applyStyles()
      })
    }

    // 挂载后下一帧补一次重算：callback ref 已保证首帧位置正确，
    // 这里兜底 trigger 矩形在挂载当帧还没就绪的场景（如布局刚变化）
    scheduleUpdate()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate()
      })
      if (triggerRef.current) resizeObserver.observe(triggerRef.current)
      if (constrainToRef?.current) resizeObserver.observe(constrainToRef.current)
    }

    return () => {
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      resizeObserver?.disconnect()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [shouldRender, applyStyles, triggerRef, constrainToRef])

  if (!shouldRender) return null

  return createPortal(
    <div
      ref={setMenuEl}
      aria-hidden={!isOpen}
      className={`
        fixed p-1 glass border border-border-200/60 rounded-xl shadow-lg
        ${className}
      `}
      style={{
        zIndex,
        visibility: isOpen ? 'visible' : 'hidden',
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
