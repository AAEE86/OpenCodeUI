import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AttachmentItem } from './AttachmentItem'
import { FullscreenProvider } from '../../contexts'
import type { Attachment } from './types'

// ============================================
// 上传中的胶囊（Issue #182）
//
// 需求：整个胶囊当进度条（填充层 + 百分比），拿不到进度时才退回不确定态转圈。
// 浏览器侧走 XHR 能拿到真实进度；桌面端经 Rust 发包拿不到。
// ============================================

const uploaded: Attachment = {
  id: 'a1',
  type: 'file',
  displayName: 'piui-source.zip',
  relativePath: 'C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/piui-source.zip',
  size: 262,
}

function renderItem(attachment: Attachment) {
  return render(
    <FullscreenProvider>
      <AttachmentItem attachment={attachment} />
    </FullscreenProvider>,
  )
}

describe('AttachmentItem 上传态', () => {
  it('有进度 → 整个胶囊是进度条，显示百分比，不显示转圈', () => {
    renderItem({ ...uploaded, uploadStatus: 'uploading', progress: 0.42 })

    const fill = screen.getByTestId('attachment-progress-fill')
    expect(fill).toHaveStyle({ width: '42%' })
    expect(screen.getByText('42%')).toBeTruthy()
    expect(screen.queryByTestId('attachment-progress-spinner')).toBeNull()
  })

  it('拿不到进度（桌面端） → 保留不确定态转圈，不画进度条', () => {
    renderItem({ ...uploaded, uploadStatus: 'uploading' })

    expect(screen.queryByTestId('attachment-progress-fill')).toBeNull()
    expect(screen.getByTestId('attachment-progress-spinner')).toBeTruthy()
  })

  it('进度值越界时夹到 0~100%', () => {
    const { unmount } = renderItem({ ...uploaded, uploadStatus: 'uploading', progress: 1.8 })
    expect(screen.getByTestId('attachment-progress-fill')).toHaveStyle({ width: '100%' })
    unmount()

    renderItem({ ...uploaded, uploadStatus: 'uploading', progress: -1 })
    expect(screen.getByTestId('attachment-progress-fill')).toHaveStyle({ width: '0%' })
  })

  it('上传完成后是普通胶囊：没有进度层，显示体积', () => {
    renderItem(uploaded)

    expect(screen.queryByTestId('attachment-progress-fill')).toBeNull()
    expect(screen.queryByTestId('attachment-progress-spinner')).toBeNull()
    expect(screen.getByText('262 B')).toBeTruthy()
  })
})

describe('AttachmentItem skill 附件', () => {
  it('展开后显示技能类型和技能 ID，而不是空的信息块', () => {
    render(
      <FullscreenProvider>
        <AttachmentItem
          attachment={{
            id: 'skill-1',
            type: 'skill',
            displayName: 'Commit',
            skillId: 'commit',
            content: 'skill body',
          }}
          expandable
        />
      </FullscreenProvider>,
    )

    fireEvent.click(screen.getByText('Commit'))

    expect(screen.getByText('Skill')).toBeTruthy()
    expect(screen.getByText('commit')).toBeTruthy()
    expect(screen.getByText('skill body')).toBeTruthy()
  })
})
