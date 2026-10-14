import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { DownloadIcon, ExternalLinkIcon, RetryIcon, UploadIcon } from '../../../components/Icons'
import { hasUpdateAvailable, updateStore, useUpdateStore, RELEASES_PAGE_URL } from '../../../store/updateStore'
import { saveData } from '../../../utils/downloadUtils'
import { exportSettingsBackup, importSettingsBackup, previewBackupMeta } from '../../../utils/settingsBackup'
import { openExternalUrl } from '../../../utils/externalUrl'
import { readBootLog } from '../../../utils/bootLog'
import { SettingsSection } from './SettingsUI'

const BOOT_LOG_KEY = 'ocui.bootLog'

export function AboutSettings() {
  const { t } = useTranslation(['settings'])
  const updateState = useUpdateStore()
  const hasUpdate = hasUpdateAvailable(updateState)
  const latestRelease = updateState.latestRelease
  const latestVersion = latestRelease?.tagName || t('about.unknownVersion')
  const releaseDate = latestRelease?.publishedAt ? new Date(latestRelease.publishedAt).toLocaleString() : null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const handleCheckUpdates = useCallback(() => {
    void updateStore.checkForUpdates({ force: true })
  }, [])

  const handleOpenRelease = useCallback(() => {
    const targetUrl = latestRelease?.url || RELEASES_PAGE_URL
    updateStore.hideToastForCurrentVersion()
    void openExternalUrl(targetUrl)
  }, [latestRelease?.url])

  const handleExportBackup = useCallback(async () => {
    setBackupError(null)
    setBackupBusy('export')
    try {
      const { fileName, data } = await exportSettingsBackup()
      saveData(data, fileName, 'application/json;charset=utf-8')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : t('about.backupExportFailed'))
    } finally {
      setBackupBusy(null)
    }
  }, [t])

  const handleImportClick = useCallback(() => {
    setBackupError(null)
    fileInputRef.current?.click()
  }, [])

  const handleImportBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setBackupError(null)
      setBackupBusy('import')

      try {
        const { createdAt } = await previewBackupMeta(file)
        const confirmed = window.confirm(
          createdAt
            ? t('about.backupImportConfirmWithDate', { date: new Date(createdAt).toLocaleString() })
            : t('about.backupImportConfirm'),
        )
        if (!confirmed) return

        await importSettingsBackup(file)
        window.location.reload()
      } catch (error) {
        setBackupError(error instanceof Error ? error.message : t('about.backupImportFailed'))
      } finally {
        setBackupBusy(null)
      }
    },
    [t],
  )

  let statusText = t('about.statusIdle')
  if (updateState.checking) {
    statusText = t('about.statusChecking')
  } else if (updateState.error) {
    statusText = t('about.statusError', { error: updateState.error })
  } else if (hasUpdate) {
    statusText = t('about.statusUpdateAvailable', { version: latestVersion })
  } else if (latestRelease) {
    statusText = t('about.statusUpToDate')
  }

  return (
    <div>
      <SettingsSection title={t('about.versionCardTitle')} description={t('about.versionCardDesc')}>
        <div className="divide-y divide-border-200/35">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="text-[length:var(--fs-sm)] text-text-300">{t('about.currentVersion')}</div>
            <div className="shrink-0 text-[length:var(--fs-sm)] font-semibold text-text-100 font-mono tabular-nums">
              v{updateState.currentVersion}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="text-[length:var(--fs-sm)] text-text-300">{t('about.latestVersion')}</div>
            <div className="shrink-0 text-[length:var(--fs-sm)] font-semibold text-text-100 font-mono tabular-nums">{latestVersion}</div>
          </div>
        </div>

        <div className="min-w-0 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
          <div className="break-words font-medium text-text-100">{statusText}</div>
          {releaseDate && <div className="mt-1 text-text-400">{t('about.publishedAt', { date: releaseDate })}</div>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" isLoading={updateState.checking} onClick={handleCheckUpdates}>
            {!updateState.checking && <RetryIcon size={12} />}
            {t('about.checkNow')}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleOpenRelease}>
            <ExternalLinkIcon size={12} />
            {hasUpdate ? t('about.viewUpdate') : t('about.openReleases')}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title={t('about.backupCardTitle')} description={t('about.backupCardDesc')}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportBackup}
          className="hidden"
        />
        <div className="rounded-lg bg-warning-bg/40 border border-warning-100/20 px-3.5 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
          {t('about.backupWarning')}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" isLoading={backupBusy === 'export'} onClick={handleExportBackup}>
            {backupBusy !== 'export' && <DownloadIcon size={12} />}
            {t('about.exportBackup')}
          </Button>
          <Button size="sm" variant="ghost" isLoading={backupBusy === 'import'} onClick={handleImportClick}>
            {backupBusy !== 'import' && <UploadIcon size={12} />}
            {t('about.importBackup')}
          </Button>
        </div>

        {backupError && (
          <div className="min-w-0 break-all rounded-lg bg-danger-100/10 border border-danger-100/20 px-3.5 py-2.5 text-[length:var(--fs-sm)] text-danger-100 leading-relaxed">
            {backupError}
          </div>
        )}
      </SettingsSection>

      <DiagnosticsSection t={t} />
    </div>
  )
}

/** 启动记录诊断：区分「渲染层闪烁」与「整页重载」（iOS 白闪排查用） */
function DiagnosticsSection({ t }: { t: (key: string) => string }) {
  const [bootLog, setBootLog] = useState<number[]>(() => readBootLog())

  const handleClear = useCallback(() => {
    try {
      localStorage.removeItem(BOOT_LOG_KEY)
    } catch {
      // 忽略
    }
    setBootLog([])
  }, [])

  return (
    <SettingsSection title={t('about.diagnosticsTitle')} description={t('about.diagnosticsDesc')}>
      {bootLog.length === 0 ? (
        <div className="text-[length:var(--fs-sm)] text-text-400">{t('about.bootLogEmpty')}</div>
      ) : (
        <div className="max-h-40 overflow-y-auto custom-scrollbar font-mono text-[length:var(--fs-xs)] text-text-300 space-y-0.5">
          {[...bootLog].reverse().map((timestamp, index) => (
            <div key={`${timestamp}-${index}`} className="tabular-nums">
              {new Date(timestamp).toLocaleString()}
            </div>
          ))}
        </div>
      )}
      {bootLog.length > 0 && (
        <div className="flex">
          <Button size="sm" variant="ghost" onClick={handleClear}>
            {t('about.bootLogClear')}
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
