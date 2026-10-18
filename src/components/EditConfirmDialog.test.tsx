import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditConfirmDialog } from './EditConfirmDialog'
import { FullscreenProvider } from '../contexts'

// ============================================
// 保存 / 放弃的二次确认弹层（需求三 A）
//
// 它现在包的是工具卡片那套 DiffView（同名 diff 组件），所以顺带继承：
// 头部显示文件名、+/- 统计、全屏按钮。这里锁住：文件名可见、diff 可见、
// 冲突时多一行警告且主按钮变「覆盖」、改动过大不渲染 diff、确认键不自动聚焦。
// 测试环境 i18n 是英文，断言走 testid / 英文按钮名。
// ============================================

const base = {
  isOpen: true,
  fileName: 'app.ts',
  before: 'const a = 1\n',
  after: 'const a = 2\n',
  language: 'text',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

function renderDialog(props: Partial<React.ComponentProps<typeof EditConfirmDialog>> = {}) {
  return render(
    <FullscreenProvider>
      <EditConfirmDialog {...base} mode="save" {...props} />
    </FullscreenProvider>,
  )
}

describe('EditConfirmDialog', () => {
  it('保存确认：展示带文件名的 diff + 两个动作', () => {
    renderDialog()

    expect(screen.getByTestId('edit-confirm-dialog')).toBeTruthy()
    expect(screen.getByTestId('edit-confirm-diff')).toBeTruthy()
    // 文件名出现在 diff 头部（工具卡片同款）
    expect(screen.getByText('app.ts')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.queryByTestId('edit-confirm-conflict')).toBeNull()
  })

  it('冲突保存：多一行警告，主按钮变成「覆盖」', () => {
    renderDialog({ conflict: true })

    expect(screen.getByTestId('edit-confirm-conflict')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeTruthy()
  })

  it('放弃改动：按钮是危险色的「放弃」', () => {
    renderDialog({ mode: 'discard' })

    const discard = screen.getByRole('button', { name: 'Discard' })
    expect(discard).toBeTruthy()
    expect(discard.className).toContain('bg-danger-100')
  })

  it('改动过大：不渲染 diff，只给摘要', () => {
    const huge = 'x'.repeat(150_000)
    renderDialog({ before: huge, after: huge })

    expect(screen.queryByTestId('edit-confirm-diff')).toBeNull()
  })

  it('确认键不自动聚焦（Enter 不该直接写盘 / 丢改动）', () => {
    renderDialog()

    expect(screen.getByRole('button', { name: 'Save' })).not.toBe(document.activeElement)
  })

  it('确认 / 取消分别回调', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderDialog({ onConfirm, onCancel })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
