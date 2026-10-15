import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiAgent } from '../../../api/client'
import { ComposerSeatMenu } from './ComposerSeatMenu'

const agents: ApiAgent[] = [
  { id: 'build', name: 'Build', description: 'Build things', mode: 'primary', permissions: [], request: { settings: {}, headers: {}, body: {} }, hidden: false },
  { id: 'plan', name: 'Plan', description: 'Plan work', mode: 'primary', permissions: [], request: { settings: {}, headers: {}, body: {} }, hidden: false },
]

function renderMenu(overrides: Partial<Parameters<typeof ComposerSeatMenu>[0]> = {}) {
  const props: Parameters<typeof ComposerSeatMenu>[0] = {
    modelLabel: 'Kimi K3-256K',
    variants: ['low', 'high'],
    selectedVariant: 'high',
    onVariantChange: vi.fn(),
    agents,
    selectedAgent: 'build',
    onAgentChange: vi.fn(),
    onOpenModelMenu: vi.fn(),
    focusComposer: vi.fn(),
    ...overrides,
  }
  const view = render(<ComposerSeatMenu {...props} />)
  return { props, ...view }
}

describe('ComposerSeatMenu', () => {
  it('trigger summarizes model · effort · agent', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Model / effort / agent menu' })
    expect(trigger).toHaveTextContent('Kimi K3-256K')
    expect(trigger).toHaveTextContent('High')
    expect(trigger).toHaveTextContent('Build')
  })

  it('trigger shrinks like the non-aggregated buttons: only the long model name compresses', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Model / effort / agent menu' })
    // 可收缩（min-w-0 + max-w-full + overflow-hidden）——空间不足时才截断
    expect(trigger.className).toContain('min-w-0')
    expect(trigger.className).toContain('max-w-full')
    expect(trigger.className).toContain('overflow-hidden')
    // 无固定宽度上限：有空间就完整显示模型名（曾经 160/72px 会无谓压缩）
    const labels = Array.from(trigger.querySelectorAll('span'))
    expect(labels.some(span => /max-w-\[\d+px\]/.test(span.className))).toBe(false)
    // 长段可压缩，短值（Default / Build）不参与压缩——与非聚合模式那两个 shrink-0 按钮一致
    const modelLabel = labels.find(span => span.textContent === 'Kimi K3-256K')
    expect(modelLabel?.className).toContain('truncate')
    expect(modelLabel?.className).not.toContain('shrink-0')
    const shortLabels = labels.filter(span => span.textContent === 'High' || span.textContent === 'Build')
    expect(shortLabels).toHaveLength(2)
    expect(shortLabels.every(span => span.className.includes('shrink-0'))).toBe(true)
  })

  it('opens root pane with model / effort / agent rows', () => {    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Model / effort / agent menu' }))
    expect(screen.getByRole('menuitem', { name: /Model/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Reasoning effort/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Agent/ })).toBeInTheDocument()
  })

  it('model row delegates to the full model menu', () => {
    vi.useFakeTimers()
    try {
      const { props } = renderMenu()
      fireEvent.click(screen.getByRole('button', { name: 'Model / effort / agent menu' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
      vi.runAllTimers()
      expect(props.onOpenModelMenu).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drills into the effort pane and selects a variant', () => {
    const { props } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Model / effort / agent menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Reasoning effort/ }))
    const low = screen.getByRole('menuitemradio', { name: 'Low' })
    fireEvent.click(low)
    expect(props.onVariantChange).toHaveBeenCalledWith('low')
  })

  it('drills into the agent pane and selects an agent', () => {
    const { props } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Model / effort / agent menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Plan' }))
    expect(props.onAgentChange).toHaveBeenCalledWith('plan')
  })

  it('hides effort/agent rows when not applicable', () => {
    renderMenu({ variants: [], agents: [agents[0]] })
    fireEvent.click(screen.getByRole('button', { name: 'Model / effort / agent menu' }))
    expect(screen.queryByRole('menuitem', { name: /Reasoning effort/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Agent/ })).toBeNull()
  })

  it('reopening after trigger-close returns to the root pane', () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Model / effort / agent menu' })
    fireEvent.click(trigger)
    // 下钻到 Agent 面板
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Plan' })).toBeInTheDocument()
    // 直接点触发器关闭，再点开应回到根面板而不是停在 Agent 面板
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: /Model/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Reasoning effort/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio')).toBeNull()
  })

  it('tooltip omits the effort segment when the model has no variants', () => {
    renderMenu({ variants: [], selectedVariant: undefined })
    const trigger = screen.getByRole('button', { name: 'Model / effort / agent menu' })
    expect(trigger).toHaveAttribute('title', 'Kimi K3-256K · Build')
  })
})
