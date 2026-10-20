import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { DropdownMenu } from '../../../components/ui/DropdownMenu'
import { MenuItem } from '../../../components/ui/MenuItem'
import { TrashIcon, KeyIcon, PencilIcon, RetryIcon, PlugIcon, CircleIcon, QrCodeIcon, CheckIcon, PinIcon, PlusIcon, ArrowUpIcon, ArrowDownIcon, ChevronDownIcon, ChevronRightIcon } from '../../../components/Icons'
import { useServerStore, useRouter } from '../../../hooks'
import { messageStore } from '../../../store'
import { useMultiServerStore, multiServerStore } from '../../../store/multiServerStore'
import { useWslStore } from '../../../store/wslStore'
import { settingsFieldClass, SettingsSection, SettingRow, Toggle } from './SettingsUI'
import { ServerHealthButton } from './ServerHealthButton'
import { PairServerDialog } from './PairServerDialog'
import { PairScanDialog } from './PairScanDialog'
import { PairLinkField } from './PairLinkField'
import { usePairLinkRedeem } from './usePairLinkRedeem'
import type { ServerConfig, ServerEndpoint, ServerHealth, EndpointRuntime } from '../../../store/serverStore'
import { isTauri, getDesktopPlatform } from '../../../utils/tauri'
import { isLegacyPairingLink, parsePairingLink } from '../../../utils/pairing'
import { wslApi } from '../../../api/wsl'
import { DialogAddWslServer } from '../../wsl/components/DialogAddWslServer'
import { WslServerRow } from '../../wsl/components/WslServerRow'
import { isWslServerId } from '../../wsl/settings-model'

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/
/** 显示名长度上限，避免列表项把右侧操作按钮挤穿 */
const SERVER_NAME_MAX_LENGTH = 40

function isHttpsIpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    return parsed.protocol === 'https:' && (IPV4_PATTERN.test(hostname) || hostname.includes(':'))
  } catch {
    return false
  }
}

/**
 * 表单里编辑中的地址项。`id` 只是 React key，不落库——
 * 用下标当 key 在删除中间行时会让输入框内容错位。
 */
interface EditableEndpoint {
  id: number
  url: string
}

let editableEndpointSeq = 0

function toEditable(urls: string[]): EditableEndpoint[] {
  return urls.map(url => ({ id: ++editableEndpointSeq, url }))
}

/** 新建空地址行（添加表单初始状态 / 点「添加地址」） */
function blankEditable(): EditableEndpoint {
  return { id: ++editableEndpointSeq, url: '' }
}

/**
 * 从编辑中的列表提取有效地址：去空白、去尾部斜杠、按顺序去重。
 *
 * 返回顺序就是优先级顺序——用户排第几就是第几，不需要另一个字段表达。
 */
function collectEndpointUrls(items: EditableEndpoint[]): string[] {
  const urls: string[] = []
  for (const item of items) {
    const normalized = item.url.trim().replace(/\/+$/, '')
    if (normalized && !urls.includes(normalized)) urls.push(normalized)
  }
  return urls
}

/**
 * 把有序地址合成为落库的 endpoints。
 *
 * 只有一个地址时返回 undefined（退回单地址语义，不写多余字段）；
 * 多地址时逐条递增 priority —— 顺序即优先级，支持任意层级。
 */
function toServerEndpoints(urls: string[]): ServerEndpoint[] | undefined {
  if (urls.length <= 1) return undefined
  return urls.map((url, index) => ({ url, priority: index }))
}

/**
 * 地址列表编辑器（Issue #183）。
 *
 * **这是服务器地址的唯一数据源**：不再有一个单独的「URL」输入框与之并存。
 * 同一台服务器的多个入口在概念上就是一张有序列表，第一行即主地址
 * （同时写入 `server.url`，供旧逻辑与 SDK 兜底）。
 *
 * 顺序即优先级：只暴露「排第几」，不让用户手填 priority 数字。
 */
