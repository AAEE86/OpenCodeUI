import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { createReadonlyCodeMirrorExtensions } from './codeMirrorReadonlyExtensions'

// ============================================
// 扩展工厂（需求三）
//
// 只读与可编辑共用一套扩展，差别只有 readOnly 开关与随之而来的撤销栈。
// 这里锁住三件容易回归的事：默认仍是只读、readOnly=false 真的可编辑且有撤销、
// 搜索面板两模式都在。
// ============================================

const base = { wordWrap: false, lineHeight: 24, lineNumberWidth: 24 }

function facets(extensions: ReturnType<typeof createReadonlyCodeMirrorExtensions>) {
  const state = EditorState.create({ doc: 'hello', extensions })
  return {
    readOnly: state.facet(EditorState.readOnly),
    editable: state.facet(EditorView.editable),
    bindings: state.facet(keymap).flat(),
  }
}

describe('CodeMirror 扩展工厂', () => {
  it('默认只读：readOnly 恒真（原行为不变）', () => {
    const { readOnly } = facets(createReadonlyCodeMirrorExtensions({ ...base }))
    expect(readOnly).toBe(true)
  })

  it('readOnly=false：可写、可编辑，并带撤销栈快捷键', () => {
    const { readOnly, editable, bindings } = facets(createReadonlyCodeMirrorExtensions({ ...base, readOnly: false }))

    expect(readOnly).toBe(false)
    expect(editable).toBe(true)

    const keys = bindings.map(binding => binding.key)
    expect(keys).toContain('Mod-z')
    expect(keys).toContain('Mod-y')
  })

  it('两模式都有搜索面板（Mod-f）', () => {
    const readonlyKeys = facets(createReadonlyCodeMirrorExtensions({ ...base })).bindings.map(b => b.key)
    const editableKeys = facets(createReadonlyCodeMirrorExtensions({ ...base, readOnly: false })).bindings.map(b => b.key)

    expect(readonlyKeys).toContain('Mod-f')
    expect(editableKeys).toContain('Mod-f')
  })
})
