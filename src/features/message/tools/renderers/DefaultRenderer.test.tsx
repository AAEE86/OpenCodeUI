import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DefaultRenderer } from './DefaultRenderer'
import { FullscreenProvider } from '../../../../contexts'
import type { ToolViewPart } from '../index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// ContentBlock 与本次断言无关，压掉避免重型依赖
vi.mock('../../../../components', () => ({
  ContentBlock: () => null,
}))

/** read 工具读图片的完成态（v2：text 说明 + file data URI，core/tool/plugin/read.ts 同款） */
function imageReadPart(): ToolViewPart {
  return {
    type: 'tool',
    id: 'tool-read-image',
    name: 'read',
    messageID: 'message-1',
    state: {
      status: 'completed',
      input: { path: 'C:/Users/lehhair/pixel.png' },
      metadata: {},
      content: [
        { type: 'text', text: 'Image read successfully' },
        { type: 'file', uri: 'data:image/png;base64,iVBORw0KGgo=', mime: 'image/png', name: 'C:/Users/lehhair/pixel.png' },
      ],
    },
    time: { created: 1_000 },
  }
}

describe('DefaultRenderer 工具产出的图片附件', () => {
  it('read 到图片时胶囊可展开查看（和用户消息附件同款交互）', async () => {
    render(
      <FullscreenProvider>
        <DefaultRenderer
          part={imageReadPart()}
          data={{
            output: 'Image read successfully',
            toolFiles: [{ uri: 'data:image/png;base64,iVBORw0KGgo=', mime: 'image/png', name: 'pixel.png' }],
          }}
        />
      </FullscreenProvider>,
    )

    // 胶囊渲染
    const pill = screen.getByText('pixel.png')
    expect(pill).toBeInTheDocument()

    // 点击展开 → 内嵌图片预览出现
    fireEvent.click(pill)
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'pixel.png' })).toBeInTheDocument()
    })
  })
})
