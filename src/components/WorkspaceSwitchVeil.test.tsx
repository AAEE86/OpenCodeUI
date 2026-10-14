import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSwitchVeil } from './WorkspaceSwitchVeil'
import { DirectoryContext, type DirectoryContextValue } from '../contexts/DirectoryContext.shared'

function makeContextValue(): DirectoryContextValue {
  return {
    currentDirectory: undefined,
    setCurrentDirectory: () => undefined,
    savedDirectories: [],
    addDirectory: () => undefined,
    removeDirectory: () => undefined,
    reorderDirectories: () => undefined,
    pathInfo: null,
    sidebarExpanded: false,
    setSidebarExpanded: () => undefined,
    recentProjects: {},
  }
}

function VeilHarness() {
  const [directory, setDirectory] = useState<string | undefined>('/repo-a')
  const value: DirectoryContextValue = {
    ...makeContextValue(),
    currentDirectory: directory,
    setCurrentDirectory: setDirectory,
  }
  return (
    <DirectoryContext.Provider value={value}>
      <WorkspaceSwitchVeil />
      <button type="button" onClick={() => setDirectory('/repo-b')}>
        switch
      </button>
    </DirectoryContext.Provider>
  )
}

function mockIosUserAgent() {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15',
  })
}

const originalUserAgent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')

function getVeil(): HTMLElement | null {
  return document.querySelector('[data-workspace-switch-veil]')
}

describe('WorkspaceSwitchVeil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockIosUserAgent()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, 'userAgent', originalUserAgent)
    }
  })

  it('iOS 上不覆盖首屏，切换工作区时瞬时盖上并在内容落定后淡出', () => {
    const { getByText } = render(<VeilHarness />)

    const veil = getVeil()
    expect(veil).not.toBeNull()
    // 首屏不盖
    expect(veil!.style.opacity).toBe('0')

    act(() => {
      getByText('switch').click()
    })

    // 切换瞬时盖上：opacity 1 且无过渡（渐变会挡不住白闪）
    expect(veil!.style.opacity).toBe('1')
    expect(veil!.style.transition).toBe('none')

    // 落定后淡出（带过渡）
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(veil!.style.opacity).toBe('0')
    expect(veil!.style.transition).toContain('opacity')
  })

  it('非 iOS 环境（安卓/PC/Tauri）不渲染遮罩', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
    })

    render(<VeilHarness />)

    expect(getVeil()).toBeNull()
  })
})
