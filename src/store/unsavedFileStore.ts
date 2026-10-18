// ============================================
// 未保存文件的全局脏标记（需求三）
//
// 编辑中的文件是否有未保存改动需要被"关窗/离开"这类全局动作知道，
// 单靠组件内部状态无法问。这里只存一个 id 集合，由编辑中的预览登记。
// ============================================

const dirtyEditors = new Set<string>()

export function setFileEditorDirty(editorId: string, dirty: boolean): void {
  if (dirty) dirtyEditors.add(editorId)
  else dirtyEditors.delete(editorId)
}

export function hasUnsavedFileChanges(): boolean {
  return dirtyEditors.size > 0
}
