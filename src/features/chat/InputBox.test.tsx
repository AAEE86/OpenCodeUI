import { forwardRef, useImperativeHandle, type ForwardedRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBox } from './InputBox'
import type { Command } from '../../api/command'
import type { UserMessage } from '../../types/api/message'
import { promptHistoryStore } from '../../store/promptHistoryStore'

let slashCommands: Command[] = []
let messagesMock: UserMessage[] = []

vi.mock('../attachment', () => ({
  AttachmentPreview: () => null,
}))

vi.mock('./chatViewport', () => ({
  useChatViewport: () => ({
    presentation: { surfaceVariant: 'desktop', isCompact: false },
    interaction: {
      mode: 'pointer',
      touchCapable: false,
      sidebarBehavior: 'docked',
      rightPanelBehavior: 'docked',
      bottomPanelBehavior: 'docked',
      outlineInteraction: 'pointer',
      enableCollapsedInputDock: false,
    },
  }),
}))

vi.mock('../mention', () => ({
  MentionMenu: () => null,
  detectMentionTrigger: () => null,
  normalizePath: (value: string) => value,
  toFileUrl: (value: string) => value,
}))

vi.mock('../slash-command', () => ({
  SlashCommandMenu: forwardRef(
    (
      { isOpen, onSelect }: { isOpen: boolean; onSelect: (command: Command) => void },
      ref: ForwardedRef<{ moveUp: () => void; moveDown: () => void; selectCurrent: () => void }>,
    ) => {
      useImperativeHandle(
        ref,
        () => ({
          moveUp: () => {},
          moveDown: () => {},
          selectCurrent: () => {
            const command = slashCommands[0]
            if (command) onSelect(command)
          },
        }),
        [onSelect],
      )

      return isOpen ? (
        <div>
          {slashCommands.map(command => (
            <button key={command.name} type="button" onClick={() => onSelect(command)}>
              {command.name}
            </button>
          ))}
        </div>
      ) : null
    },
  ),
}))

vi.mock('./input/InputToolbar', () => ({
  InputToolbar: ({ onSend, canSend }: { onSend: () => void; canSend: boolean }) => (
    <button type="button" onClick={onSend} disabled={!canSend}>
      send
    </button>
  ),
}))

vi.mock('./input/InputFooter', () => ({
  InputFooter: () => null,
}))

vi.mock('./input/UndoStatus', () => ({
  UndoStatus: () => null,
}))

vi.mock('../../hooks', () => ({
  useIsMobile: () => false,
  usePresence: (show: boolean) => ({ shouldRender: show, ref: { current: null } }),
}))

vi.mock('../../store/messageStoreHooks', () => ({
  useMessages: () => messagesMock,
  useCurrentSessionId: () => null,
  useSessionPromptHistory: () => [],
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: {
    getKey: (action: string) => (action === 'sendMessage' ? 'Enter' : null),
  },
  matchesKeybinding: (event: KeyboardEvent, key: string) => key === 'Enter' && event.key === 'Enter',
}))

