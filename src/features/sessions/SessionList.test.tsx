import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../../api'
import { createSessionPlaceholder } from '../../utils/sessionPlaceholder'
import { pinnedSessionsStore } from '../../store/pinnedSessionsStore'
import { SessionListItem, UnavailablePinnedSessionItem } from './SessionList'

const { useSessionActiveEntryMock, useHasUnreadCompletedNotificationMock, markSessionNotificationsReadMock } = vi.hoisted(() => ({
  useSessionActiveEntryMock: vi.fn(),
  useHasUnreadCompletedNotificationMock: vi.fn(),
  markSessionNotificationsReadMock: vi.fn(),
}))

vi.mock('../../store/activeSessionStore', () => ({
  useSessionActiveEntry: (...args: unknown[]) => useSessionActiveEntryMock(...args),
}))

vi.mock('../../store/notificationStore', () => ({
  notificationStore: {
    markSessionNotificationsRead: markSessionNotificationsReadMock,
  },
  useHasUnreadCompletedNotification: (...args: unknown[]) => useHasUnreadCompletedNotificationMock(...args),
}))

vi.mock('../../hooks/useInputCapabilities', () => ({
  useInputCapabilities: () => ({ preferTouchUi: false }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('../chat/sidebar/SessionChildrenSlot', () => ({
  SessionChildrenSlot: () => null,
}))

describe('SessionListItem', () => {
  // v2 的 SessionInfo 字段较多，测试里用占位构造器补齐必填项
  const session: ApiSession = createSessionPlaceholder({
    id: 'session-1',
    title: 'Session One',
    directory: '/workspace/demo',
  })

  beforeEach(() => {
    useSessionActiveEntryMock.mockReturnValue(null)
    useHasUnreadCompletedNotificationMock.mockReturnValue(false)
    markSessionNotificationsReadMock.mockReset()
    pinnedSessionsStore.unpin('session-1')
  })

  it('renders the session row as a semantic button and selects it', () => {
    const onSelect = vi.fn()

    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Session One/i }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(markSessionNotificationsReadMock).toHaveBeenCalledWith('local::session-1', 'completed')
  })

  it('keeps the full session row clickable outside the inner content button', () => {
    const onSelect = vi.fn()

    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
      />,
    )

    const sessionButton = screen.getByRole('button', { name: /Session One/i })
    const sessionRow = sessionButton.parentElement

    expect(sessionRow).not.toBeNull()

    fireEvent.click(sessionRow!)

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('pins and unpins a session from the row action', () => {
    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /pin/i }))

    expect(pinnedSessionsStore.isPinned('session-1')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /unpin/i }))

    expect(pinnedSessionsStore.isPinned('session-1')).toBe(false)
  })

  it('toggles selection when the row is clicked in edit mode', () => {
    const onToggleCheck = vi.fn()

    render(
      <SessionListItem
        session={session}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        preferTouchUi={false}
        isEditMode
        isChecked={false}
        onToggleCheck={onToggleCheck}
      />,
    )

    fireEvent.click(screen.getByText('Session One'))

    expect(onToggleCheck).toHaveBeenCalledTimes(1)
  })

})

describe('UnavailablePinnedSessionItem (issue #177)', () => {
  const entry = { sessionId: 'ghost-session', directory: '/workspace/demo', title: 'Ghost Session' }

  beforeEach(() => {
    pinnedSessionsStore.unpin(entry.sessionId)
  })

  it('reveals the unpin action on long-press in touch UI and unpins', () => {
    vi.useFakeTimers()
    try {
      pinnedSessionsStore.pin(entry)

      render(<UnavailablePinnedSessionItem entry={entry} preferTouchUi />)

      const unpinButton = screen.getByRole('button', { name: /unpin/i })
      // 长按前：触屏下按钮不渲染为可见
      expect(unpinButton.className).toContain('hidden')

      fireEvent.touchStart(screen.getByText('Ghost Session'))
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(unpinButton.className).not.toContain('hidden')

      fireEvent.click(unpinButton)
      expect(pinnedSessionsStore.isPinned(entry.sessionId)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the long-press when the finger moves', () => {
    vi.useFakeTimers()
    try {
      pinnedSessionsStore.pin(entry)

      render(<UnavailablePinnedSessionItem entry={entry} preferTouchUi />)

      fireEvent.touchStart(screen.getByText('Ghost Session'))
      fireEvent.touchMove(screen.getByText('Ghost Session'))
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(screen.getByRole('button', { name: /unpin/i }).className).toContain('hidden')
      expect(pinnedSessionsStore.isPinned(entry.sessionId)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the unpin action hover-revealed on pointer devices', () => {
    pinnedSessionsStore.pin(entry)

    render(<UnavailablePinnedSessionItem entry={entry} />)

    const unpinButton = screen.getByRole('button', { name: /unpin/i })
    expect(unpinButton.className).toContain('opacity-0')

    fireEvent.click(unpinButton)
    expect(pinnedSessionsStore.isPinned(entry.sessionId)).toBe(false)
  })
})
