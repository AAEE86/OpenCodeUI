import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTwoFilesPatch } from 'diff'
import { describe, expect, it, vi } from 'vitest'
import { DiffViewer } from './DiffViewer'
import { reconstructBeforeAfterFromPatch } from '../utils/diffUtils'

vi.mock('../store/themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/themeStore')>()
  const snapshot = { diffStyle: 'lineNumbers' as const, codeWordWrap: false, codeFontScale: 0 }
  return {
    ...actual,
    themeStore: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    },
  }
})

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options?: { mode?: 'html' | 'tokens' }) => ({
    output: options?.mode === 'tokens' ? code.split('\n').map(line => [{ content: line, color: '#fff' }]) : null,
    isLoading: false,
  }),
}))

describe('DiffViewer', () => {
  it('uses wrapped rendering without proxy horizontal scrollbar when word wrap is enabled', () => {
    const { container } = render(
      <DiffViewer
        before={'const someRidiculouslyLongIdentifierName = oldValue'}
        after={'const someRidiculouslyLongIdentifierName = newValue'}
        language="ts"
        viewMode="unified"
        wordWrap={true}
      />,
    )

    expect(screen.getByText('const someRidiculouslyLongIdentifierName = oldValue')).toBeInTheDocument()
    expect(screen.getByText('const someRidiculouslyLongIdentifierName = newValue')).toBeInTheDocument()
    expect(container.querySelector('.sticky')).toBeNull()
  })

  it('keeps empty split content texture anchored while scrolling horizontally', async () => {
    const { container } = render(
      <DiffViewer
        before={['same', 'tail'].join('\n')}
        after={['same', 'added only line', 'tail'].join('\n')}
        language="ts"
        viewMode="split"
        wordWrap={false}
      />,
    )

    const scrollPanels = container.querySelectorAll('.scrollbar-none')
    const leftContent = scrollPanels[0] as HTMLDivElement

    const emptyBuffer = container.querySelector('.diff-empty-content-buffer.min-w-full') as HTMLDivElement
    const initialX = Number.parseFloat(emptyBuffer.style.backgroundPosition.split(' ')[0] ?? '0')

    Object.defineProperty(leftContent, 'scrollLeft', { value: 37, configurable: true })
    fireEvent.scroll(leftContent)

    await waitFor(() => {
      const updatedBuffer = container.querySelector('.diff-empty-content-buffer.min-w-full') as HTMLDivElement
      const updatedX = Number.parseFloat(updatedBuffer.style.backgroundPosition.split(' ')[0] ?? '0')
      expect(updatedX - initialX).toBe(37)
    })
  })

  it('keeps split word-diff changed text themed when syntax highlighting is unavailable', () => {
    const { container } = render(
      <DiffViewer before={['node_modules', '.git', '.gitignore'].join('\n')} after={['node_modules', 'root', '.gitignore'].join('\n')} language="text" viewMode="split" wordWrap={true} />,
    )

    const changedSegments = Array.from(container.querySelectorAll('span')).filter(
      segment => segment.classList.contains('bg-danger-100/30') || segment.classList.contains('bg-success-100/30'),
    )

    expect(changedSegments.length).toBeGreaterThan(0)
    for (const segment of changedSegments) {
      expect(segment.closest('.text-text-100')).not.toBeNull()
    }
  })

  it('does not duplicate trailing characters when split word diff is syntax highlighted', () => {
    const { container } = render(
      <DiffViewer
        before={'const [isLoading, setIsLoading] = useState(false)\nif (!enabled) return'}
        after={'const [isLoading, setIsLoading] = useState(false)\nif (!enabled || delayMs > 0) return'}
        language="ts"
        viewMode="split"
        wordWrap={false}
      />,
    )

    expect(container.textContent).toContain('if (!enabled) return')
    expect(container.textContent).not.toContain('returnn')
  })

  it('patch 还原的合成区域不渲染折叠条，真实 diff 的折叠条正常', () => {
    // 40 行文件、第 30 行改一处；内容纯字母，行号只出现在 gutter 里
    const lines = Array.from(
      { length: 40 },
      (_, i) => `item_${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
    )
    const before = lines.join('\n')
    const after = [...lines.slice(0, 29), 'REPLACED', ...lines.slice(30)].join('\n')
    const patch = createTwoFilesPatch('a.ts', 'a.ts', before, after)
    const rec = reconstructBeforeAfterFromPatch(patch)!

    const { container: synthetic } = render(
      <DiffViewer before={rec.before} after={rec.after} language="text" viewMode="split" wordWrap={false} />,
    )
    // 变更内容渲染出来，且 gutter 是绝对行号 30
    expect(synthetic.textContent).toContain('REPLACED')
    expect(screen.getAllByText('30').length).toBeGreaterThan(0)
    // 合成区域不渲染折叠条（展开了也没有真实内容）
    expect(synthetic.querySelector('[data-separator="line-info"]')).toBeNull()

    // 同样的变更，但给的是完整 before/after（真实内容）→ 折叠条正常且可展开
    const { container: real } = render(
      <DiffViewer before={before} after={after} language="text" viewMode="split" wordWrap={false} />,
    )
    expect(real.querySelector('[data-separator="line-info"]')).not.toBeNull()
    expect(real.querySelector('[data-expand-button]')).not.toBeNull()
  })
})
