import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayoutStore } from './layoutStore'

const STORAGE_KEY_PANEL_LAYOUT = 'opencode-panel-layout'

describe('LayoutStore panel and terminal layout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('persists global panel layout without persisting terminal tabs', () => {
    const store = new LayoutStore()

    store.addMcpTab('bottom')
    store.addTerminalTab({ id: 'term-1', title: 'Terminal 1', status: 'connected' }, true, 'right')
    store.openRightPanel('changes')

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY_PANEL_LAYOUT) ?? 'null')

    expect(persisted).toMatchObject({
      version: 1,
      rightPanelOpen: true,
      bottomPanelOpen: true,
    })
    expect(persisted.panelTabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'files', type: 'files', position: 'right' }),
        expect.objectContaining({ id: 'changes', type: 'changes', position: 'right' }),
        expect.objectContaining({ id: 'mcp', type: 'mcp', position: 'bottom' }),
      ]),
    )
    expect(persisted.panelTabs.some((tab: { id: string }) => tab.id === 'term-1')).toBe(false)

    const restored = new LayoutStore().getState()
    expect(restored.rightPanelOpen).toBe(true)
    expect(restored.bottomPanelOpen).toBe(true)
    expect(restored.panelTabs.some(tab => tab.id === 'mcp' && tab.position === 'bottom')).toBe(true)
    expect(restored.panelTabs.some(tab => tab.id === 'term-1')).toBe(false)
  })

  it('keeps bottom and right panels open when syncing a directory with no terminal sessions', () => {
    const store = new LayoutStore()

    store.openBottomPanel()
    store.openRightPanel('files')
    store.syncTerminalSessions('dir-a', [])

    expect(store.getState().bottomPanelOpen).toBe(true)
    expect(store.getState().rightPanelOpen).toBe(true)
    expect(store.getTerminalTabs('bottom')).toEqual([])
    expect(store.getTerminalTabs('right')).toEqual([])
  })

  it('restores terminal positions for each directory when switching between projects', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [
      { id: 'term-a1', title: 'A1', status: 'connected' },
      { id: 'term-a2', title: 'A2', status: 'connected' },
    ])
    store.moveTab('term-a2', 'right')

    store.syncTerminalSessions('dir-b', [{ id: 'term-b1', title: 'B1', status: 'connected' }])
    store.syncTerminalSessions('dir-a', [
      { id: 'term-a1', title: 'A1', status: 'connected' },
      { id: 'term-a2', title: 'A2', status: 'connected' },
    ])

    expect(store.getTerminalTabs('bottom').map(tab => tab.id)).toEqual(['term-a1'])
    expect(store.getTerminalTabs('right').map(tab => tab.id)).toEqual(['term-a2'])
  })

  it('removes project terminal tabs when syncing global terminal sessions', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.syncTerminalSessions(undefined, [])

    expect(store.getTerminalTabs('bottom')).toEqual([])
    expect(store.getState().panelTabs.some(tab => tab.id === 'term-a1')).toBe(false)
  })

  it('does not notify when a terminal snapshot is unchanged', () => {
    const store = new LayoutStore()
    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    const snapshot = { buffer: 'pwd\r\n/workspace\r\n', scrollY: 2, cursor: 18, rows: 24, cols: 80 }

    store.updateTerminalSnapshot('term-a1', snapshot)
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.updateTerminalSnapshot('term-a1', snapshot)

    unsubscribe()
    expect(notifications).toBe(0)
  })

  it('falls back to a valid right tab when a stale terminal active id disappears after sync', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.moveTab('term-a1', 'right')
    store.setActiveTab('right', 'term-a1')

    store.syncTerminalSessions('dir-b', [])

    expect(store.getState().activeTabId.right).toBe('files')
  })

  it('persists terminal snapshots and restores them on the next sync', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.updateTerminalSnapshot('term-a1', {
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })

    const persisted = JSON.parse(localStorage.getItem('opencode-terminal-layout') ?? 'null')
    expect(persisted.directories['dir-a'].sessions['term-a1']).toMatchObject({
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })

    const restored = new LayoutStore()
    restored.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])

    expect(restored.getState().panelTabs.find(tab => tab.id === 'term-a1')).toMatchObject({
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })
  })

  it('persists terminal clipboard interaction preferences', () => {
    const store = new LayoutStore()

    store.setTerminalCopyOnSelect(true)
    store.setTerminalRightClickPaste(true)

    expect(localStorage.getItem('opencode-terminal-copy-on-select')).toBe('true')
    expect(localStorage.getItem('opencode-terminal-right-click-paste')).toBe('true')

    const restored = new LayoutStore().getState()
    expect(restored.terminalCopyOnSelect).toBe(true)
    expect(restored.terminalRightClickPaste).toBe(true)
  })
})

