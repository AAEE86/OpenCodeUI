import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { ConfigSettings } from './ConfigSettings'

const api = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  getConfig: vi.fn(),
  // v2：config.providers() 被 model.list() / provider.list() 取代；写配置改走全局文档写入
  getActiveModels: vi.fn(),
  getProviders: vi.fn(),
  writeGlobalConfigDocument: vi.fn(),
  listAvailableShells: vi.fn(),
}))

vi.mock('../../../api', () => api)
vi.mock('../../../hooks', () => ({
  useCurrentDirectory: () => 'E:/workspace',
  useIsMobile: () => false,
}))

describe('ConfigSettings search', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.getGlobalConfig.mockResolvedValue({
      // v2 的配置顶层键是 providers（复数）
      providers: {
        openai: {
          name: 'Gateway OpenAI',
        },
      },
    })
    api.getConfig.mockResolvedValue({})
    api.getActiveModels.mockResolvedValue([])
    api.getProviders.mockResolvedValue([{ id: 'openai', name: 'OpenAI' }])
    api.writeGlobalConfigDocument.mockResolvedValue('/repo/opencode.jsonc')
    api.listAvailableShells.mockResolvedValue([])
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.scrollTo = vi.fn()
  })

  it('searches a raw JSON value and opens its nested field', async () => {
    render(<ConfigSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Config Editor' }))
    await screen.findByRole('dialog', { name: 'Config Editor' })

    const input = screen.getByRole('combobox', { name: 'Search config fields...' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Gateway OpenAI' } })
    const result = await screen.findByRole('option', { name: /providers\.openai\.name/ })
    fireEvent.click(result)

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Providers & Models' })).toHaveAttribute('aria-selected', 'true'))
    const field = await screen.findByDisplayValue('Gateway OpenAI')
    await waitFor(() => expect(field.closest('[data-config-field]')).toHaveClass('settings-search-highlight'))
    expect(field).toHaveFocus()
    // 单跑 0.5s 就过；但本文件要挂载完整 ConfigSettings + 配置编辑器弹窗（jsdom 冷启动最重的路径之一），
    // 全量并发下会超出 5s 默认值误报。给足时间，避免「新增任何测试文件就把它压崩」。
  }, 20000)
})
