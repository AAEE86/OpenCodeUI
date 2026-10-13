import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { usePersistedDraft, draftStorageKey, clearPersistedDraft, readPersistedDraft } from './usePersistedDraft'
import type { Attachment } from '../../attachment'

function renderDraft(initialKey: string | null) {
  return renderHook(
    ({ storageKey }: { storageKey: string | null }) => {
      const [text, setText] = useState('')
      const [attachments, setAttachments] = useState<Attachment[]>([])
      usePersistedDraft({ storageKey, text, attachments, setText, setAttachments })
      return { text, attachments, setText, setAttachments }
    },
    { initialProps: { storageKey: initialKey } },
  )
}

const KEY_A = draftStorageKey('local::ses-a', undefined)!
const KEY_B = draftStorageKey('local::ses-b', undefined)!

describe('usePersistedDraft（官方 composer persistence 同款）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('内容变化防抖落盘；空草稿删键', async () => {
    const { result } = renderDraft(KEY_A)
    act(() => {
      result.current.setText('草稿内容')
    })
    expect(localStorage.getItem(KEY_A)).toBeNull() // 防抖期内未写

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    // 防抖后写入
    expect(JSON.parse(localStorage.getItem(KEY_A) ?? '{}')).toMatchObject({ text: '草稿内容' })

    act(() => {
      result.current.setText('')
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    expect(localStorage.getItem(KEY_A)).toBeNull()
  })

  it('切会话清空输入框但不预填、不删草稿（↑ 时才召回）', async () => {
    localStorage.setItem(KEY_A, JSON.stringify({ text: 'A 的草稿', attachments: [] }))
    localStorage.setItem(KEY_B, JSON.stringify({ text: 'B 的草稿', attachments: [] }))

    const { result, rerender } = renderDraft(KEY_A)
    // 不预填：输入框保持空
    expect(result.current.text).toBe('')

    // 预填 A 的内容再切走，模拟「在 A 输入后切到 B」
    act(() => {
      result.current.setText('A 输入中')
    })
    rerender({ storageKey: KEY_B })
    // B 也不预填，输入框被清空
    expect(result.current.text).toBe('')

    // 程序性清空不删 B 的草稿
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    expect(readPersistedDraft(KEY_B)?.text).toBe('B 的草稿')
    expect(readPersistedDraft(KEY_A)?.text).toBe('A 的草稿')
  })

  it('切换后用户手动清空仍会删键（跳过标记只挡程序性清空一次）', async () => {
    const { result, rerender } = renderDraft(KEY_A)

    // 切到 B（B 无草稿），输入再清空
    rerender({ storageKey: KEY_B })
    act(() => {
      result.current.setText('临时输入')
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    expect(localStorage.getItem(KEY_B)).not.toBeNull()

    act(() => {
      result.current.setText('')
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    expect(localStorage.getItem(KEY_B)).toBeNull()
  })

  it('无 key（无目录且非会话页）不持久化', async () => {
    const { result } = renderDraft(null)
    act(() => {
      result.current.setText('不落盘')
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    expect(localStorage.length).toBe(0)
  })

  it('发送成功清键（clearPersistedDraft）', () => {
    localStorage.setItem(KEY_A, JSON.stringify({ text: 'x', attachments: [] }))
    clearPersistedDraft(KEY_A)
    expect(localStorage.getItem(KEY_A)).toBeNull()
  })

  it('工作区草稿 key 与命名空间', () => {
    expect(draftStorageKey(null, '/repo/proj')).toBe('srv:draft:workspace:/repo/proj')
    expect(draftStorageKey(undefined, undefined)).toBeNull()
    expect(draftStorageKey('local::ses-x', '/repo')).toBe('srv:draft:local::ses-x')
  })
})
