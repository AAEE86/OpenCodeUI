import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { CopyIcon, CheckIcon, RetryIcon, TrashIcon, SpinnerIcon } from '../../../components/Icons'
import { LOCAL_SERVER_ID } from '../../../store/serverStore'
import { serviceStore } from '../../../store/serviceStore'
import { applyLocalServiceUrl } from '../../../utils/localServiceUrl'
import { copyTextToClipboard } from '../../../utils/clipboard'
import { settingsFieldClass, SettingField, SettingRow, Toggle } from './SettingsUI'
import { useServerStore } from '../../../hooks'

// ============================================
// 后台服务配置面板（桌面端专属）
//
// 等价于官方 CLI 的 `opencode service set/unset`：改的是
// ~/.config/opencode/service.json，应用后服务自动重启，Rust 侧回传
// 注册表里的最新 url/随机密码并写回本机条目（重启后两者都可能变）。
// ============================================

interface ServiceConfigSnapshot {
  disabled: boolean
  remote: boolean
  hostname?: string | null
  port?: number | null
  fixedPassword: boolean
  cors: string[]
  path?: string | null
}

interface ServiceApplyResult {
  url?: string | null
  password?: string | null
  running: boolean
}

export function ServiceConfigPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const { servers } = useServerStore()
  const localServer = servers.find(server => server.id === LOCAL_SERVER_ID)

  const [snapshot, setSnapshot] = useState<ServiceConfigSnapshot | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [hostnameInput, setHostnameInput] = useState('')
  const [portInput, setPortInput] = useState('')
  const [corsRows, setCorsRows] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const config = await invoke<ServiceConfigSnapshot>('opencode_service_config')
    setSnapshot(config)
    setHostnameInput(config.hostname ?? '')
    setPortInput(config.port != null ? String(config.port) : '')
    setCorsRows(config.cors)
  }, [])

  useEffect(() => {
    load().catch(e => setError(String(e)))
  }, [load])

  // set/unset 之后服务被重启：注册表里的 url/随机密码都回传并写回本机条目
  const apply = async (busy: string, action: () => Promise<ServiceApplyResult>) => {
    setBusyKey(busy)
    setError('')
    try {
      const result = await action()
      applyLocalServiceUrl(result.url, result.password)
      serviceStore.setRunning(result.running)
      serviceStore.setManaged(true)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyKey(null)
    }
  }

  const invokeSet = (key: string, value: string) => async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ServiceApplyResult>('opencode_service_set', {
      binaryPath: serviceStore.effectiveBinaryPath,
      key,
      value,
      envVars: serviceStore.envVarsRecord,
    })
  }

  const invokeUnset = (key: string) => async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ServiceApplyResult>('opencode_service_unset', {
      binaryPath: serviceStore.effectiveBinaryPath,
      key,
      envVars: serviceStore.envVarsRecord,
    })
  }

  const handleRemoteToggle = () => {
    if (!snapshot) return
    void apply('remote', invokeSet('remote', snapshot.remote ? 'false' : 'true'))
  }

  const handleHostnameApply = () => {
    const value = hostnameInput.trim()
    void apply('hostname', value ? invokeSet('hostname', value) : invokeUnset('hostname'))
  }

  const handlePortApply = () => {
    const value = portInput.trim()
    if (!value) {
      void apply('port', invokeUnset('port'))
      return
    }
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('service.invalidPort'))
      return
    }
    void apply('port', invokeSet('port', String(port)))
  }

  const handleCorsApply = () => {
    const origins = corsRows.map(row => row.trim()).filter(Boolean)
    void apply('cors', origins.length > 0 ? invokeSet('cors', origins.join(',')) : invokeUnset('cors'))
  }

  const handleRegeneratePassword = () => {
    // unset password → 下次启动生成新的随机密码（旧 token 全部失效，
    // 注册表里的新密码由 apply 写回本机条目）
    void apply('password', invokeUnset('password'))
  }

  const handleCopyPassword = () => {
    const password = localServer?.auth?.password
    if (!password) return
    void copyTextToClipboard(password)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  if (!snapshot) {
    return error ? (
      <div className="text-[length:var(--fs-sm)] text-danger-100 bg-danger-100/10 border border-danger-100/20 rounded-lg px-3 py-2.5 leading-relaxed break-all">
        {error}
      </div>
    ) : null
  }

  const busy = busyKey !== null

  return (
    <>
      <div className="pt-2 mt-2 border-t border-border-200/40">
        <div className="text-[length:var(--fs-sm)] font-medium text-text-200">{t('service.configTitle')}</div>
        <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 leading-relaxed">{t('service.configDesc')}</div>
      </div>

      <SettingRow
        label={t('service.remoteAccess')}
        description={
          busyKey === 'remote' && !snapshot.remote
            ? t('service.remoteEnabling')
            : t('service.remoteAccessDesc')
        }
        onClick={busy ? undefined : handleRemoteToggle}
      >
        {busyKey === 'remote' ? (
          <SpinnerIcon size={14} className="animate-spin text-text-400" />
        ) : (
          <Toggle enabled={snapshot.remote} onChange={handleRemoteToggle} disabled={busy} />
        )}
      </SettingRow>

      <SettingField label={t('service.hostname')} description={t('service.hostnameDesc')}>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={hostnameInput}
            onChange={e => setHostnameInput(e.target.value)}
            placeholder="127.0.0.1"
            disabled={busy}
            className={`${settingsFieldClass} min-w-0 flex-1 font-mono`}
          />
          <Button size="sm" variant="ghost" onClick={handleHostnameApply} disabled={busy}>
            {t('common:save')}
          </Button>
        </div>
      </SettingField>

      <SettingField label={t('service.port')} description={t('service.portDesc')}>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            value={portInput}
            onChange={e => setPortInput(e.target.value)}
            placeholder="49374"
            disabled={busy}
            className={`${settingsFieldClass} min-w-0 flex-1 font-mono`}
          />
          <Button size="sm" variant="ghost" onClick={handlePortApply} disabled={busy}>
            {t('common:save')}
          </Button>
        </div>
      </SettingField>

      <SettingField
        label={t('service.corsOrigins')}
        description={t('service.corsDesc')}
        actions={
          <button
            type="button"
            className="h-7 px-2 rounded-md text-[length:var(--fs-xs)] font-medium text-accent-main-100 hover:bg-accent-main-100/10 transition-colors disabled:opacity-50"
            onClick={() => setCorsRows([...corsRows, ''])}
            disabled={busy}
          >
            + {t('common:add')}
          </button>
        }
      >
        {corsRows.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {corsRows.map((origin, idx) => (
              <div key={idx} className="flex min-w-0 items-center gap-1.5">
                <input
                  type="text"
                  value={origin}
                  onChange={e => {
                    const updated = [...corsRows]
                    updated[idx] = e.target.value
                    setCorsRows(updated)
                  }}
                  placeholder={t('service.originPlaceholder')}
                  disabled={busy}
                  className={`${settingsFieldClass} min-w-0 flex-1 font-mono text-[length:var(--fs-xs)]`}
                />
                <button
                  type="button"
                  className="shrink-0 w-8 h-8 flex items-center justify-center text-text-400 hover:text-danger-100
                    hover:bg-danger-100/10 rounded-lg transition-colors"
                  onClick={() => setCorsRows(corsRows.filter((_, i) => i !== idx))}
                  disabled={busy}
                  title={t('common:remove')}
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" onClick={handleCorsApply} disabled={busy}>
                {busyKey === 'cors' ? <SpinnerIcon size={12} className="animate-spin mr-1" /> : null}
                {t('common:save')}
              </Button>
            </div>
          </div>
        )}
        {corsRows.length === 0 && (
          <div>
            <Button size="sm" variant="ghost" onClick={handleCorsApply} disabled={busy || snapshot.cors.length === 0}>
              {t('common:save')}
            </Button>
          </div>
        )}
      </SettingField>

      <SettingRow
        label={t('service.passwordLabel')}
        description={snapshot.fixedPassword ? t('service.passwordFixed') : t('service.passwordRandom')}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="p-1.5 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200/70 transition-colors disabled:opacity-40"
            onClick={handleCopyPassword}
            disabled={!localServer?.auth?.password}
            title={t('service.copyPassword')}
            aria-label={t('service.copyPassword')}
          >
            {copied ? <CheckIcon size={13} className="text-success-100" /> : <CopyIcon size={13} />}
          </button>
          <Button size="sm" variant="ghost" onClick={handleRegeneratePassword} disabled={busy}>
            {busyKey === 'password' ? (
              <SpinnerIcon size={12} className="animate-spin mr-1" />
            ) : (
              <RetryIcon size={12} className="mr-1" />
            )}
            {t('service.regeneratePassword')}
          </Button>
        </div>
      </SettingRow>

      {error && (
        <div className="text-[length:var(--fs-sm)] text-danger-100 bg-danger-100/10 border border-danger-100/20 rounded-lg px-3 py-2.5 leading-relaxed break-all">
          {error}
        </div>
      )}
    </>
  )
}
