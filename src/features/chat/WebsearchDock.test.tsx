import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebsearchDock } from './WebsearchDock'
import type { ApiFormInfo } from '../../api'

// ============================================
// 网页搜索 dock（Issue #182 之外的 #? 无关，属于请求区）
//
// 它必须和权限/提问两个 dock 是同一套设计：同款卡片、同款收起（收起后由
// FloatingActions 显示胶囊）、同款全宽动作行 + Enter/Esc。
// 之前它自己是一层 absolute z-[9] 的浮层，比输入框还低 → 和输入框重合。
// ============================================

vi.mock('./chatViewport', () => ({
  useChatViewport: () => ({ presentation: { surfaceVariant: 'desktop', isCompact: false } }),
}))

// jsdom 没有 Web Animations API；其它输入框相关测试也是这么处理 usePresence 的
vi.mock('../../hooks', () => ({
  usePresence: (show: boolean) => ({ shouldRender: show, ref: { current: null } }),
}))

const getWebsearchProvidersMock = vi.fn(async () => [
  { value: 'exa', label: 'Exa' },
  { value: 'brave', label: 'Brave' },
])

vi.mock('../../api/client', () => ({
  getWebsearchProviders: (...args: unknown[]) => getWebsearchProvidersMock(...(args as [])),
}))

function form(overrides: Partial<ApiFormInfo> = {}): ApiFormInfo {
  return {
    id: 'form-1',
    sessionID: 'session-1',
    title: '第三方网页搜索',
    metadata: { kind: 'websearch.provider' },
    fields: [],
    ...overrides,
  } as ApiFormInfo
}

describe('WebsearchDock', () => {
  beforeEach(() => {
    getWebsearchProvidersMock.mockClear()
  })

  it('与权限/提问同款：卡片 + 收起按钮，点击收起交给上层', async () => {
    const onCollapsedChange = vi.fn()
    render(<WebsearchDock form={form()} onReply={vi.fn()} onCollapsedChange={onCollapsedChange} />)

    expect(screen.getByText('Third-party web search')).toBeTruthy()
    // 搜索源列表加载完成（触发器上出现当前值）
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search provider' })).toHaveTextContent('Any')
    })
    // 打开菜单能看到列表
    fireEvent.click(screen.getByRole('button', { name: 'Search provider' }))
    expect(screen.getByRole('menuitemradio', { name: /Exa/ })).toBeTruthy()

    // 收起按钮存在（title 与权限/提问同款「最小化」）
    const minimize = screen.getByTitle('Minimize')
    fireEvent.click(minimize)
    expect(onCollapsedChange).toHaveBeenCalledWith(true)
  })

  it('collapsed 时不渲染卡片（收起态由 FloatingActions 的胶囊接管）', () => {
    const { container } = render(<WebsearchDock form={form()} onReply={vi.fn()} collapsed />)
    expect(container.querySelector('[data-component="session-websearch-dock"]')).toBeNull()
  })

  it('搜索源用项目统一的 DropdownMenu + MenuItem（不是原生 select）', async () => {
    const { container } = render(<WebsearchDock form={form()} onReply={vi.fn()} />)

    // 不允许出现原生下拉
    expect(container.querySelector('select')).toBeNull()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search provider' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search provider' }))

    // 菜单是 role=menu + menuitemradio（与输入框 Build/High 同款）
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /Exa/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /Brave/ })).toBeTruthy()
  })

  it('展开时箭头翻转（ComposerSeatMenu / ModelSelector 同款细节）', async () => {
    render(<WebsearchDock form={form()} onReply={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search provider' })).toBeTruthy()
    })

    const chevron = screen.getByTestId('websearch-provider-chevron')
    expect(chevron.className).not.toContain('rotate-180')

    fireEvent.click(screen.getByRole('button', { name: 'Search provider' }))
    expect(screen.getByTestId('websearch-provider-chevron').className).toContain('rotate-180')

    // 关闭后转回来
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByTestId('websearch-provider-chevron').className).not.toContain('rotate-180')
    })
  })

  it('选「任意」启用 → 回 {choice: allow}', async () => {
    const onReply = vi.fn(async () => true)
    render(<WebsearchDock form={form()} onReply={onReply} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search provider' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Enable/ }))

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith(expect.anything(), { choice: 'allow' })
    })
  })

  it('选「不使用搜索」→ 回 {choice: disable}', async () => {
    const onReply = vi.fn(async () => true)
    render(<WebsearchDock form={form()} onReply={onReply} />)

    fireEvent.click(screen.getByRole('button', { name: /use search/ }))

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith(expect.anything(), { choice: 'disable' })
    })
  })

  it('选具体搜索源 → 两段式：先 {choice: choose}', async () => {
    const onReply = vi.fn(async () => true)
    render(<WebsearchDock form={form()} onReply={onReply} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search provider' })).toBeTruthy()
    })
    // 项目统一的选择器：触发器 → DropdownMenu → MenuItem
    fireEvent.click(screen.getByRole('button', { name: 'Search provider' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Exa/ }))
    fireEvent.click(screen.getByRole('button', { name: /Enable/ }))

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith(expect.anything(), { choice: 'choose' })
    })
  })

  it('specific 表单（带 provider 字段）→ 直接回 {provider}', async () => {
    const onReply = vi.fn(async () => true)
    const specific = form({
      fields: [
        {
          type: 'string',
          key: 'provider',
          options: [{ value: 'brave', label: 'Brave' }],
        },
      ],
    } as Partial<ApiFormInfo>)

    render(<WebsearchDock form={specific} onReply={onReply} />)

    fireEvent.click(screen.getByRole('button', { name: /Enable/ }))

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith(expect.anything(), { provider: 'brave' })
    })
    // specific 形态没有「不使用搜索」（官方同款）
    expect(screen.queryByRole('button', { name: /use search/ })).toBeNull()
  })

  it('Escape = 不使用搜索（与权限/提问的 Esc 行为一致）', async () => {
    const onReply = vi.fn(async () => true)
    const { container } = render(<WebsearchDock form={form()} onReply={onReply} />)

    const root = container.firstElementChild as HTMLElement
    fireEvent.keyDown(root, { key: 'Escape' })

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith(expect.anything(), { choice: 'disable' })
    })
  })

  it('回复失败时在卡片里可见提示（不静默）', async () => {
    const onReply = vi.fn(async () => false)
    render(<WebsearchDock form={form()} onReply={onReply} />)

    fireEvent.click(screen.getByRole('button', { name: /use search/ }))

    await waitFor(() => {
      expect(screen.getByText(/Could not save your choice/)).toBeTruthy()
    })
  })
})
