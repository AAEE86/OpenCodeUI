/**
 * 配对链接输入框（含扫码入口与兑换状态提示）。
 * 添加 / 编辑服务器表单共用；扫码结果由调用方喂回 onChange，
 * 与粘贴链接走同一条兑换链。
 */

import { useTranslation } from 'react-i18next'
import { ScanLineIcon } from '../../../components/Icons'
import { settingsFieldClass } from './SettingsUI'
import type { PairRedeemState } from './usePairLinkRedeem'

export function PairLinkField({
  value,
  state,
  onChange,
  onScan,
}: {
  value: string
  state: PairRedeemState
  onChange: (value: string) => void
  onScan: () => void
}) {
  const { t } = useTranslation(['settings'])
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-[length:var(--fs-xs)] font-medium text-text-300">{t('servers.pairLink')}</label>
        {/* 非安全上下文（http 自部署）没有摄像头 API，直接不显示入口 */}
        {typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (
          <button
            type="button"
            onClick={onScan}
            title={t('servers.scanQr')}
            aria-label={t('servers.scanQr')}
            className="p-1 rounded-md text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
          >
            <ScanLineIcon size={13} />
          </button>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={t('servers.pairLinkPlaceholder')}
        className={`${settingsFieldClass} font-mono`}
      />
      {state.kind !== 'idle' && (
        <p
          className={`mt-1 text-[length:var(--fs-xs)] leading-relaxed ${
            state.kind === 'paired'
              ? 'text-success-100'
              : state.kind === 'redeeming'
                ? 'text-text-400'
                : 'text-danger-100'
          }`}
        >
          {state.kind === 'redeeming' && t('servers.pairRedeeming')}
          {state.kind === 'paired' && t('servers.pairPaired')}
          {state.kind === 'expired' && t('servers.pairExpired')}
          {state.kind === 'unreachable' && t('servers.pairUnreachable')}
          {state.kind === 'mixedContent' && t('servers.pairMixedContent')}
          {state.kind === 'legacy' && t('servers.pairLegacy')}
        </p>
      )}
    </div>
  )
}