function EndpointListEditor({
  items,
  onChange,
  onPairLinkPasted,
}: {
  items: EditableEndpoint[]
  onChange: (next: EditableEndpoint[]) => void
  /**
   * 粘贴配对链接的拦截钩子：返回 true 表示已消费（走配对流程）。
   * 地址输入框现在是唯一的地址入口，配对链接可能被粘到这里，
   * 不认一下就会当成非法 URL 报错。
   */
  onPairLinkPasted?: (value: string) => boolean
}) {
  const { t } = useTranslation(['settings', 'common'])
  const inputCls = settingsFieldClass

  const update = (id: number, url: string) => {
    onChange(items.map(item => (item.id === id ? { ...item, url } : item)))
  }
  const remove = (id: number) => {
    // 至少保留一行：服务器必须有地址
    if (items.length <= 1) return
    onChange(items.filter(item => item.id !== id))
  }
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300">
          {t('servers.endpointsLabel')}
        </label>
        <button
          type="button"
          onClick={() => onChange([...items, blankEditable()])}
          className="flex items-center gap-1 text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 transition-colors"
        >
          <PlusIcon size={10} />
          {t('servers.endpointAdd')}
        </button>
      </div>

      {items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-1.5 min-w-0">
          <span
            className={`shrink-0 w-3 text-[length:var(--fs-xs)] ${index === 0 ? 'text-accent-main-100' : 'text-text-400'}`}
          >
            {index + 1}
          </span>
          <input
            type="text"
            value={item.url}
            onChange={e => {
              const value = e.target.value
              // 配对链接粘到地址框 → 交给配对流程，不当作普通地址
              if (onPairLinkPasted?.(value)) return
              update(item.id, value)
            }}
            placeholder={t('servers.urlPlaceholder')}
            className={`${inputCls} min-w-0 flex-1 font-mono`}
            aria-label={t('servers.endpointNth', { index: index + 1 })}
          />
          <button
            type="button"
            onClick={() => move(index, -1)}
            disabled={index === 0}
            title={t('servers.endpointMoveUp')}
            aria-label={t('servers.endpointMoveUp')}
            className="shrink-0 p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/70 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowUpIcon size={11} />
          </button>
          <button
            type="button"
            onClick={() => move(index, 1)}
            disabled={index === items.length - 1}
            title={t('servers.endpointMoveDown')}
            aria-label={t('servers.endpointMoveDown')}
            className="shrink-0 p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/70 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowDownIcon size={11} />
          </button>
          <button
            type="button"
            onClick={() => remove(item.id)}
            disabled={items.length <= 1}
            title={t('servers.endpointRemove')}
            aria-label={t('servers.endpointRemove')}
            className="shrink-0 p-1 rounded-md text-text-400 hover:text-danger-100 hover:bg-danger-bg/40 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-400"
          >
            <TrashIcon size={11} />
          </button>
        </div>
      ))}

      <p className="text-[length:var(--fs-xxs)] text-text-400 leading-relaxed">{t('servers.endpointOrderHint')}</p>
    </div>
  )
}

// ============================================
// Server Item
// ============================================

/**
 * 该服务器当前实际显示 / 使用的地址。
 *
 * activeUrl 优先（用户手动选过或自动探测选过），否则退回 endpoints 主地址
 * （priority 最小者），最后退回 `server.url`。与 serverStore.getActiveEndpointUrl
 * 同语义，但在设置页直接由快照算出，避免逐行调用 getter。
 */
function effectiveEndpointUrl(server: ServerConfig, state: Readonly<EndpointRuntime>): string {
  return state.activeUrl ?? server.endpoints?.[0]?.url ?? server.url
}

