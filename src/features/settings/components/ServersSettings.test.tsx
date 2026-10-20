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
})
