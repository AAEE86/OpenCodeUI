import { describe, expect, it } from 'vitest'
import { executeSubCallSummary, expandCodeModeSubCalls, parseCodeModeToolCalls } from './executeSubCallSummary'
import { extractToolData } from '../tools/registry'
import type { ToolViewPart } from '../tools/types'
import type { AssistantTool } from '../../../types/api/message'

describe('executeSubCallSummary', () => {
  it('returns undefined without toolCalls', () => {
    expect(executeSubCallSummary({})).toBeUndefined()
    expect(executeSubCallSummary({ toolCalls: [] })).toBeUndefined()
    expect(executeSubCallSummary({ toolCalls: 'nope' })).toBeUndefined()
  })

  it('joins sub-tool names in order', () => {
    expect(
      executeSubCallSummary({
        toolCalls: [
          { tool: 'read', status: 'completed' },
          { tool: 'write', status: 'completed' },
        ],
      }),
    ).toBe('read → write')
  })

  it('collapses consecutive same-name calls into ×n', () => {
    expect(
      executeSubCallSummary({
        toolCalls: [
          { tool: 'read', status: 'completed' },
          { tool: 'read', status: 'completed' },
          { tool: 'read', status: 'completed' },
          { tool: 'write', status: 'running' },
        ],
      }),
    ).toBe('read ×3 → write')
  })

  it('marks failed calls and does not merge across failure boundary', () => {
    expect(
      executeSubCallSummary({
        toolCalls: [
          { tool: 'bash', status: 'error' },
          { tool: 'bash', status: 'completed' },
        ],
      }),
    ).toBe('bash ✗ → bash')
  })

  it('skips malformed entries', () => {
    expect(
      executeSubCallSummary({
        toolCalls: [null, 'x', { status: 'completed' }, { tool: 'read', status: 'completed' }],
      }),
    ).toBe('read')
  })
})

describe('parseCodeModeToolCalls', () => {
  it('extracts dotted tool calls in order', () => {
    expect(
      parseCodeModeToolCalls(`
        const a = await tools.read({ path: "a.ts" })
        const b = await tools.write({ path: "b.ts", content: a })
        return b
      `),
    ).toBe('read → write')
  })

  it('supports namespaces and bracket notation', () => {
    expect(parseCodeModeToolCalls('await tools.fs.read({}); await tools.ns["tool-name"]({})')).toBe(
      'fs.read → ns.tool-name',
    )
  })

  it('collapses repeated calls', () => {
    expect(parseCodeModeToolCalls('await tools.read({}); await tools.read({}); await tools.read({})')).toBe('read ×3')
  })

  it('returns undefined when the code calls no tools', () => {
    expect(parseCodeModeToolCalls('return 1 + 1')).toBeUndefined()
    expect(parseCodeModeToolCalls('const tools2 = {}; await tools2.read({})')).toBeUndefined()
  })
})

describe('expandCodeModeSubCalls', () => {
  function executeTool(opts: { code?: string; toolCalls?: unknown }): AssistantTool {
    return {
      name: 'execute',
      state: {
        status: 'completed',
        input: opts.code !== undefined ? { code: opts.code } : {},
        content: [{ type: 'text', text: 'ok' }],
        metadata: opts.toolCalls !== undefined ? { toolCalls: opts.toolCalls } : {},
        time: { start: 0, end: 1 },
      },
    } as unknown as AssistantTool
  }

  it('returns null for non-execute tools', () => {
    expect(expandCodeModeSubCalls({ name: 'bash', state: {} } as unknown as AssistantTool)).toBeNull()
  })

  it('prefers runtime toolCalls with status', () => {
    expect(
      expandCodeModeSubCalls(
        executeTool({
          code: 'await tools.read({})',
          toolCalls: [
            { tool: 'read', status: 'completed' },
            { tool: 'write', status: 'error' },
          ],
        }),
      ),
    ).toEqual([
      { tool: 'read', status: 'completed' },
      { tool: 'write', status: 'error' },
    ])
  })

  it('falls back to statically parsing the code', () => {
    expect(expandCodeModeSubCalls(executeTool({ code: 'await tools.exa.web_search_exa({ q: "x" })' }))).toEqual([
      { tool: 'exa.web_search_exa' },
    ])
  })

  it('returns null when neither source has sub-calls', () => {
    expect(expandCodeModeSubCalls(executeTool({ code: 'return 1 + 1' }))).toBeNull()
    expect(expandCodeModeSubCalls(executeTool({}))).toBeNull()
  })
})

describe('executeExtractData (CodeMode)', () => {
  function executePart(code: string): ToolViewPart {
    return {
      id: 'p1',
      messageID: 'm1',
      name: 'execute',
      state: {
        status: 'completed',
        input: { code },
        content: [{ type: 'text', text: 'done' }],
        metadata: {},
        time: { start: 0, end: 1 },
      },
    } as unknown as ToolViewPart
  }

  it('shows the code body as javascript instead of a JSON dump', () => {
    const data = extractToolData(executePart('const x = await tools.read({ path: "a.ts" })'))
    expect(data.input).toBe('const x = await tools.read({ path: "a.ts" })')
    expect(data.inputLang).toBe('javascript')
  })
})