describe('InputBox slash command selection', () => {
  beforeEach(() => {
    slashCommands = []
    messagesMock = []
    promptHistoryStore.reset()
  })

  it('Android 全选删除后重建 textarea 节点', async () => {
    const userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      )

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    textarea.focus()
    fireEvent.input(textarea, { target: { value: 'hello' } })
    textarea.setSelectionRange(0, textarea.value.length)
    document.dispatchEvent(new Event('selectionchange'))

    fireEvent.input(textarea, { target: { value: '' } })

    await waitFor(() => {
      const next = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(next).not.toBe(textarea)
      expect(next.value).toBe('')
    })

    userAgent.mockRestore()
  })

  it('executes frontend commands immediately on selection', async () => {
    slashCommands = [{ name: 'compact', description: 'Compact session', source: 'frontend' }]
    const onCommand = vi.fn()

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'compact' }))

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith('/compact')
      expect(textarea.value).toBe('')
    })
  })

  it('keeps api commands on attachment insertion path', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    const onCommand = vi.fn()

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(onCommand).not.toHaveBeenCalled()
      expect(textarea.value).toBe('/review ')
    })
  })

  it('keeps the draft when sending fails', async () => {
    const onSend = vi.fn().mockResolvedValue(false)

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello world', [], { agent: undefined, variant: undefined })
    })

    // 官方同款失败恢复：输入框仍是空的，旧草稿被放回来
    await waitFor(() => {
      expect(textarea.value).toBe('hello world')
    })
  })

  it('clears the draft immediately on submit and sends in the background', async () => {
    let resolveSend: ((value: boolean) => void) | null = null
    const onSend = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveSend = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'pending send' } })
    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    // 官方 composer 时序：提交即清空，不等 POST RTT
    expect(textarea.value).toBe('')

    await act(async () => {
      resolveSend?.(true)
    })

    // 发送成功后草稿保持清空
    expect(textarea.value).toBe('')
  })

  it('does not clobber a newer draft when a background send fails', async () => {
    let resolveSend: ((value: boolean) => void) | null = null
    const onSend = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveSend = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'first message' } })
    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(textarea.value).toBe('')

    // 上一条还在后台发，用户已经开始打下一条
    fireEvent.change(textarea, { target: { value: 'next draft' } })

    // 上一条发送失败 → 不能覆盖正在打的新草稿
    await act(async () => {
      resolveSend?.(false)
    })

    expect(textarea.value).toBe('next draft')
  })

  it('clears api slash command drafts immediately after keyboard submission', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    let resolveCommand: ((value: boolean) => void) | null = null
    const onCommand = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveCommand = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(onCommand).toHaveBeenCalledWith('/review')
    expect(textarea.value).toBe('')
    expect(textarea).not.toBeDisabled()

    fireEvent.change(textarea, { target: { value: 'next prompt' } })
    expect(textarea.value).toBe('next prompt')

    await act(async () => {
      resolveCommand?.(true)
    })
  })

  it('restores api slash command drafts when command submission fails', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    let resolveCommand: ((value: boolean) => void) | null = null
    const onCommand = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveCommand = resolve
        }),
    )

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))
    expect(textarea.value).toBe('')

    await act(async () => {
      resolveCommand?.(false)
    })

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })
  })

  it('restores api slash command drafts when command submission fails synchronously', async () => {
    slashCommands = [{ name: 'review', description: 'Run review', source: 'api' }]
    const onCommand = vi.fn().mockReturnValue(false)

    render(<InputBox paneId="pane-test" onSend={vi.fn()} onCommand={onCommand} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'review' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/review ')
    })
  })

  it('does not send when Enter confirms IME composition', async () => {
    const onSend = vi.fn()

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '这是一个 test' } })

    fireEvent.compositionStart(textarea)
    fireEvent.compositionEnd(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('这是一个 test', [], { agent: undefined, variant: undefined })
    })
  })

  it('does not send keydown events marked as IME composition', () => {
    const onSend = vi.fn()

    render(<InputBox paneId="pane-test" onSend={onSend} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '正在输入' } })
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps navigating multiline history entries with ArrowUp', async () => {
    // 全局 prompt 历史（官方 composer/history 同款）：最新在前
    promptHistoryStore.add('first line\nsecond line', [], 'normal')
    promptHistoryStore.add('third line\nfourth line', [], 'normal')

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })

    await waitFor(() => {
      expect(textarea.value).toBe('third line\nfourth line')
      expect(textarea.selectionStart).toBe(0)
      expect(textarea.selectionEnd).toBe(0)
    })

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })

    await waitFor(() => {
      expect(textarea.value).toBe('first line\nsecond line')
      expect(textarea.selectionStart).toBe(0)
      expect(textarea.selectionEnd).toBe(0)
    })
  })

  it('moves the caret to the end when navigating forward with ArrowDown', async () => {
    promptHistoryStore.add('older line\nentry', [], 'normal')
    promptHistoryStore.add('newer line\nentry', [], 'normal')

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    await waitFor(() => {
      expect(textarea.value).toBe('newer line\nentry')
    })

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    await waitFor(() => {
      expect(textarea.value).toBe('older line\nentry')
      expect(textarea.selectionStart).toBe(0)
    })

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(textarea.value).toBe('newer line\nentry')
      expect(textarea.selectionStart).toBe('newer line\nentry'.length)
      expect(textarea.selectionEnd).toBe('newer line\nentry'.length)
    })
  })
})

describe('InputBox shell mode', () => {
  beforeEach(() => {
    slashCommands = []
    messagesMock = []
    promptHistoryStore.reset()
  })

  it('enters shell mode when typing ! into an empty input', () => {
    render(<InputBox paneId="pane-test" onSend={vi.fn()} onShell={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '!' } })

    expect(textarea.hasAttribute('data-shell-mode')).toBe(true)
    // `!` 被消费，不进文本
    expect(textarea.value).toBe('')
  })

  it('restores the consumed ! when exiting shell mode with backspace on empty input', async () => {
    render(<InputBox paneId="pane-test" onSend={vi.fn()} onShell={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '!' } })
    expect(textarea.hasAttribute('data-shell-mode')).toBe(true)

    // 「其实想输入 !」的退路：空命令退格 → 退模式并把 ! 还回来
    fireEvent.keyDown(textarea, { key: 'Backspace' })

    expect(textarea.hasAttribute('data-shell-mode')).toBe(false)
    expect(textarea.value).toBe('!')

    // 光标在末尾，好继续打（如 !这个很重要）
    await waitFor(() => {
      expect(textarea.selectionStart).toBe(1)
    })

    // 继续输入就是普通文本
    fireEvent.change(textarea, { target: { value: '!这个很重要' } })
    expect(textarea.hasAttribute('data-shell-mode')).toBe(false)
    expect(textarea.value).toBe('!这个很重要')
  })

  it('does not re-enter shell mode when deleting back to a lone !', () => {
    render(<InputBox paneId="pane-test" onSend={vi.fn()} onShell={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // 经退格还原拿到字面 ! 后，继续编辑再删回 ! 不该重新进 shell 模式
    fireEvent.change(textarea, { target: { value: '!x' } })
    expect(textarea.hasAttribute('data-shell-mode')).toBe(false)

    fireEvent.change(textarea, { target: { value: '!' } })
    expect(textarea.hasAttribute('data-shell-mode')).toBe(false)
    expect(textarea.value).toBe('!')
  })

  it('exits shell mode with escape and discards the input', () => {
    render(<InputBox paneId="pane-test" onSend={vi.fn()} onShell={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '!' } })
    fireEvent.change(textarea, { target: { value: 'git status' } })
    expect(textarea.hasAttribute('data-shell-mode')).toBe(true)

    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(textarea.hasAttribute('data-shell-mode')).toBe(false)
    expect(textarea.value).toBe('')
  })

  it('does not enter shell mode without onShell support', () => {
    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '!' } })

    expect(textarea.hasAttribute('data-shell-mode')).toBe(false)
    expect(textarea.value).toBe('!')
  })
})
