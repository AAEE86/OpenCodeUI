import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionStructuredError } from '@opencode/client/promise'
import { MessageErrorView } from './MessageErrorView'

function freeLimitError(retryAfterMs?: number): SessionStructuredError {
  return {
    type: 'provider.free-limit',
    message: 'Free usage limit reached.',
    ...(retryAfterMs != null ? { retryAfterMs } : {}),
  } as SessionStructuredError
}

describe('MessageErrorView free-limit', () => {
  it('renders a quiet status line with the reset time when retryAfterMs is known', () => {
    const base = new Date('2026-10-23T08:00:00Z').getTime()
    render(<MessageErrorView error={freeLimitError(3_600_000)} time={{ created: base }} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent("You've used today's free messages.")
    expect(status).toHaveTextContent('They reset at')
  })

  it('falls back to the plain title when retryAfterMs is missing', () => {
    render(<MessageErrorView error={freeLimitError()} time={{ created: Date.now() }} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent("You've used today's free messages.")
    expect(status).not.toHaveTextContent('They reset at')
  })

  it('ignores an out-of-range retryAfterMs', () => {
    render(<MessageErrorView error={freeLimitError(30 * 86_400_000)} time={{ created: Date.now() }} />)

    expect(screen.getByRole('status')).not.toHaveTextContent('They reset at')
  })
})
