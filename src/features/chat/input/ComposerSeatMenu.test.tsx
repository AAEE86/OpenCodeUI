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

  it('compact mode tightens the trigger so it cannot overlap the action buttons', () => {
    renderMenu({ compact: true })
    const trigger = screen.getByRole('button', { name: 'Model / effort / agent menu' })
    // 触发器自身可收缩、内容裁切
    expect(trigger.className).toContain('min-w-0')
    expect(trigger.className).toContain('max-w-full')
    expect(trigger.className).toContain('overflow-hidden')
    // 三段标签在紧凑模式下的上限都比常规模式窄（160/72 → 104/52）
    const labels = Array.from(trigger.querySelectorAll('span'))
    expect(labels.some(span => span.className.includes('max-w-[104px]'))).toBe(true)
    expect(labels.filter(span => span.className.includes('max-w-[52px]')).length).toBe(2)
    expect(labels.some(span => span.className.includes('max-w-[160px]'))).toBe(false)
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
