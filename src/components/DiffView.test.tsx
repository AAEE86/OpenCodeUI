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

  it('按 patch 的绝对行号还原：深处变更产生前导折叠条（旧的片段提取不会）', () => {
    // 构造一个 40 行文件、第 30 行改一处的 patch（createTwoFilesPatch context=4）
    const before = Array.from({ length: 40 }, (_, i) => `line${i + 1}`).join('\n')
    const after = before.replace('line30', 'CHANGED30')
    const patch = createTwoFilesPatch('app.ts', 'app.ts', before, after)

    const { container } = render(
      <FullscreenProvider>
        <DiffView diff={patch} filePath="src/app.ts" />
      </FullscreenProvider>,
    )

    // 变更内容渲染出来
    expect(screen.getByText('CHANGED30')).toBeInTheDocument()
    // 前导未变化行被折叠成分隔条（绝对行号还原的标志；旧的片段提取从第 1 行开始、无此条）
    expect(container.querySelector('[data-separator="line-info"]')).not.toBeNull()
    // 行号列出现真实行号 30，而不是从 1 开始
    expect(container.textContent).toContain('30')
  })
})
