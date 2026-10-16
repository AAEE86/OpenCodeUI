import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolPartView } from './ToolPartView'
import type { ToolViewPart } from '../tools'
import type { ApiPermissionRequest } from '../../../api'

// 可控 mock：按用例决定当前是否还有待批准权限，并记录 InlinePermission 收到的 props
const { findPermissionMock, inlinePermissionSpy } = vi.hoisted(() => ({
  findPermissionMock: vi.fn<() => ApiPermissionRequest | undefined>(() => undefined),
  inlinePermissionSpy: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
  useCompositorExpand: (open: boolean) => ({
    contentRef: { current: null },
    layoutOpen: open,
    keepMounted: open,
    panelClassName: '',
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    inlineToolRequests: true,
    immersiveMode: false,
    compactInlinePermission: false,
  }),
}))

vi.mock('../../../store/serverStore', () => ({
  serverStore: { getActiveCalibratedNow: () => undefined },
}))

vi.mock('../../chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => ({
    serverId: 'local',
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onFormReply: vi.fn(),
    onFormCancel: vi.fn(),
    isReplying: false,
  }),
  findPermissionRequestForTool: () => findPermissionMock(),
  findQuestionRequestForTool: () => undefined,
}))

vi.mock('../../chat/InlinePermission', () => ({
  InlinePermission: (props: { resolved?: boolean }) => {
    inlinePermissionSpy(props)
    return <div data-testid="inline-permission" />
  },
}))

vi.mock('../../chat/InlineQuestion', () => ({
  InlineQuestion: () => null,
}))

vi.mock('../tools', () => ({
  getToolIcon: () => <span />,
  extractToolData: () => ({}),
  getToolConfig: () => undefined,
  DefaultRenderer: () => null,
  TaskRenderer: () => null,
}))

function createRunningTool(name: string): ToolViewPart {
  return {
    type: 'tool',
    id: 'tool-1',
    name,
    messageID: 'message-1',
    state: { status: 'running', input: {}, metadata: {} },
    time: { created: 0 },
  }
}

function createPermission(action: string): ApiPermissionRequest {
  return { id: 'perm-1', sessionID: 'session-1', action, resources: [] } as unknown as ApiPermissionRequest
}

const CONTEXT = { messageID: 'message-1', created: 0 }

describe('ToolPartView 权限他端批准后的残留', () => {
  beforeEach(() => {
    findPermissionMock.mockReset()
    inlinePermissionSpy.mockClear()
    // rAF 同步执行，让缓存 effect 立即落地
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bash 权限被他端批准后卡片立即消失（不再残留按钮）', () => {
    const part = createRunningTool('bash')
    findPermissionMock.mockReturnValue(createPermission('bash'))

    const { rerender } = render(<ToolPartView part={part} context={CONTEXT} />)
    expect(screen.queryByTestId('inline-permission')).not.toBeNull()

    // 他端批准：服务端广播 permission.replied，pending 列表不再有该请求。
    // 真实应用里靠 context 变化触发重渲染；测试里用新 context 引用破掉 memo。
    findPermissionMock.mockReturnValue(undefined)
    act(() => {
      rerender(<ToolPartView part={part} context={{ ...CONTEXT }} />)
    })

    // 非文件权限立即清缓存 → 权限组件卸载
    expect(screen.queryByTestId('inline-permission')).toBeNull()
  })

  it('edit 权限批准后保留 resolved 预览直到工具完成', () => {
    const part = createRunningTool('edit')
    findPermissionMock.mockReturnValue(createPermission('edit'))

    const { rerender } = render(<ToolPartView part={part} context={CONTEXT} />)
    expect(screen.queryByTestId('inline-permission')).not.toBeNull()

    findPermissionMock.mockReturnValue(undefined)
    act(() => {
      rerender(<ToolPartView part={part} context={{ ...CONTEXT }} />)
    })

    // edit 保留缓存避免画面跳动：仍渲染，且为 resolved 态（无按钮）
    expect(screen.queryByTestId('inline-permission')).not.toBeNull()
    const lastProps = inlinePermissionSpy.mock.calls.at(-1)?.[0] as { resolved?: boolean }
    expect(lastProps?.resolved).toBe(true)
  })
})
