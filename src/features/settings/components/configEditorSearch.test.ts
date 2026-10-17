import { describe, expect, it } from 'vitest'
import { filterSettingsSearchItems } from '../settingsSearchCatalog'
import { buildConfigEditorSearchItems, navigationForConfigSegments, sectionForConfigSegments } from './configEditorSearch'

describe('config editor search', () => {
  it('indexes raw JSON paths and non-sensitive values', () => {
    const items = buildConfigEditorSearchItems({
      // v2 的 provider 连接配置放在 settings 里
      providers: {
        'openai.custom': {
          settings: {
            baseURL: 'https://gateway.example.com',
          },
          headers: {
            Cookie: 'session-cookie-value',
            'X-Auth': 'private-header-value',
          },
          models: {
            'gpt.4': { disabled: false },
          },
        },
      },
      // 敏感键名即使是未知顶层字段，也不索引其值
      apiKey: 'top-secret-value',
    }, 'en')

    expect(items.some(item => item.label.startsWith('providers["openai.custom"].settings'))).toBe(true)
    expect(filterSettingsSearchItems(items, 'gateway.example.com')).toHaveLength(1)
    expect(filterSettingsSearchItems(items, 'top-secret-value')).toHaveLength(0)
    expect(filterSettingsSearchItems(items, 'session-cookie-value')).toHaveLength(0)
    expect(filterSettingsSearchItems(items, 'private-header-value')).toHaveLength(0)
    expect(items.find(item => item.label === 'apiKey')?.description).toBe('[sensitive value hidden]')
  })

  it('keeps dotted dynamic ids intact when restoring drill paths', () => {
    expect(navigationForConfigSegments(['providers', 'openai.custom', 'models', 'gpt.4', 'disabled'])).toEqual({
      section: 'providers',
      stack: [
        { id: 'provider:openai.custom', title: 'openai.custom' },
        { id: 'models', title: 'models' },
        { id: 'model:gpt.4', title: 'gpt.4' },
      ],
      fieldKey: 'disabled',
    })
  })

  it('maps agent permission drills and unknown JSON fields to reachable sections', () => {
    expect(navigationForConfigSegments(['agents', 'build', 'permissions'])).toEqual({
      section: 'agents',
      stack: [
        { id: 'agent:build', title: 'build' },
        { id: 'permissions', title: 'permissions' },
      ],
      fieldKey: 'permissions',
    })
    expect(sectionForConfigSegments(['future_option'])).toBe('advanced')
  })

  it('maps plugin entries and disabled-only LSP entries to rendered controls', () => {
    expect(navigationForConfigSegments(['plugins', '0'])).toEqual({
      section: 'plugins',
      stack: [{ id: 'plugin:0', title: 'plugin' }],
      fieldKey: 'package',
    })
    expect(navigationForConfigSegments(['plugins', '0', 'options', 'custom'])).toEqual({
      section: 'plugins',
      stack: [{ id: 'plugin:0', title: 'plugin' }, { id: 'options', title: 'options' }],
      fieldKey: 'options',
    })

    const items = buildConfigEditorSearchItems({ lsp: { eslint: { disabled: true } } }, 'en')
    expect(items.find(item => item.label === 'lsp.eslint.disabled')?.fieldKey).toBe('mode')
  })

  it('maps media and scalar reference values to their local field keys', () => {
    expect(navigationForConfigSegments(['media', 'image', 'max_width']).fieldKey).toBe('max_width')
    const items = buildConfigEditorSearchItems({ references: { docs: 'https://example.com/docs' } }, 'en')
    expect(items.find(item => item.label === 'references.docs')?.fieldKey).toBe('value')
  })

  it('matches complete long and deeply nested raw JSON values', () => {
    const longValue = `${'x'.repeat(200)}-searchable-suffix`
    const config: Record<string, unknown> = {}
    let cursor = config
    for (let depth = 0; depth < 16; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor[`level${depth}`] = next
      cursor = next
    }
    cursor.value = longValue

    const items = buildConfigEditorSearchItems(config, 'en')
    expect(filterSettingsSearchItems(items, 'searchable-suffix')).toHaveLength(1)
  })

  it('always includes all config sections in search results', () => {
    const items = buildConfigEditorSearchItems({}, 'zh-CN')
    const sections = items.filter(item => item.source === 'section')
    expect(sections).toHaveLength(14)
    expect(sections.some(item => item.label === '渠道与模型')).toBe(true)
    expect(items.some(item => item.label === 'update' && item.source === 'field')).toBe(true)
  })
})
