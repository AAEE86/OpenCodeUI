import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnDiffPartView } from './TurnDiffPartView'
import { getTurnDiff } from '../../../api/session'

vi.mock('../../../api/session', () => ({
  getTurnDiff: vi.fn(),
}))

vi.mock('../../../components/DiffView', () => ({
  DiffView: ({ filePath }: { filePath?: string }) => <div data-testid="diff-view">{filePath}</div>,
}))

const mockGetTurnDiff = vi.mocked(getTurnDiff)

describe('TurnDiffPartView', () => {
  beforeEach(() => {
    mockGetTurnDiff.mockReset()
  })

  it('lists the recorded paths before diffs arrive', () => {
    mockGetTurnDiff.mockReturnValue(new Promise(() => {}))

    render(<TurnDiffPartView sessionId="server:session-a" from="user-1" files={['src/a.ts', 'src/b.ts']} />)

    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.queryByTitle('src/a.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('2 files changed'))
    expect(screen.getByTitle('src/a.ts')).toBeInTheDocument()
    expect(screen.getByTitle('src/b.ts')).toBeInTheDocument()
  })

  it('shows change totals and expands a file diff on click', async () => {
    mockGetTurnDiff.mockResolvedValue([
      { file: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1, status: 'modified' },
      { file: 'src/b.ts', patch: '@@ -1 +1 @@\n-c\n+d', additions: 2, deletions: 0, status: 'modified' },
    ])

    render(<TurnDiffPartView sessionId="server:session-b" from="user-2" files={['src/a.ts', 'src/b.ts']} />)
    fireEvent.click(screen.getByText('2 files changed'))

    await waitFor(() => expect(mockGetTurnDiff).toHaveBeenCalledWith('server:session-b', 'user-2'))
    expect(await screen.findByText('+3')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('src/a.ts'))
    expect(screen.getByTestId('diff-view')).toHaveTextContent('src/a.ts')
  })

  it('caps the list at five files until show all is pressed', async () => {
    mockGetTurnDiff.mockReturnValue(new Promise(() => {}))
    const files = Array.from({ length: 7 }, (_, index) => `src/file-${index + 1}.ts`)

    render(<TurnDiffPartView sessionId="server:session-c" from="user-3" files={files} />)
    fireEvent.click(screen.getByText('7 files changed'))

    expect(screen.queryByTitle('src/file-6.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Show all'))
    expect(screen.getByTitle('src/file-6.ts')).toBeInTheDocument()
  })
})
