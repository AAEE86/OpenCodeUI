import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

function isAndroidWebView(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

interface UseAndroidImeSafeTextareaOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  /** 全选删除清空后，把上层受控值同步为空 */
  onCleared: () => void
}

/**
 * Android WebView 的 IME 兜底。
 *
 * 搜狗等输入法“全选 → 删除”会走 deleteSurroundingText 一类连接调用：
 * 删除后 DOM、焦点、系统 InputConnection 都还在，但 WebView 的编辑节点
 * 已经失效，commitText 全部被丢弃。blur/focus、readOnly 切换都救不回来，
 * 同页新建的 textarea 却正常。
 *
 * 因此检测到“全选后清空”时，用 key 强制重建 textarea，并接回焦点。
 * 正常输入、逐字退格不会触发。
 */
export function useAndroidImeSafeTextarea({
  textareaRef,
  onCleared,
}: UseAndroidImeSafeTextareaOptions): { imeResetKey: number } {
  const selectAllRef = useRef(false)
  const rebuildingRef = useRef(false)
  const [imeResetKey, setImeResetKey] = useState(0)

  const rebuild = useCallback(() => {
    if (rebuildingRef.current) return
    rebuildingRef.current = true
    onCleared()
    setImeResetKey(key => key + 1)
    window.setTimeout(() => {
      rebuildingRef.current = false
    }, 300)
  }, [onCleared])

  useEffect(() => {
    if (!isAndroidWebView()) return
    const textarea = textareaRef.current
    if (!textarea) return

    const rememberSelectAll = () => {
      selectAllRef.current =
        textarea.value.length > 0 &&
        textarea.selectionStart === 0 &&
        textarea.selectionEnd === textarea.value.length
    }
    const onSelectionChange = () => {
      if (document.activeElement === textarea) rememberSelectAll()
    }
    const onInput = () => {
      if (textarea.value !== '' || !selectAllRef.current) return
      selectAllRef.current = false
      rebuild()
    }

    textarea.addEventListener('select', rememberSelectAll)
    textarea.addEventListener('selectstart', rememberSelectAll)
    textarea.addEventListener('input', onInput)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      textarea.removeEventListener('select', rememberSelectAll)
      textarea.removeEventListener('selectstart', rememberSelectAll)
      textarea.removeEventListener('input', onInput)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [imeResetKey, rebuild, textareaRef])

  useLayoutEffect(() => {
    if (imeResetKey === 0) return
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(0, 0)
  }, [imeResetKey, textareaRef])

  return { imeResetKey }
}