// 文件预览按工作区作用域：不同工作区的同名相对路径互不干扰（官方 session tab 作用域的等价物）
describe('LayoutStore file preview workspace scoping', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('同一路径在不同工作区是独立条目', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: '/repo-a' })
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: '/repo-b' })

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFiles).toHaveLength(2)
    expect(tab?.previewFile).toMatchObject({ path: 'src/app.ts', directory: '/repo-b' })
  })

  it('同一工作区内重复打开只保留一个条目', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: '/repo-a' })
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: '/repo-a' })

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFiles).toHaveLength(1)
  })

  it('目录写法不同（反斜杠）仍视为同一工作区条目', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: 'C:\\repo\\a' })
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: 'C:/repo/a' })

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFiles).toHaveLength(1)
    expect(tab?.previewFiles?.[0]?.directory).toBe('C:/repo/a')
  })

  it('关闭活跃预览回退到最近使用的条目', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'a.ts', name: 'a.ts', directory: '/repo' })
    store.openFilePreview({ path: 'b.ts', name: 'b.ts', directory: '/repo' })
    store.activateFilePreview('files', 'a.ts', '/repo')

    // a.ts 是活跃（关闭后应回退到右邻）
    expect(store.getState().panelTabs.find(t => t.id === 'files')?.previewFile?.path).toBe('a.ts')

    store.closeFilePreview('files', 'a.ts', '/repo')
    const tab = store.getState().panelTabs.find(t => t.id === 'files')
    expect(tab?.previewFile?.path).toBe('b.ts')
    expect(tab?.previewFiles).toHaveLength(1)
  })

  it('关闭一个工作区的预览不影响另一个工作区', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: '/repo-a' })
    store.openFilePreview({ path: 'src/app.ts', name: 'app.ts', directory: '/repo-b' })

    store.closeFilePreview('files', 'src/app.ts', '/repo-b')
    const tab = store.getState().panelTabs.find(t => t.id === 'files')
    expect(tab?.previewFiles).toHaveLength(1)
    expect(tab?.previewFiles?.[0]?.directory).toBe('/repo-a')
  })

  it('切换标签不改变标签顺序', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'a.ts', name: 'a.ts', directory: '/repo' })
    store.openFilePreview({ path: 'b.ts', name: 'b.ts', directory: '/repo' })
    store.openFilePreview({ path: 'c.ts', name: 'c.ts', directory: '/repo' })

    store.activateFilePreview('files', 'a.ts', '/repo')

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFiles?.map(item => item.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(tab?.previewFile?.path).toBe('a.ts')
  })

  it('重复打开已存在的文件保持原位，只更新元数据', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'a.ts', name: 'a.ts', directory: '/repo' })
    store.openFilePreview({ path: 'b.ts', name: 'b.ts', directory: '/repo' })

    store.openFilePreview({ path: 'a.ts', name: 'a.ts', directory: '/repo', targetLine: 42 })

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFiles?.map(item => item.path)).toEqual(['a.ts', 'b.ts'])
    expect(tab?.previewFiles?.[0]?.targetLine).toBe(42)
    expect(tab?.previewFile?.path).toBe('a.ts')
  })

  it('关闭活跃标签后落到右邻标签', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'a.ts', name: 'a.ts', directory: '/repo' })
    store.openFilePreview({ path: 'b.ts', name: 'b.ts', directory: '/repo' })
    store.openFilePreview({ path: 'c.ts', name: 'c.ts', directory: '/repo' })

    store.activateFilePreview('files', 'b.ts', '/repo')
    store.closeFilePreview('files', 'b.ts', '/repo')

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFile?.path).toBe('c.ts')
  })

  it('按工作区分别记录最近激活的预览', () => {
    const store = new LayoutStore()
    store.openFilePreview({ path: 'a1.ts', name: 'a1.ts', directory: '/repo-a' })
    store.openFilePreview({ path: 'a2.ts', name: 'a2.ts', directory: '/repo-a' })
    store.openFilePreview({ path: 'b1.ts', name: 'b1.ts', directory: '/repo-b' })

    store.activateFilePreview('files', 'a1.ts', '/repo-a')

    const tab = store.getState().panelTabs.find(item => item.id === 'files')
    expect(tab?.previewFiles?.map(item => item.path)).toEqual(['a1.ts', 'a2.ts', 'b1.ts'])
    expect(tab?.previewActive?.at(-1)).toMatchObject({ path: 'a1.ts', directory: '/repo-a' })
  })
})