function ServerItem({
  server,
  health,
  isActive,
  subscribed,
  multiServerEnabled,
  endpointState,
  onSelect,
  onDelete,
  onEdit,
  onCheckHealth,
  onPair,
  onToggleSubscribe,
  onUseEndpoint,
  onLockEndpoint,
}: {
  server: ServerConfig
  health: ServerHealth | null
  isActive: boolean
  subscribed: boolean
  multiServerEnabled: boolean
  /** 多地址运行时状态（生效/锁定） */
  endpointState: Readonly<EndpointRuntime>
  onSelect: () => void
  onDelete: () => void
  onEdit: (updates: {
    name: string
    url: string
    username?: string
    password?: string
    endpoints?: ServerEndpoint[]
  }) => void
  onCheckHealth: () => void
  onPair: () => void
  onToggleSubscribe: () => void
  /** 切换生效地址（Issue #183） */
  onUseEndpoint: (url: string) => void
  /** 锁定到某地址；传 null 解除锁定 */
  onLockEndpoint: (url: string | null) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /**
   * 地址列表默认收起：一台服务器有四五个入口时，全展开会把卡片撑得比
   * 整个列表还高，其它服务器全被挤到屏幕外。收起时只留一行摘要
   * （当前生效地址 + 共几个），要换地址再点开。
   */
  const [showEndpoints, setShowEndpoints] = useState(false)

  if (editing) {
    return (
      <EditServerForm
        server={server}
        onSave={updates => {
          onEdit(updates)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <>
      <div
        onClick={onSelect}
        className={`group p-2.5 rounded-lg border transition-colors min-w-0
          ${
            isActive ? 'border-accent-main-100/40 bg-accent-main-100/5' : 'border-border-200/40 hover:border-border-300'
          }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onSelect()
          }}
          aria-current={isActive ? 'true' : undefined}
          className="min-w-0 flex-1 overflow-hidden bg-transparent border-none p-0 text-left"
        >
          <div className="min-w-0">
            <div
              className="text-[length:var(--fs-md)] font-medium text-text-100 truncate"
              title={server.name}
            >
              {server.name}
            </div>
            <div className="text-[length:var(--fs-xs)] text-text-400 truncate font-mono flex items-center gap-1 mt-0.5 min-w-0">
              <span className="truncate min-w-0" title={effectiveEndpointUrl(server, endpointState)}>
                {effectiveEndpointUrl(server, endpointState)}
              </span>
              {server.auth?.password && <KeyIcon size={10} className="shrink-0 text-text-400" />}
            </div>
          </div>
        </button>
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            disabled={!multiServerEnabled}
            onClick={e => {
              e.stopPropagation()
              onToggleSubscribe()
            }}
            title={
              !multiServerEnabled
                ? t('servers.enableMultiServerFirst', { defaultValue: 'Enable multi-server mode first' })
                : subscribed
                  ? t('servers.unsubscribe')
                  : t('servers.subscribe')
            }
            aria-label={subscribed ? t('servers.unsubscribe') : t('servers.subscribe')}
            className={`p-1.5 rounded-md transition-colors ${
              subscribed
                ? 'text-accent-main-100 hover:bg-accent-main-100/10'
                : 'text-text-400 hover:text-text-200 hover:bg-bg-200/70'
            } ${!multiServerEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {subscribed ? <PlugIcon size={13} /> : <CircleIcon size={11} className="opacity-50" />}
          </button>
          <ServerHealthButton health={health} onCheck={onCheckHealth} />
          <button
            type="button"
            className="p-1.5 rounded-md text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
            onClick={e => {
              e.stopPropagation()
              onPair()
            }}
            title={t('servers.pairServer')}
            aria-label={t('servers.pairServer')}
          >
            <QrCodeIcon size={13} />
          </button>
          {!server.isDefault && (
            <>
              <button
                type="button"
                className="p-1.5 rounded-md text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
                onClick={e => {
                  e.stopPropagation()
                  setEditing(true)
                }}
                title={t('servers.editServer')}
                aria-label={t('servers.editServer')}
              >
                <PencilIcon size={13} />
              </button>
              <button
                type="button"
                className="p-1.5 rounded-md text-text-400 hover:text-danger-100 hover:bg-danger-100/10 transition-colors"
                onClick={e => {
                  e.stopPropagation()
                  setConfirmDelete(true)
                }}
                title={t('common:remove')}
                aria-label={t('common:remove')}
              >
                <TrashIcon size={13} />
              </button>
            </>
          )}
        </div>
        </div>

        {/* 多地址列表（Issue #183）：仅当服务器配了 >1 个地址时出现，
            单地址用户看到的界面与旧版完全一致。
            默认收起——全展开时一张卡片能占掉半屏，其它服务器全被挤下去。 */}
        {server.endpoints && server.endpoints.length > 1 && (
          <div className="mt-2 pt-2 border-t border-border-200/40" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowEndpoints(!showEndpoints)}
              aria-expanded={showEndpoints}
              title={t('servers.endpointToggle', { count: server.endpoints.length })}
              className="w-full flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-md text-left
                text-text-400 hover:text-text-200 hover:bg-bg-200/70 transition-colors"
            >
              {showEndpoints ? (
                <ChevronDownIcon size={11} className="shrink-0" />
              ) : (
                <ChevronRightIcon size={11} className="shrink-0" />
              )}
              <span className="text-[length:var(--fs-xs)]">
                {t('servers.endpointCount', { count: server.endpoints.length })}
              </span>
              {/* 收起时也要能看出「手动锁定了某个地址」，否则用户会以为锁定丢了 */}
              {!showEndpoints && endpointState.lockedUrl && (
                <PinIcon size={10} className="shrink-0 text-accent-main-100" />
              )}
            </button>

            {showEndpoints && (
              <div className="mt-0.5 space-y-0.5">
                {server.endpoints.map(endpoint => {
                  const isCurrent = effectiveEndpointUrl(server, endpointState) === endpoint.url
                  const locked = endpointState.lockedUrl === endpoint.url
                  return (
                    <div key={endpoint.url} className="flex items-center gap-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => onUseEndpoint(endpoint.url)}
                        disabled={isCurrent}
                        title={isCurrent ? t('servers.endpointActive') : t('servers.endpointUse')}
                        className={`min-w-0 flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded-md text-left transition-colors
                          ${isCurrent ? 'text-accent-main-100' : 'text-text-300 hover:bg-bg-200/70'}`}
                      >
                        <span className="shrink-0 w-3">
                          {isCurrent && <CheckIcon size={11} />}
                        </span>
                        <span className="truncate min-w-0 font-mono text-[length:var(--fs-xs)]" title={endpoint.url}>
                          {endpoint.url}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onLockEndpoint(locked ? null : endpoint.url)}
                        title={locked ? t('servers.endpointUnlock') : t('servers.endpointLock')}
                        aria-label={locked ? t('servers.endpointUnlock') : t('servers.endpointLock')}
                        className={`shrink-0 p-1 rounded-md transition-colors ${
                          locked
                            ? 'text-accent-main-100 hover:bg-accent-main-100/10'
                            : 'text-text-400 hover:text-text-200 hover:bg-bg-200/70'
                        }`}
                      >
                        <PinIcon size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
        title={t('servers.deleteServer')}
        description={t('servers.deleteServerConfirm', { name: server.name })}
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />
    </>
  )
}

// ============================================
// Edit Server Form (inline)
// ============================================

function EditServerForm({
  server,
  onSave,
  onCancel,
}: {
  server: ServerConfig
  onSave: (updates: {
    name: string
    url: string
    username?: string
    password?: string
    endpoints?: ServerEndpoint[]
  }) => void
  onCancel: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [name, setName] = useState(server.name)
  /**
   * 地址列表（Issue #183）——**唯一的地址数据源**。
   *
   * 不再有单独的 URL 输入框：那会变成「同一个值两个入口，一个能改一个不能」。
   * 第一行即主地址（保存时同时写入 `server.url`），顺序即优先级。
   */
  const [endpoints, setEndpoints] = useState<EditableEndpoint[]>(() =>
    toEditable(
      server.endpoints?.length ? server.endpoints.map(endpoint => endpoint.url) : [server.url],
    ),
  )
  const [username, setUsername] = useState(server.auth?.username || '')
  const [password, setPassword] = useState(server.auth?.password || '')
  const [showAuth, setShowAuth] = useState(!!server.auth?.password)
  const [error, setError] = useState('')
  // 主地址 = 列表第一个有效项（校验与 URL 警告都看它）
  const primaryUrl = collectEndpointUrls(endpoints)[0] ?? ''
  const showHttpsIpWarning = isHttpsIpUrl(primaryUrl)

  // 与添加表单同一条配对链：重新扫码 / 粘贴 pair 链接兑换后回填地址与凭据，
  // 保存时才落库——适合换了端口 / 重装了服务端后原地更新连接配置
  const applyPairing = useCallback((pairedUrl: string, token: string, urls: string[]) => {
    // 配对拿到的地址集整组替换列表，第一个即主地址
    const ordered = [pairedUrl, ...urls].map(item => item.trim().replace(/\/+$/, '')).filter(Boolean)
    const unique = [...new Set(ordered)]
    setEndpoints(toEditable(unique.length > 0 ? unique : [pairedUrl]))
    setUsername('opencode')
    setPassword(token)
    setShowAuth(true)
    setName(previous => {
      if (previous.trim()) return previous
      try {
        return new URL(pairedUrl).hostname
      } catch {
        return previous
      }
    })
    setError('')
  }, [])
  const { pairLink, pairState, pairScanOpen, setPairScanOpen, handlePairLinkChange } = usePairLinkRedeem({
    onPaired: applyPairing,
    onInput: () => setError(''),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim().slice(0, SERVER_NAME_MAX_LENGTH)
    if (!trimmedName) {
      setError(t('servers.nameRequired'))
      return
    }
    const urls = collectEndpointUrls(endpoints)
    if (urls.length === 0) {
      setError(t('servers.urlRequired'))
      return
    }
    for (const candidate of urls) {
      try {
        new URL(candidate)
      } catch {
        setError(t('servers.invalidUrl'))
        return
      }
    }
    onSave({
      name: trimmedName,
      // 主地址写 url：旧逻辑、SDK 兜底、单地址界面都读它
      url: urls[0]!,
      username: password.trim() ? username.trim() || 'opencode' : undefined,
      password: password.trim() || undefined,
      endpoints: toServerEndpoints(urls),
    })
  }

  const inputCls = settingsFieldClass

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 rounded-lg border border-accent-main-100/30 bg-accent-main-100/[0.02] space-y-2.5"
    >
      <PairLinkField
        value={pairLink}
        state={pairState}
        onChange={handlePairLinkChange}
        onScan={() => setPairScanOpen(true)}
      />
      <div>
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.name')}</label>
        <input
          type="text"
          value={name}
          maxLength={SERVER_NAME_MAX_LENGTH}
          onChange={e => {
            setName(e.target.value.slice(0, SERVER_NAME_MAX_LENGTH))
            setError('')
          }}
          placeholder={t('servers.namePlaceholder')}
          className={inputCls}
          autoFocus
        />
      </div>
      <EndpointListEditor
        items={endpoints}
        onChange={setEndpoints}
        onPairLinkPasted={value => {
          if (!parsePairingLink(value) && !isLegacyPairingLink(value)) return false
          handlePairLinkChange(value)
          return true
        }}
      />

      <button
        type="button"
        onClick={() => setShowAuth(!showAuth)}
        className="flex items-center gap-1.5 text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 transition-colors"
      >
        <KeyIcon size={10} />
        {showAuth ? t('servers.hideAuth') : t('servers.addAuth')}
      </button>

      {showAuth && (
        <>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.username')}</label>
            <input
              type="text"
              value={username}
              onChange={e => {
                setUsername(e.target.value)
                setError('')
              }}
              placeholder={t('servers.usernamePlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder={t('servers.passwordPlaceholder')}
              className={inputCls}
            />
          </div>
        </>
      )}

      {showHttpsIpWarning && (
        <div className="text-[length:var(--fs-xs)] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
          {t('servers.httpsIpWarning')}
        </div>
      )}

      {error && <p className="text-[length:var(--fs-xs)] text-danger-100">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button type="submit" size="sm">
          {t('common:save')}
        </Button>
      </div>

      {/* 扫到码直接喂给 pair 链接的兑换链，和粘贴链接走同一条路径 */}
      <PairScanDialog
        isOpen={pairScanOpen}
        onClose={() => setPairScanOpen(false)}
        onScan={data => {
          setPairScanOpen(false)
          handlePairLinkChange(data)
        }}
      />
    </form>
  )
}

// ============================================
// Add Server Form
// ============================================

function AddServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, url: string, username?: string, password?: string, endpoints?: ServerEndpoint[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [name, setName] = useState('')
  const [endpoints, setEndpoints] = useState<EditableEndpoint[]>(() => [blankEditable()])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [error, setError] = useState('')
  // 主地址 = 列表第一个有效项
  const primaryUrl = collectEndpointUrls(endpoints)[0] ?? ''

  const applyPairing = useCallback((pairedUrl: string, token: string, urls: string[]) => {
    // 配对地址集整组替换列表，第一个即主地址
    const ordered = [pairedUrl, ...urls].map(item => item.trim().replace(/\/+$/, '')).filter(Boolean)
    const unique = [...new Set(ordered)]
    setEndpoints(toEditable(unique.length > 0 ? unique : [pairedUrl]))
    setUsername('opencode')
    setPassword(token)
    setShowAuth(true)
    setName(previous => {
      if (previous.trim()) return previous
      try {
        return new URL(pairedUrl).hostname
      } catch {
        return previous
      }
    })
    setError('')
  }, [])

  // 粘贴 pair 链接 / QR 载荷 → 防抖兑换 → 回填地址与凭据
  const { pairLink, pairState, pairScanOpen, setPairScanOpen, handlePairLinkChange } = usePairLinkRedeem({
    onPaired: applyPairing,
    onInput: () => setError(''),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim().slice(0, SERVER_NAME_MAX_LENGTH)
    if (!trimmedName) {
      setError(t('servers.nameRequired'))
      return
    }
    const urls = collectEndpointUrls(endpoints)
    if (urls.length === 0) {
      setError(t('servers.urlRequired'))
      return
    }
    for (const candidate of urls) {
      try {
        new URL(candidate)
      } catch {
        setError(t('servers.invalidUrl'))
        return
      }
    }

    onAdd(
      trimmedName,
      urls[0]!,
      password.trim() ? username.trim() || 'opencode' : undefined,
      password.trim() || undefined,
      toServerEndpoints(urls),
    )
  }

  const isCrossOrigin = (() => {
    if (!primaryUrl) return false
    try {
      const serverUrl = new URL(primaryUrl)
      return serverUrl.origin !== window.location.origin
    } catch {
      return false
    }
  })()
  const showHttpsIpWarning = isHttpsIpUrl(primaryUrl)

  const inputCls = settingsFieldClass

  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-lg border border-border-200 bg-bg-100 space-y-2.5">
      <PairLinkField
        value={pairLink}
        state={pairState}
        onChange={handlePairLinkChange}
        onScan={() => setPairScanOpen(true)}
      />
      <div>
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.name')}</label>
        <input
          type="text"
          value={name}
          maxLength={SERVER_NAME_MAX_LENGTH}
          onChange={e => {
            setName(e.target.value.slice(0, SERVER_NAME_MAX_LENGTH))
            setError('')
          }}
          placeholder={t('servers.namePlaceholder')}
          className={inputCls}
          autoFocus
        />
      </div>
      <EndpointListEditor
        items={endpoints}
        onChange={setEndpoints}
        onPairLinkPasted={value => {
          if (!parsePairingLink(value) && !isLegacyPairingLink(value)) return false
          handlePairLinkChange(value)
          return true
        }}
      />

      <button
        type="button"
        onClick={() => setShowAuth(!showAuth)}
        className="flex items-center gap-1.5 text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 transition-colors"
      >
        <KeyIcon size={10} />
        {showAuth ? t('servers.hideAuth') : t('servers.addAuth')}
      </button>

      {showAuth && (
        <>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.username')}</label>
            <input
              type="text"
              value={username}
              onChange={e => {
                setUsername(e.target.value)
                setError('')
              }}
              placeholder={t('servers.usernamePlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">{t('servers.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder={t('servers.passwordPlaceholder')}
              className={inputCls}
            />
          </div>

          {isCrossOrigin && password.trim() && (
            <div className="text-[length:var(--fs-xs)] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
              {t('servers.crossOriginWarning')}{' '}
              <a
                href="https://github.com/anomalyco/opencode/issues/10047"
                target="_blank"
                rel="noopener"
                className="underline hover:no-underline"
              >
                #10047
              </a>
            </div>
          )}

          <div className="text-[length:var(--fs-xs)] text-text-400 leading-relaxed">{t('servers.credentialsStorage')}</div>
        </>
      )}

      {showHttpsIpWarning && (
        <div className="text-[length:var(--fs-xs)] text-warning-100 bg-warning-bg border border-warning-100/20 rounded-md px-2.5 py-2 leading-relaxed">
          {t('servers.httpsIpWarning')}
        </div>
      )}

      {error && <p className="text-[length:var(--fs-xs)] text-danger-100">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button type="submit" size="sm">
          {t('common:add')}
        </Button>
      </div>

      {/* 扫到码直接喂给 pair 链接的兑换链，和粘贴链接走同一条路径 */}
      <PairScanDialog
        isOpen={pairScanOpen}
        onClose={() => setPairScanOpen(false)}
        onScan={data => {
          setPairScanOpen(false)
          handlePairLinkChange(data)
        }}
      />
    </form>
  )
}

// ============================================
// Tab: Servers
// ============================================

export function ServersSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const [addingServer, setAddingServer] = useState(false)
  const [addingWslServer, setAddingWslServer] = useState(false)
  const [pairingServer, setPairingServer] = useState<ServerConfig | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLButtonElement>(null)
  // portal 到 body 的菜单内容不在 addMenuRef 内，外部点击判定必须同时覆盖它，
  // 否则点击菜单项会被当作「点外面」立即关闭，onClick 永远收不到
  const addMenuContentRef = useRef<HTMLDivElement>(null)
  const isWindowsDesktop = isTauri() && getDesktopPlatform() === 'windows'
  const multiServerConfig = useMultiServerStore()
  const subscribedCount = multiServerConfig.subscribedServerIds.length
  const {
    servers,
    activeServer,
    addServer,
    removeServer,
    updateServer,
    setActiveServer,
    setActiveEndpoint,
    setLockedEndpoint,
    checkHealth,
    checkAllHealth,
    getHealth,
    endpointStates,
  } = useServerStore()
  const { navigateHome, sessionId: routeSessionId } = useRouter()
  const orderedServers = useMemo(() => {
    if (!activeServer) return servers
    const active = servers.find(s => s.id === activeServer.id)
    if (!active) return servers
    return [active, ...servers.filter(s => s.id !== active.id)]
  }, [servers, activeServer])

  // WSL 服务器统一由 wslStore 驱动渲染：就绪条目已同步进 serverStore（跟随上面的排序），
  // 未就绪条目只存在于 wslStore，追加在列表尾部。这样一台 WSL 服务器永远只有一张卡片
  const wslState = useWslStore()
  const wslItems = isWindowsDesktop ? (wslState?.servers ?? []).filter(s => isWslServerId(s.config.id)) : []
  const wslItemById = new Map(wslItems.map(item => [item.config.id, item]))
  const unreadyWslItems = wslItems.filter(item => !servers.some(s => s.id === item.config.id))

  useEffect(() => {
    checkAllHealth()
  }, [checkAllHealth])

  // WSL 按需预热（意图信号）：启动路径不做任何 WSL 探测，用户走到服务器
  // 设置页才补齐 runtime / 发行版列表 / 已添加服务器的 opencode 检查。
  // 后端命令幂等，状态已就位时零成本；失败静默（添加对话框自身的探测
  // 状态机兜底），不打扰页面
  useEffect(() => {
    if (!isWindowsDesktop) return
    void wslApi.prewarm().catch(err => console.error('WSL prewarm failed:', err))
  }, [isWindowsDesktop])

  // M3: 下拉菜单外部点击关闭（trigger 与 portal 菜单内容都算「里面」）
  useEffect(() => {
    if (!addMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (addMenuRef.current?.contains(target) || addMenuContentRef.current?.contains(target)) return
      setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addMenuOpen])

  // 切换服务器：设置 active + 清理当前 session + 导航回首页
  const handleSelectServer = useCallback(
    (id: string) => {
      if (activeServer?.id === id) return // 没变，不做事

      // 清理当前 session 的 store 状态
      if (routeSessionId) {
        messageStore.clearSession(routeSessionId)
      }

      setActiveServer(id) // 内部触发 serverChangeListeners → reconnectSSE()
      navigateHome()
      void checkHealth(id)
    },
    [activeServer?.id, checkHealth, routeSessionId, setActiveServer, navigateHome],
  )

  return (
    <>
      <SettingsSection
        title={t('servers.multiServerMode', { defaultValue: 'Multi-server mode' })}
        description={t('servers.multiServerModeDesc', {
          defaultValue:
            'Subscribe to multiple servers at once. Sidebar session list is grouped by server, and you can interact with sessions on any connected server simultaneously.',
        })}
      >
        <SettingRow
          label={t('servers.multiServerMode', { defaultValue: 'Multi-server mode' })}
          description={
            multiServerConfig.enabled
              ? t('servers.subscribedCountHint', {
                  defaultValue: '{{count}} servers subscribed. Use the plug icon on each server to join/leave the whitelist.',
                  count: subscribedCount,
                })
              : t('servers.multiServerModeOffHint', {
                  defaultValue: 'Only the servers you subscribe to appear in the sidebar session list.',
                })
          }
        >
          <Toggle
            enabled={multiServerConfig.enabled}
            onChange={() => multiServerStore.setEnabled(!multiServerConfig.enabled)}
            ariaLabel={t('servers.multiServerMode', { defaultValue: 'Multi-server mode' })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('servers.connections')}
        description={t('servers.connectionsDesc')}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={checkAllHealth}
              className="flex items-center justify-center w-7 h-7 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/70 transition-colors"
              title={t('common:refresh')}
              aria-label={t('common:refresh')}
            >
              <RetryIcon size={14} />
            </button>
            {isWindowsDesktop ? (
              <div className="relative">
                <button
                  ref={addMenuRef}
                  onClick={() => setAddMenuOpen(!addMenuOpen)}
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  className="h-7 px-2.5 rounded-md text-[length:var(--fs-sm)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
                >
                  {t('common:add')} ▾
                </button>
                {/* 设置弹窗本身是 z-[300]，portal 到 body 的菜单默认 zIndex=100 会被压在下面（看起来点了没反应） */}
                <DropdownMenu triggerRef={addMenuRef} isOpen={addMenuOpen} align="right" zIndex={400}>
                  <div ref={addMenuContentRef}>
                    <MenuItem
                      label={t('servers.addRemote')}
                      onClick={() => { setAddMenuOpen(false); setAddingServer(true) }}
                    />
                    <MenuItem
                      label={t('servers.addWsl')}
                      onClick={() => { setAddMenuOpen(false); setAddingWslServer(true) }}
                    />
                  </div>
                </DropdownMenu>
              </div>
            ) : (
              <button
                onClick={() => setAddingServer(true)}
                disabled={addingServer}
                className="h-7 px-2.5 rounded-md text-[length:var(--fs-sm)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors disabled:opacity-40"
              >
                {t('common:add')}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-1.5">
          {orderedServers.map(s => {
            if (isWslServerId(s.id)) {
              const item = wslItemById.get(s.id)
              // wsl 条目必须由 wslStore 状态驱动渲染；状态未到达时跳过，
              // 避免出现没有生命周期管理能力的孤立连接条目
              if (!item) return null
              return (
                <WslServerRow
                  key={s.id}
                  item={item}
                  health={getHealth(s.id)}
                  isActive={activeServer?.id === s.id}
                  subscribed={multiServerStore.isSubscribed(s.id)}
                  multiServerEnabled={multiServerConfig.enabled}
                  onSelect={() => handleSelectServer(s.id)}
                  onCheckHealth={() => void checkHealth(s.id)}
                  onToggleSubscribe={() => multiServerStore.setSubscribed(s.id, !multiServerStore.isSubscribed(s.id))}
                />
              )
            }
            return (
              <ServerItem
                key={s.id}
                server={s}
                health={getHealth(s.id)}
                isActive={activeServer?.id === s.id}
                subscribed={multiServerStore.isSubscribed(s.id)}
                multiServerEnabled={multiServerConfig.enabled}
                onSelect={() => handleSelectServer(s.id)}
                onDelete={() => {
                  // 删除服务器时同步移出多服务器白名单（避免残留订阅连到已删地址）
                  if (multiServerStore.isSubscribed(s.id)) {
                    multiServerStore.setSubscribedServerIds(
                      multiServerStore.getSubscribedServerIds().filter(id => id !== s.id),
                    )
                  }
                  removeServer(s.id)
                }}
                onEdit={updates => {
                  const auth = updates.password
                    ? { username: updates.username || 'opencode', password: updates.password }
                    : undefined
                  updateServer(s.id, { name: updates.name, url: updates.url, auth, endpoints: updates.endpoints })
                  void checkHealth(s.id)
                }}
                onCheckHealth={() => void checkHealth(s.id)}
                onPair={() => setPairingServer(s)}
                onToggleSubscribe={() => multiServerStore.setSubscribed(s.id, !multiServerStore.isSubscribed(s.id))}
                endpointState={endpointStates.get(s.id) ?? { activeUrl: null, lockedUrl: null, lastSwitchAt: 0 }}
                onUseEndpoint={url => setActiveEndpoint(s.id, url)}
                onLockEndpoint={url => setLockedEndpoint(s.id, url)}
              />
            )
          })}

          {/* 未就绪的 WSL 服务器（starting/failed/stopped）不在连接列表里，同样以卡片形态展示 */}
          {unreadyWslItems.map(item => (
            <WslServerRow
              key={item.config.id}
              item={item}
              health={null}
              isActive={false}
              subscribed={false}
              multiServerEnabled={multiServerConfig.enabled}
              onSelect={() => handleSelectServer(item.config.id)}
              onToggleSubscribe={() => multiServerStore.setSubscribed(item.config.id, true)}
            />
          ))}

        {addingServer && (
          <AddServerForm
            onAdd={(n, u, user, pass, endpoints) => {
              const auth = pass ? { username: user || 'opencode', password: pass } : undefined
              const s = addServer({ name: n, url: u, auth, endpoints })
              setAddingServer(false)
              void checkHealth(s.id)
            }}
            onCancel={() => setAddingServer(false)}
          />
        )}

        {servers.length === 0 && unreadyWslItems.length === 0 && !addingServer && (
          <div className="text-[length:var(--fs-md)] text-text-400 text-center py-8">{t('servers.noServersConfigured')}</div>
        )}
      </div>
      </SettingsSection>

      <DialogAddWslServer
        isOpen={addingWslServer}
        onClose={() => setAddingWslServer(false)}
        onAdded={() => void checkAllHealth()}
      />

      <PairServerDialog server={pairingServer} onClose={() => setPairingServer(null)} />
    </>
  )
}
