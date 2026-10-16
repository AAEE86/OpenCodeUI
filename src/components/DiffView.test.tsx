import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { createTwoFilesPatch } from 'diff'
import { describe, expect, it, vi } from 'vitest'
import { DiffView } from './DiffView'
import { FullscreenProvider } from '../contexts'

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options?: { mode?: 'html' | 'tokens' }) => ({
    output: options?.mode === 'tokens' ? code.split('\n').map(line => [{ content: line, color: '#fff' }]) : null,
    isLoading: false,
  }),
}))

vi.mock('./FullscreenViewer', () => ({
  FullscreenViewer: ({ isOpen, children }: { isOpen: boolean; children?: ReactNode }) =>
    isOpen ? <div data-testid="fullscreen-viewer">{children}</div> : null,
  ViewModeSwitch: () => <div data-testid="view-mode-switch">switch</div>,
}))

describe('DiffView', () => {
  it('renders diff stats and can open fullscreen viewer', () => {
    render(
      <FullscreenProvider>
        <DiffView
          before={'const a = 1\nconst keep = true'}
          after={'const a = 2\nconst keep = true'}
          filePath="src/app.ts"
        />
      </FullscreenProvider>,
    )

    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Fullscreen'))
    expect(screen.getByTestId('fullscreen-viewer')).toBeInTheDocument()
  })

  it('按 patch 的绝对行号还原：深处变更显示真实行号（旧的片段提取从 1 开始）', () => {
    // 40 行文件、第 30 行改一处；内容纯字母，行号只出现在 gutter 里
    const lines = Array.from(
      { length: 40 },
      (_, i) => `item_${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
    )
    const before = lines.join('\n')
    const after = [...lines.slice(0, 29), 'REPLACED', ...lines.slice(30)].join('\n')
    const patch = createTwoFilesPatch('app.ts', 'app.ts', before, after)

    const { container } = render(
      <FullscreenProvider>
        <DiffView diff={patch} filePath="src/app.ts" />
      </FullscreenProvider>,
    )

    // 变更内容渲染出来
    expect(screen.getByText('REPLACED')).toBeInTheDocument()
    // gutter 出现真实行号 30（旧的片段提取从 1 开始，最大只到 9，不会有 30）
    expect(screen.getAllByText('30').length).toBeGreaterThan(0)
    // 合成前导区域不渲染折叠条（展开了也没有真实内容）
    expect(container.querySelector('[data-separator="line-info"]')).toBeNull()
  })
})
