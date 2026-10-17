import { describe, expect, it } from 'vitest'
import type { Config } from '../../../types/api/config'
import { validateConfig, validationDrillTargetForError } from './configEditorValidation'

describe('config editor validation', () => {
  it('rejects a model selection that is not provider/model', () => {
    const errors = validateConfig({ model: 'no-slash' } as unknown as Config, 'en')

    expect(errors).toContainEqual(expect.objectContaining({
      path: 'model',
      segments: ['model'],
    }))
  })

  it('allows a custom LSP without extensions when command is configured', () => {
    const config = { lsp: { custom: { command: ['custom-lsp'] } } } as unknown as Config

    expect(validateConfig(config, 'en')).toEqual([])
  })

  it('uses structured segments for ids containing dots', () => {
    const errors = validateConfig({ commands: { 'release.prod': {} } } as unknown as Config, 'en')
    const target = validationDrillTargetForError(errors[0])

    expect(errors[0].segments).toEqual(['commands', 'release.prod', 'template'])
    expect(target.stack[0]).toEqual({ id: 'command:release.prod', title: 'release.prod' })
  })

  it('routes unknown official schema fields to Advanced', () => {
    const target = validationDrillTargetForError({ path: 'future_option', segments: ['future_option'], message: 'unknown field' })

    expect(target.section).toBe('advanced')
  })

  it('keeps dotted provider ids intact in local validation errors', () => {
    const errors = validateConfig({ providers: { 'acme.prod': { settings: { timeout: 0 } } } } as unknown as Config, 'en')
    const target = validationDrillTargetForError(errors[0])

    expect(errors[0].segments).toEqual(['providers', 'acme.prod', 'settings', 'timeout'])
    expect(target.stack[0]).toEqual({ id: 'provider:acme.prod', title: 'acme.prod' })
  })

  it('requires an MCP server type and its transport field', () => {
    const errors = validateConfig({ mcp: { servers: { s: {} } } } as unknown as Config, 'en')

    expect(errors.map(error => error.path)).toContain('mcp.servers.s.type')
  })
})
