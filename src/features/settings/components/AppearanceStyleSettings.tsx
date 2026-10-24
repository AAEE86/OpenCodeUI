import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { SegmentedControl, SettingField, SettingRow, Toggle } from './SettingsUI'
import { useTheme } from '../../../hooks'
import type { AppearanceStyle, WallpaperFit } from '../../../store/themeStore'

/**
 * 外观处理与壁纸。
 *
 * 不做效果预览卡：预览和真实渲染容易对不上，直接切了看实际界面。
 */
export function AppearanceStyleSettings() {
  const { t } = useTranslation('settings')
  const {
    isDark,
    appearanceStyle,
    setAppearanceStyle,
    glassAlpha,
    setGlassAlpha,
    wallpaperEnabled,
    setWallpaperEnabled,
    wallpaperFit,
    setWallpaperFit,
    wallpaperInChat,
    setWallpaperInChat,
    wallpaperFileName,
    wallpaperUrl,
    setWallpaperImage,
  } = useTheme()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const isGlass = appearanceStyle === 'glass'

  const handleFile = async (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return
    setBusy(true)
    try {
      await setWallpaperImage(file, file.name)
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleClear = async () => {
    setBusy(true)
    try {
      await setWallpaperImage(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <SegmentedControl<AppearanceStyle>
        value={appearanceStyle}
        options={[
          { value: 'default', label: t('appearance.styleDefault') },
          { value: 'glass', label: t('appearance.styleGlass') },
        ]}
        onChange={setAppearanceStyle}
      />

      {isGlass && (
        <div className="space-y-4 rounded-xl border border-border-200/50 bg-bg-100/30 p-3">
          {!isDark && (
            <p className="text-[length:var(--fs-xs)] text-text-400">{t('appearance.glassLightNote')}</p>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[length:var(--fs-md)] text-text-100">{t('appearance.glassAlpha')}</p>
              <span className="text-[length:var(--fs-xs)] tabular-nums text-text-500">
                {Math.round(glassAlpha * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.01}
              value={glassAlpha}
              disabled={!isDark}
              onChange={e => setGlassAlpha(Number(e.target.value))}
              className="w-full accent-[hsl(var(--accent-main-100))] disabled:opacity-40"
              aria-label={t('appearance.glassAlpha')}
            />
            <p className="mt-1 text-[length:var(--fs-xs)] text-text-500">{t('appearance.glassAlphaDesc')}</p>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="h-16 w-24 shrink-0 overflow-hidden rounded-md border border-border-200/60 bg-bg-200/40 bg-cover bg-center"
              style={wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})` } : undefined}
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="truncate text-[length:var(--fs-sm)] text-text-300">
                {wallpaperFileName || t('appearance.wallpaperNoImage')}
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => void handleFile(e.target.files?.[0] ?? null)}
                />
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  {wallpaperUrl ? t('appearance.wallpaperChange') : t('appearance.wallpaperChoose')}
                </Button>
                {wallpaperUrl && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void handleClear()}>
                    {t('appearance.wallpaperClear')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {wallpaperUrl && (
            <>
              <SettingRow
                label={t('appearance.wallpaperEnabled')}
                description={t('appearance.wallpaperEnabledDesc')}
                onClick={() => setWallpaperEnabled(!wallpaperEnabled)}
              >
                <Toggle enabled={wallpaperEnabled} onChange={() => setWallpaperEnabled(!wallpaperEnabled)} />
              </SettingRow>

              <SettingRow
                label={t('appearance.wallpaperInChat')}
                description={t('appearance.wallpaperInChatDesc')}
                onClick={() => setWallpaperInChat(!wallpaperInChat)}
              >
                <Toggle enabled={wallpaperInChat} onChange={() => setWallpaperInChat(!wallpaperInChat)} />
              </SettingRow>

              <SettingField label={t('appearance.wallpaperFit')}>
                <SegmentedControl<WallpaperFit>
                  value={wallpaperFit}
                  options={[
                    { value: 'cover', label: t('appearance.wallpaperFitCover') },
                    { value: 'contain', label: t('appearance.wallpaperFitContain') },
                  ]}
                  onChange={setWallpaperFit}
                />
              </SettingField>
            </>
          )}
        </div>
      )}
    </div>
  )
}
