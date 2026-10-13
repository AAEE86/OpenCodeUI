import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInputHistory } from './useInputHistory'
import { promptHistoryStore } from '../../../store/promptHistoryStore'
import type { Attachment } from '../../attachment'

interface DraftEntry {
  text: string
  attachments: Attachment[]
}

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

function setup(opts: { draft?: DraftEntry | null; history?: string[] } = {}) {
  localStorage.clear()
  promptHistoryStore.reset()
  // add 前插（最新在前），按时间顺序添加即可
  for (const text of opts.history ?? []) {
    promptHistoryStore.add(text, [], 'normal')
  }

  const textarea = document.createElement('textarea')
  const textareaRef = { current: textarea }
  const { result } = renderHook(() =>
    useInputHistory({
      textareaRef,
      mode: 'normal',
      recallDraft: () => opts.draft ?? null,
    }),
  )
  return { textarea, result }
}

describe('useInputHistory 草稿召回', () => {
  beforeEach(() => {
    localStorage.clear()
    promptHistoryStore.reset()
  })

  it('空输入按 ↑ 召回持久化草稿（即使已发送历史为空）', () => {
    const { textarea, result } = setup({ draft: { text: '未发送的草稿', attachments: [] } })
    textarea.value = ''
    textarea.setSelectionRange(0, 0)

    const recalled = result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '', [])
    expect(recalled).toEqual({ text: '未发送的草稿', attachments: [], cursor: 'end' })
  })

  it('草稿之上再按 ↑ 进入已发送历史，↓ 到底回到草稿', () => {
    const { textarea, result } = setup({
      draft: { text: '草稿行', attachments: [] },
      history: ['更早的消息', '最新消息'],
    })

    // 第一次 ↑：召回草稿
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    const draft = result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '', [])
    expect(draft?.text).toBe('草稿行')

    // 第二次 ↑（草稿未修改，光标在末尾）：进入历史最新一条
    textarea.value = '草稿行'
    textarea.setSelectionRange(5, 5)
    const latest = result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '草稿行', [])
    expect(latest?.text).toBe('最新消息')

    // ↓ 越过最新一条：回到草稿行
    textarea.value = '最新消息'
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    const back = result.current.handleHistoryKeyDown(keyEvent('ArrowDown'), '最新消息', [])
    expect(back).toEqual({ text: '草稿行', attachments: [], cursor: 'end' })
  })

  it('草稿被修改后按 ↑ 不进入历史', () => {
    const { textarea, result } = setup({
      draft: { text: '草稿行', attachments: [] },
      history: ['历史消息'],
    })
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '', [])

    // 用户改了草稿内容
    result.current.handleHistoryChange('草稿行改过了')
    textarea.value = '草稿行改过了'
    textarea.setSelectionRange(0, 0)
    const next = result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '草稿行改过了', [])
    expect(next).toBeNull()
  })

  it('没有草稿时 ↑ 直接进入已发送历史', () => {
    const { textarea, result } = setup({ draft: null, history: ['历史消息'] })
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    const recalled = result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '', [])
    expect(recalled?.text).toBe('历史消息')
  })

  it('resetHistoryIndex 后空输入 ↑ 重新召回草稿', () => {
    const { textarea, result } = setup({ draft: { text: '草稿行', attachments: [] } })
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '', [])

    result.current.resetHistoryIndex()
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    const again = result.current.handleHistoryKeyDown(keyEvent('ArrowUp'), '', [])
    expect(again?.text).toBe('草稿行')
  })
})
