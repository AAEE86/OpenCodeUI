import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { QrCode } from '../../../components/ui/QrCode'
import { CopyIcon, CheckIcon, RetryIcon } from '../../../components/Icons'
import { getSDKClient } from '../../../api/sdk'
import { copyTextToClipboard } from '../../../utils/clipboard'
import type { ServerConfig } from '../../../store/serverStore'

// ============================================
// 服务器配对 Dialog（v2 服务端 v2.0.17+ 的 POST /api/pair）
//
// 生成一次性配对码并展示链接 + 二维码，对齐 `opencode pair` 的输出：
//   - 链接 = <url>/auth/connect/<code>，覆盖 server.info().urls 的每个地址
//   - 二维码载荷 = {"code","urls"} JSON，只含非回环地址（官方 CLI 同款：
//     回环地址对扫码设备没用）
//   - code 5 分钟内有效且一次性：倒计时展示，过期可一键重新生成
// ============================================

interface PairServerDialogProps {
  /** null = 关闭 */
  server: ServerConfig | null
  onClose: () => void
}

type PairState =
  | { kind: 'loading' }
  | { kind: 'ready'; code: string; expiresAt: number; urls: string[] }
  | { kind: 'error' }

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.startsWith('127.') || hostname === '[::1]'
  )
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function PairServerDialog({ server, onClose }: PairServerDialogProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [state, setState] = useState<PairState>({ kind: 'loading' })
  const [now, setNow] = useState(() => Date.now())
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const requestSeqRef = useRef(0)
  const serverId = server?.id

  // 异步取数本身不含同步 setState（全部在 await 之后），供 effect 直接调用；
  // 手动「重新生成」走 regenerate，先在事件处理器里同步切到 loading。
  const fetchPairing = useCallback(async () => {
    if (!serverId) return
    const seq = ++requestSeqRef.current
    try {
      const client = getSDKClient(serverId)
      const [pairing, info] = await Promise.all([client.server.pair(), client.server.info()])
      if (requestSeqRef.current !== seq) return
      setState({
        kind: 'ready',
        code: pairing.code,
        expiresAt: Date.now() + pairing.expires_in * 1000,
        urls: info.urls,
      })
    } catch {
      if (requestSeqRef.current !== seq) return
      setState({ kind: 'error' })
    }
  }, [serverId])

  const regenerate = () => {
    setState({ kind: 'loading' })
    void fetchPairing()
  }

  // 打开/换服务器时生成；卸载时使在途请求失效
  useEffect(() => {
    if (!serverId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 弹窗打开时拉取配对码，setState 全部在 await 之后
    void fetchPairing()
    return () => {
      requestSeqRef.current += 1
    }
  }, [serverId, fetchPairing])

  // 倒计时（仅在展示时滴答）
  const ready = state.kind === 'ready' ? state : undefined
  const remainingMs = ready ? ready.expiresAt - now : 0
  const expired = ready !== undefined && remainingMs <= 0
  useEffect(() => {
    if (!ready || expired) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ready, expired])

  const handleCopy = useCallback((text: string, index: number) => {
    void copyTextToClipboard(text)
      .then(() => {
        setCopiedIndex(index)
        setTimeout(() => setCopiedIndex(current => (current === index ? null : current)), 1500)
      })
      .catch(() => {})
  }, [])

  // 二维码只带非回环地址（官方 CLI 同款）；全部回环时不渲染二维码
  const remoteUrls = ready ? ready.urls.filter(url => !isLoopback(new URL(url).hostname)) : []
  const qrPayload =
    ready && remoteUrls.length > 0 && !expired ? JSON.stringify({ code: ready.code, urls: remoteUrls }) : undefined
  const links = ready ? ready.urls.map(url => `${url}/auth/connect/${ready.code}`) : []

  return (
    <Dialog
      isOpen={server !== null}
      onClose={onClose}
      title={server ? t('servers.pairDialogTitle', { name: server.name }) : undefined}
      width={380}
    >
      <div className="flex flex-col items-center gap-3 py-1">
        {state.kind === 'loading' && (
          <p className="text-[length:var(--fs-sm)] text-text-400 py-8">{t('servers.pairGenerating')}</p>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-[length:var(--fs-sm)] text-danger-100 text-center leading-relaxed">
              {t('servers.pairFailed')}
            </p>
            <Button size="sm" variant="ghost" onClick={() => regenerate()}>
              <RetryIcon size={12} className="mr-1" />
              {t('common:retry')}
            </Button>
          </div>
        )}

        {ready && (
          <>
            {qrPayload ? (
              <div className="p-2.5 rounded-lg bg-white shadow-sm">
                <QrCode value={qrPayload} size={200} ariaLabel={t('servers.pairQrLabel')} />
              </div>
            ) : (
              <p className="text-[length:var(--fs-xs)] text-text-400 text-center leading-relaxed px-2">
                {expired ? t('servers.pairExpiredShort') : t('servers.pairNoRemoteUrls')}
              </p>
            )}

            <div className="w-full space-y-1.5">
              {links.map((link, index) => (
                <div
                  key={link}
                  className="flex items-center gap-1.5 rounded-md border border-border-200/50 bg-bg-200/40 px-2 py-1.5"
                >
                  <span className="flex-1 min-w-0 truncate font-mono text-[length:var(--fs-xxs)] text-text-300" title={link}>
                    {link}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(link, index)}
                    className="shrink-0 p-1 rounded-sm text-text-400 hover:text-text-100 hover:bg-bg-300/60 transition-colors"
                    title={t('common:copy')}
                    aria-label={t('common:copy')}
                  >
                    {copiedIndex === index ? (
                      <CheckIcon size={12} className="text-success-100" />
                    ) : (
                      <CopyIcon size={12} />
                    )}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between w-full">
              <p className={`text-[length:var(--fs-xxs)] ${expired ? 'text-danger-100' : 'text-text-500'}`}>
                {expired
                  ? t('servers.pairExpiredShort')
                  : t('servers.pairExpiryHint', { time: formatRemaining(remainingMs) })}
              </p>
              {expired && (
                <Button size="sm" variant="ghost" onClick={() => regenerate()}>
                  <RetryIcon size={12} className="mr-1" />
                  {t('servers.pairRegenerate')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
