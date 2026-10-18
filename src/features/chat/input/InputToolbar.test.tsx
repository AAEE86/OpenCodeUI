import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiAgent } from '../../../api/client'
import { InputToolbar } from './InputToolbar'

const useIsMobileMock = vi.fn()
const isTauriMock = vi.fn()
const isTauriMobileMock = vi.fn()
const openMock = vi.fn()
const readFileMock = vi.fn()
const agents: ApiAgent[] = [
  { id: 'build', name: 'Build', description: 'Build things', mode: 'primary', permissions: [], request: { settings: {}, headers: {}, body: {} }, hidden: false },
  { id: 'plan', name: 'Plan', description: 'Plan work', mode: 'primary', permissions: [], request: { settings: {}, headers: {}, body: {} }, hidden: false },
]

vi.mock('../../../hooks', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

vi.mock('../chatViewport', () => ({
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

vi.mock('../../../utils/tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
  extToMime: (ext: string) => {
    if (ext === 'png') return 'image/png'
    return 'application/octet-stream'
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openMock(...args),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}))

vi.mock('../../../components/ui', () => ({
  DropdownMenu: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
  MenuItem: ({
    label,
    onClick,
    selectionRole,
    selected,
  }: {
    label: string
    onClick: () => void
    selectionRole?: 'menuitemradio' | 'option'
    selected?: boolean
  }) => {
    const selectionProps =
      selectionRole === 'menuitemradio'
        ? { role: selectionRole, 'aria-checked': selected, tabIndex: selected ? 0 : -1 }
        : selectionRole === 'option'
          ? { role: selectionRole, 'aria-selected': selected, tabIndex: selected ? 0 : -1 }
          : {}

    return (
      <button type="button" onClick={onClick} {...selectionProps}>
        {label}
      </button>
    )
  },
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AnimatedPresence: ({ show, children }: { show: boolean; children: React.ReactNode }) =>
    show ? <>{children}</> : null,
}))

vi.mock('../ModelSelector', () => ({
  ModelSelector: () => null,
}))

describe('InputToolbar file selection', () => {
  beforeEach(() => {
    useIsMobileMock.mockReturnValue(false)
    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    openMock.mockReset()
    readFileMock.mockReset()
  })

  it('always offers the attach control and does not filter the file input by accept', () => {
    // Issue #182：白名单外的文件会走服务端上传，所以附件入口不再受模型能力控制，
    // 文件选择器也不能按 accept 过滤，否则用户根本选不到 zip/docx。
    const { container } = render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        onFilesSelected={vi.fn()}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Attach file' })).toBeTruthy()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.hasAttribute('accept')).toBe(false)
  })

  it('uses the browser file input on Tauri mobile', () => {
    useIsMobileMock.mockReturnValue(true)
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(true)

    const onFilesSelected = vi.fn()
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const { container } = render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
        onFilesSelected={onFilesSelected}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    expect(inputClickSpy).toHaveBeenCalledTimes(1)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(onFilesSelected).toHaveBeenCalledWith([file])
    inputClickSpy.mockRestore()
  })

  it('uses the Tauri native picker on desktop', async () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    openMock.mockResolvedValue(['/tmp/photo.png'])
    readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]))

    const onFilesSelected = vi.fn()

    render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
        onFilesSelected={onFilesSelected}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1)
      expect(readFileMock).toHaveBeenCalledWith('/tmp/photo.png')
      expect(onFilesSelected).toHaveBeenCalledTimes(1)
    })

    const [files] = onFilesSelected.mock.calls[0] as [File[]]
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('photo.png')
    expect(files[0].type).toBe('image/png')
  })

  it('hands native paths to onPickedPaths instead of reading bytes', async () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    openMock.mockResolvedValue(['C:\\dl\\piui-source.zip', 'C:\\dl\\notes.txt'])

    // Issue #182：桌面端选择器与拖入共用一条判定链（本机 → @ 引用 / 远端 → 上传），
    // 所以要把路径原样交上去；读字节拼 File 会丢掉路径
    const onPickedPaths = vi.fn()
    const onFilesSelected = vi.fn()

    render(
      <InputToolbar
        agents={[]}
        onFilesSelected={onFilesSelected}
        onPickedPaths={onPickedPaths}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))

    await waitFor(() => {
      expect(onPickedPaths).toHaveBeenCalledWith(['C:\\dl\\piui-source.zip', 'C:\\dl\\notes.txt'])
    })
    expect(readFileMock).not.toHaveBeenCalled()
    expect(onFilesSelected).not.toHaveBeenCalled()
  })

  it('moves focus into the opened agent menu and exposes menu semantics', async () => {
    render(
      <InputToolbar
        agents={agents}
        selectedAgent="build"
        onAgentChange={vi.fn()}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        onFilesSelected={vi.fn()}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    const trigger = screen.getByTitle('Build: Build things')

    fireEvent.click(trigger)

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('menuitemradio', { name: 'Build' })).toHaveFocus()
    })
  })

  it('closes the agent menu on Tab and moves focus to the next toolbar control', async () => {
    render(
      <InputToolbar
        agents={agents}
        selectedAgent="build"
        onAgentChange={vi.fn()}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        canSend={true}
        onFilesSelected={vi.fn()}
        onSend={vi.fn()}
      />,
    )

    const trigger = screen.getByTitle('Build: Build things')
    fireEvent.click(trigger)

    const selectedItem = await screen.findByRole('menuitemradio', { name: 'Build' })
    fireEvent.keyDown(selectedItem, { key: 'Tab' })

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      // 下一个可聚焦控件是附件按钮（它现在恒常渲染，Issue #182）
      expect(screen.getByRole('button', { name: 'Attach file' })).toHaveFocus()
    })
  })

  it('returns focus to the composer after selecting an agent', async () => {
    function ToolbarHarness() {
      const containerRef = useRef<HTMLDivElement>(null)

      return (
        <div ref={containerRef}>
          <textarea aria-label="Chat input" />
          <InputToolbar
            agents={agents}
            selectedAgent="build"
            onAgentChange={vi.fn()}
            fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
            onFilesSelected={vi.fn()}
            canSend={false}
            onSend={vi.fn()}
            inputContainerRef={containerRef}
          />
        </div>
      )
    }

    render(<ToolbarHarness />)

    fireEvent.click(screen.getByTitle('Build: Build things'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Plan' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat input' })).toHaveFocus())
  })
})
