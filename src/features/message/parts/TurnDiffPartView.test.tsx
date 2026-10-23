import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnDiffPartView } from './TurnDiffPartView'
import { getTurnDiff } from '../../../api/session'
import type { FileDiff } from '../../../api/types'

vi.mock('../../../api/session', () => ({
  getTurnDiff: vi.fn(),
}))

vi.mock('../../../components', () => ({
  ContentBlock: ({
    filePath,
    diff,
    diffStats,
  }: {
    filePath?: string
    diff?: string
    diffStats?: { additions: number; deletions: number }
  }) => (
    <div data-testid="content-block" data-file={filePath} data-has-diff={String(!!diff)}>
      {filePath}
      {diffStats && (
        <span data-testid={`file-stats-${filePath}`}>
          +{diffStats.additions} -{diffStats.deletions}
        </span>
      )}
    </div>
  ),
}))

const mockGetTurnDiff = vi.mocked(getTurnDiff)

function diff(file: string, additions = 1, deletions = 1): FileDiff {
  return {
    file,
    patch: ['@@ -1 +1 @@', '-a', '+b'].join('\n'),
    additions,
    deletions,
    status: 'modified',
  }
}

describe('TurnDiffPartView', () => {
  beforeEach(() => {
    mockGetTurnDiff.mockReset()
  })

  it('lists the recorded paths before diffs arrive', () => {
    mockGetTurnDiff.mockReturnValue(new Promise(() => {}))

    render(<TurnDiffPartView sessionId="server:session-a" from="user-1" files={['src/a.ts', 'src/b.ts']} />)

    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.queryByText('src/a.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('2 files changed'))
    expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('src/b.ts')).toBeInTheDocument()
  })

  it('shows totals while collapsed and passes the patch into the tool-card diff', async () => {
    mockGetTurnDiff.mockResolvedValue([diff('src/a.ts', 2, 1), diff('src/b.ts', 3, 0)])

    render(<TurnDiffPartView sessionId="server:session-b" from="user-2" files={['src/a.ts', 'src/b.ts']} />)

    // 收起状态也要直接看到变更量
    await waitFor(() => expect(mockGetTurnDiff).toHaveBeenCalledWith('server:session-b', 'user-2'))
    expect(await screen.findByText('+5')).toBeInTheDocument()
    expect(screen.queryByText('src/a.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('2 files changed'))
    const card = screen
      .getAllByTestId('content-block')
      .find(node => node.getAttribute('data-file') === 'src/a.ts')
    expect(card).toHaveAttribute('data-has-diff', 'true')
  })

  it('caps the list at five files until show all is pressed', () => {
    mockGetTurnDiff.mockReturnValue(new Promise(() => {}))
    const files = Array.from({ length: 7 }, (_, index) => `src/file-${index + 1}.ts`)

    render(<TurnDiffPartView sessionId="server:session-c" from="user-3" files={files} />)
    fireEvent.click(screen.getByText('7 files changed'))

    expect(screen.queryByText('src/file-6.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Show all'))
    expect(screen.getByText('src/file-6.ts')).toBeInTheDocument()
  })
})
