import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBox } from './InputBox'

let selectedFiles: File[] = []

const uploadAttachmentMock = vi.fn()
const createUploadIdMock = vi.fn(() => `upload-${uploadAttachmentMock.mock.calls.length}`)
const notifyPushMock = vi.fn()

vi.mock('../../api/file', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
  createUploadId: () => createUploadIdMock(),
}))

vi.mock('../../store/notificationStore', () => ({
  notificationStore: {
    push: (...args: unknown[]) => notifyPushMock(...args),
  },
}))

vi.mock('../attachment', () => ({
  AttachmentPreview: ({
    attachments,
    onRetry,
  }: {
    attachments: Array<{ id: string; url?: string; uploadStatus?: string }>
    onRetry?: (id: string) => void
  }) => (
    <div data-testid="attachment-count">
      {attachments.length}
      {attachments.map(attachment => (
        <span key={attachment.id} data-testid="attachment-meta">
          {`${attachment.url ?? ''}|${attachment.uploadStatus ?? ''}`}
        </span>
      ))}
      {attachments
        .filter(attachment => attachment.uploadStatus === 'failed')
        .map(attachment => (
          <button key={`retry-${attachment.id}`} type="button" onClick={() => onRetry?.(attachment.id)}>
            retry upload
          </button>
        ))}
    </div>
  ),
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
  toFileUrl: (value: string) => `file://${value}`,
}))

vi.mock('../slash-command', () => ({
  SlashCommandMenu: () => null,
}))

vi.mock('./input/InputToolbar', () => ({
  InputToolbar: ({ onFilesSelected }: { onFilesSelected: (files: File[]) => void }) => (
    <button type="button" onClick={() => onFilesSelected(selectedFiles)}>
      attach file
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
  useMessages: () => [],
  useCurrentSessionId: () => null,
  useSessionPromptHistory: () => [],
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: {
    getKey: () => null,
  },
  matchesKeybinding: () => false,
}))

describe('InputBox attachment handling', () => {
  beforeEach(() => {
    selectedFiles = []
    uploadAttachmentMock.mockReset()
    createUploadIdMock.mockClear()
    notifyPushMock.mockReset()
  })

  it('accepts files whose mime is inferred from the filename extension', async () => {
    selectedFiles = [new File(['image'], 'photo.png')]

    render(
      <InputBox
        paneId="pane-test"
        onSend={vi.fn()}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-count')).toHaveTextContent('1')
    })
  })

  // ==========================================
  // Issue #182：白名单外的文件不再被静默丢弃
  // ==========================================

  it('白名单外文件上传到服务端并成为路径附件（模型无任何原生能力时也成立）', async () => {
    uploadAttachmentMock.mockResolvedValue({ path: '/srv/tmp/uploads/u1/report.zip', size: 3 })
    selectedFiles = [new File([new Uint8Array([1, 2, 3])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
    })

    // 上传的是原始 File，文件名原样传递
    expect(uploadAttachmentMock.mock.calls[0][1]).toBe('report.zip')

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent(
        'file:///srv/tmp/uploads/u1/report.zip|',
      )
    })
    expect(notifyPushMock).not.toHaveBeenCalled()
  })

  it('上传失败时保留失败态并弹出可见错误（不静默吞掉）', async () => {
    uploadAttachmentMock.mockRejectedValue(new Error('Failed to fetch'))
    selectedFiles = [new File([new Uint8Array([1])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(notifyPushMock).toHaveBeenCalledTimes(1)
    })

    const [type, title, body] = notifyPushMock.mock.calls[0] as [string, string, string]
    expect(type).toBe('error')
    expect(title).toMatch(/report\.zip/)
    expect(body).toMatch(/report\.zip/)

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('|failed')
    })
  })

  it('失败后可重试：重试成功则替换为路径附件', async () => {
    uploadAttachmentMock.mockRejectedValueOnce(new Error('Failed to fetch'))
    uploadAttachmentMock.mockResolvedValueOnce({ path: '/srv/tmp/uploads/u2/report.zip', size: 1 })
    selectedFiles = [new File([new Uint8Array([1])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('|failed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'retry upload' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent(
        'file:///srv/tmp/uploads/u2/report.zip|',
      )
    })
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(2)
  })

  it('超过上传上限的文件直接拒绝并提示，不做上传', async () => {
    // 构造一个「体积超过 MAX_UPLOAD_BYTES」的 File（不真正分配内存）
    const big = new File([new Uint8Array([1])], 'huge.bin', { type: 'application/octet-stream' })
    Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 })
    selectedFiles = [big]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(notifyPushMock).toHaveBeenCalledTimes(1)
    })
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('attachment-count')).toHaveTextContent('0')
  })
})
