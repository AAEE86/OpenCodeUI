import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { createEditableCodeMirrorExtensions, createReadonlyCodeMirrorExtensions } from './codeMirrorReadonlyExtensions'

// ============================================
// 扩展工厂（需求三 P2.0/P2.1）
//
// 只读与可编辑共用同一套基础扩展，差别只在：只读开关 / keymap / 手感扩展。
// 这里锁住三件容易回归的事：只读仍是只读、可编辑真的可编辑、Mod-s 能存。
// ============================================

const base = { wordWrap: false, lineHeight: 24, lineNumberWidth: 24 }

function facets(extensions: ReturnType<typeof createReadonlyCodeMirrorExtensions>) {
  const state = EditorState.create({ doc: 'hello', extensions })
  return {
    state,
    readOnly: state.facet(EditorState.readOnly),
    editable: state.facet(EditorView.editable),
    bindings: state.facet(keymap).flat(),
  }
}

describe('CodeMirror 扩展工厂', () => {
  it('只读模式：readOnly 恒真（原行为不变）', () => {
    const { readOnly } = facets(createReadonlyCodeMirrorExtensions({ ...base }))
    expect(readOnly).toBe(true)
  })

  it('可编辑模式：可写、可编辑，并带撤销栈的快捷键', () => {
    const { readOnly, editable, bindings } = facets(createEditableCodeMirrorExtensions({ ...base }))

    expect(readOnly).toBe(false)
    expect(editable).toBe(true)

    const keys = bindings.map(binding => binding.key)
    expect(keys).toContain('Mod-z') // historyKeymap
    expect(keys).toContain('Mod-y') // historyKeymap（重做）
    expect(keys).toContain('Mod-s')
  })

  it('可编辑模式：Mod-s 调 onSave 并吞掉浏览器保存对话框', () => {
    const onSave = vi.fn()
    const { bindings } = facets(createEditableCodeMirrorExtensions({ ...base, onSave }))

    const save = bindings.find(binding => binding.key === 'Mod-s')
    expect(save?.preventDefault).toBe(true)

    // run 返回 true 表示已处理（CodeMirror 据此 consume 事件）
    expect(save?.run?.({} as EditorView)).toBe(true)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('可编辑模式：搜索面板与高亮装饰仍在（两模式共用）', () => {
    const { bindings } = facets(createEditableCodeMirrorExtensions({ ...base }))
    const keys = bindings.map(binding => binding.key)
    // searchKeymap 的 Mod-f
    expect(keys).toContain('Mod-f')
  })
})
