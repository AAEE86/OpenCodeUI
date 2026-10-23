import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompactionQueuedView, TimelineNoticeView, type NoticeMessage } from './NoticePartView'

function notice(overrides: Partial<NoticeMessage> & Pick<NoticeMessage, 'type'>): NoticeMessage {
  return { id: 'message-1', time: { created: 1 }, ...overrides } as NoticeMessage
}

describe('TimelineNoticeView', () => {
  it('renders agent switches with previous → next', () => {
    render(<TimelineNoticeView message={notice({ type: 'agent-switched', agent: 'plan', previous: 'build' })} />)

    expect(screen.getByText('Agent changed')).toBeInTheDocument()
    expect(screen.getByText('Build → Plan')).toBeInTheDocument()
  })

  it('renders model switches as a separator line', () => {
    render(
      <TimelineNoticeView
        message={notice({ type: 'model-switched', model: { providerID: 'openai', id: 'gpt-5', variant: 'high' } })}
      />,
    )

    expect(screen.getByText('Switched to gpt-5 (high)')).toBeInTheDocument()
  })

  it('renders instruction updates with the changed keys', () => {
    render(
      <TimelineNoticeView
        message={notice({
          type: 'system',
          text: 'x',
          description: 'Instructions updated: AGENTS.md, .cursor/rules',
        })}
      />,
    )

    expect(screen.getByText('Instructions updated')).toBeInTheDocument()
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText('.cursor/rules')).toBeInTheDocument()
  })

  it('renders subagent outcomes from synthetic metadata', () => {
    render(
      <TimelineNoticeView
        message={notice({
          type: 'synthetic',
          text: 'ctx',
          description: 'Subagent failed',
          metadata: { source: 'subagent', agent: 'explore', state: 'error' },
        })}
      />,
    )

    expect(screen.getByText('explore failed')).toBeInTheDocument()
    expect(screen.getByText('Subagent failed')).toBeInTheDocument()
  })

  it('renders queued compaction as a divider label', () => {
    render(<CompactionQueuedView />)

    expect(screen.getByText('Session compaction queued')).toBeInTheDocument()
  })
})
