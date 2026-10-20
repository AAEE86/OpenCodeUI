import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersSettings } from './ServersSettings'

const { useServerStoreMock, navigateHomeMock, clearSessionMock } = vi.hoisted(() => ({
  useServerStoreMock: vi.fn(),
  navigateHomeMock: vi.fn(),
  clearSessionMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      typeof values?.latency === 'number' ? `${key} ${values.latency}` : key,
  }),
}))

vi.mock('../../../hooks', () => ({
  useServerStore: useServerStoreMock,
  useRouter: () => ({ navigateHome: navigateHomeMock, sessionId: 'session-1' }),
}))

vi.mock('../../../store', () => ({
  messageStore: { clearSession: clearSessionMock },
}))

const localServer = { id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true }
const remoteServer = { id: 'remote', name: 'Remote', url: 'http://remote.test' }

describe('ServersSettings', () => {
  const checkHealthMock = vi.fn()
  const setActiveServerMock = vi.fn()
  const setActiveEndpointMock = vi.fn()
  const setLockedEndpointMock = vi.fn()

  beforeEach(() => {
    checkHealthMock.mockReset()
    setActiveServerMock.mockReset()
    setActiveEndpointMock.mockReset()
    setLockedEndpointMock.mockReset()
    navigateHomeMock.mockReset()
    clearSessionMock.mockReset()
    useServerStoreMock.mockReturnValue({
      servers: [localServer, remoteServer],
      activeServer: localServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
      setActiveServer: setActiveServerMock,
      setActiveEndpoint: setActiveEndpointMock,
      setLockedEndpoint: setLockedEndpointMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
      endpointStates: new Map(),
    })
  })

  it('switches servers even when health verification fails', async () => {
    checkHealthMock.mockResolvedValueOnce({ status: 'error', error: 'Not an OpenCode server' })

    render(<ServersSettings />)

    fireEvent.click(screen.getByRole('button', { name: /Remote/ }))

    await waitFor(() => {
      expect(checkHealthMock).toHaveBeenCalledWith('remote')
    })
    expect(setActiveServerMock).toHaveBeenCalledWith('remote')
    expect(navigateHomeMock).toHaveBeenCalled()
    expect(clearSessionMock).toHaveBeenCalledWith('session-1')
  })

  it('多地址服务器列全部地址，可手动「使用」与「锁定」（Issue #183）', async () => {
    const dualServer = {
      id: 'dual',
      name: 'Dual',
      url: 'http://192.168.1.5:4096',
      endpoints: [
        { url: 'http://192.168.1.5:4096', priority: 0 },
        { url: 'https://public.example.com', priority: 1 },
      ],
    }
    useServerStoreMock.mockReturnValue({
      servers: [dualServer],
      activeServer: dualServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
      setActiveServer: setActiveServerMock,
      setActiveEndpoint: setActiveEndpointMock,
      setLockedEndpoint: setLockedEndpointMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
      endpointStates: new Map(),
    })

    render(<ServersSettings />)

    // 默认收起：只显示地址数量，列表内容不渲染
    const toggle = screen.getByTitle('servers.endpointToggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTitle('servers.endpointUse')).toBeNull()

    // 展开后才看得到全部地址
    fireEvent.click(toggle)
    expect(screen.getByTitle('servers.endpointToggle').getAttribute('aria-expanded')).toBe('true')

    // 两个地址都渲染出来（主地址在标题行 + 列表各出现一次，故用 getAll）
    expect(screen.getAllByText('http://192.168.1.5:4096').length).toBeGreaterThan(0)
    expect(screen.getByText('https://public.example.com')).toBeTruthy()

    // 点备用地址 → 切过去
    fireEvent.click(screen.getByTitle('servers.endpointUse'))
    expect(setActiveEndpointMock).toHaveBeenCalledWith('dual', 'https://public.example.com')

    // 锁定备用地址 → 传 url；再点一次 → 传 null 解锁
    const [lockButton] = screen.getAllByTitle('servers.endpointLock')
    fireEvent.click(lockButton!)
    expect(setLockedEndpointMock).toHaveBeenCalledWith('dual', 'http://192.168.1.5:4096')
  })

  it('收起状态下仍能看出地址被锁定', async () => {
    const dualServer = {
      id: 'dual',
      name: 'Dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    }
    useServerStoreMock.mockReturnValue({
      servers: [dualServer],
      activeServer: dualServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
      setActiveServer: setActiveServerMock,
      setActiveEndpoint: setActiveEndpointMock,
      setLockedEndpoint: setLockedEndpointMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
      endpointStates: new Map([['dual', { activeUrl: 'https://wan.test', lockedUrl: 'https://wan.test', lastSwitchAt: 0 }]]),
    })

    render(<ServersSettings />)

    // 收起状态，但折叠行上带锁定标记
    const toggle = screen.getByTitle('servers.endpointToggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.querySelector('svg')).toBeTruthy()
    // 至少有两个 svg：折叠箭头 + 图钉
    expect(toggle.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
  })

  /**
   * 地址编辑 UI（Issue #183）。地址列表是唯一数据源：不再有单独的 URL 输入框
   * 与只读的主地址镜像 —— 那种「同一个值两个入口，一个能改一个不能」的结构
   * 本身就不合逻辑。
   */
  it('编辑表单里每一行地址都可编辑，顺序即优先级', async () => {
    const updateServerMock = vi.fn()
    const dualServer = {
      id: 'dual',
      name: 'Dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    }
    useServerStoreMock.mockReturnValue({
      servers: [dualServer],
      activeServer: dualServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: updateServerMock,
      setActiveServer: setActiveServerMock,
      setActiveEndpoint: setActiveEndpointMock,
      setLockedEndpoint: setLockedEndpointMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
      endpointStates: new Map(),
    })

    render(<ServersSettings />)

    fireEvent.click(screen.getByTitle('servers.editServer'))
    await waitFor(() => expect(screen.getByText('servers.endpointsLabel')).toBeTruthy())

    // 两行都在输入框里（包括主地址，它不再是只读镜像）
    const primaryInput = screen.getByDisplayValue('http://lan.test')
    const wanInput = screen.getByDisplayValue('https://wan.test')
    expect(primaryInput.tagName).toBe('INPUT')
    expect(wanInput.tagName).toBe('INPUT')

    // 主地址也能直接改
    fireEvent.change(primaryInput, { target: { value: 'http://lan2.test' } })

    // 再加一个
    fireEvent.click(screen.getByText('servers.endpointAdd'))
    const inputs = screen.getAllByLabelText(/servers\.endpointNth/)
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: 'https://tailscale.test' } })

    fireEvent.click(screen.getByText('common:save'))

    await waitFor(() => expect(updateServerMock).toHaveBeenCalled())
    const [, updates] = updateServerMock.mock.calls[0]!
    // url 跟随第一行；priority 按行号递增，支持任意层级
    expect(updates.url).toBe('http://lan2.test')
    expect(updates.endpoints).toEqual([
      { url: 'http://lan2.test', priority: 0 },
      { url: 'https://wan.test', priority: 1 },
      { url: 'https://tailscale.test', priority: 2 },
    ])
  })

  it('上移地址会改变优先级顺序', async () => {
    const updateServerMock = vi.fn()
    const dualServer = {
      id: 'dual',
      name: 'Dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    }
    useServerStoreMock.mockReturnValue({
      servers: [dualServer],
      activeServer: dualServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: updateServerMock,
      setActiveServer: setActiveServerMock,
      setActiveEndpoint: setActiveEndpointMock,
      setLockedEndpoint: setLockedEndpointMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
      endpointStates: new Map(),
    })

    render(<ServersSettings />)
    fireEvent.click(screen.getByTitle('servers.editServer'))
    await waitFor(() => expect(screen.getByText('servers.endpointsLabel')).toBeTruthy())

    // 第二行上移 → 成为主地址
    const upButtons = screen.getAllByTitle('servers.endpointMoveUp')
    fireEvent.click(upButtons[1]!)

    fireEvent.click(screen.getByText('common:save'))
    await waitFor(() => expect(updateServerMock).toHaveBeenCalled())
    const [, updates] = updateServerMock.mock.calls[0]!
    expect(updates.url).toBe('https://wan.test')
    expect(updates.endpoints).toEqual([
      { url: 'https://wan.test', priority: 0 },
      { url: 'http://lan.test', priority: 1 },
    ])
  })

  it('删到只剩一个地址时 endpoints 传 undefined（退回单地址语义）', async () => {
    const updateServerMock = vi.fn()
    const dualServer = {
      id: 'dual',
      name: 'Dual',
      url: 'http://lan.test',
      endpoints: [
        { url: 'http://lan.test', priority: 0 },
        { url: 'https://wan.test', priority: 1 },
      ],
    }
    useServerStoreMock.mockReturnValue({
      servers: [dualServer],
      activeServer: dualServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: updateServerMock,
      setActiveServer: setActiveServerMock,
      setActiveEndpoint: setActiveEndpointMock,
      setLockedEndpoint: setLockedEndpointMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
      endpointStates: new Map(),
    })

    render(<ServersSettings />)
    fireEvent.click(screen.getByTitle('servers.editServer'))
    await waitFor(() => expect(screen.getByText('servers.endpointsLabel')).toBeTruthy())

    // 删掉第二行，只剩主地址
    const removeButtons = screen.getAllByTitle('servers.endpointRemove')
    fireEvent.click(removeButtons[1]!)
    // 只剩一行时删除按钮禁用
    expect((screen.getByTitle('servers.endpointRemove') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText('common:save'))

    await waitFor(() => expect(updateServerMock).toHaveBeenCalled())
    const [, updates] = updateServerMock.mock.calls[0]!
    // 单地址不写 endpoints（保持旧行为），但字段必须显式出现才能清空
    expect('endpoints' in updates).toBe(true)
    expect(updates.endpoints).toBeUndefined()
    expect(updates.url).toBe('http://lan.test')
  })
})
