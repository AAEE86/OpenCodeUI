import { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { isLegacyPairingLink, parsePairingLink } from '../../../utils/pairing'

// ============================================
// 扫码配对 Dialog
//
// 对准 `opencode pair` 或配对弹窗展示的二维码，扫到合法配对码后
// 把原始载荷交给表单（onScan），由表单自己的兑换链完成配对——
// token 留在表单缓存里，连接失败重试不会浪费一次性 code。
// 解码逻辑对齐官方 packages/app/src/servers/connect/scanner.tsx：
//   - 环境摄像头优先、inversionMode 'both'（终端 QR 可能是浅块深底）
//   - 无效码 3 秒冷却（同一码通常还停在画面里，不能每帧报错）
//   - NO_QR_CODE_FOUND 是空画面的常态，不是错误
// ============================================

/** 无效码冷却时长：同一码 3 秒内不重复提示 */
const REJECT_COOLDOWN_MS = 3_000

interface PairScanDialogProps {
  isOpen: boolean
  onClose: () => void
  /** 扫到合法配对码（原始载荷，可能是 JSON），由调用方走兑换链 */
  onScan: (data: string) => void
}

export function PairScanDialog({ isOpen, onClose, onScan }: PairScanDialogProps) {
  const { t } = useTranslation(['settings'])
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('servers.pairScanTitle')} width={360}>
      {/* 关闭即卸载扫描器：摄像头立即释放，下次打开状态全新 */}
      {isOpen && <PairScanner onScan={onScan} onClose={onClose} />}
    </Dialog>
  )
}

function PairScanner({ onScan, onClose }: { onScan: (data: string) => void; onClose: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraState, setCameraState] = useState<'starting' | 'ready' | 'error'>('starting')
  const [scanError, setScanError] = useState<'invalid' | 'legacy' | null>(null)
  // 扫描 effect 只跑一次，onScan 经 ref 取最新值，避免父组件重渲染重启摄像头
  const onScanRef = useRef(onScan)
  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let disposed = false
    const rejected = new Map<string, number>()
    const scanner = new QrScanner(
      video,
      result => {
        const data = result.data
        if (disposed || Date.now() < (rejected.get(data) ?? 0)) return
        if (isLegacyPairingLink(data)) {
          rejected.set(data, Date.now() + REJECT_COOLDOWN_MS)
          setScanError('legacy')
          return
        }
        // QR 载荷是 {"code","urls"} JSON 时 parse 即成功；原始 data 直接交给表单，
        // 表单的 parsePairingLink 同样认 JSON，不需要在这里改写形态
        if (parsePairingLink(data)) {
          disposed = true
          scanner.destroy()
          onScanRef.current(data)
          return
        }
        rejected.set(data, Date.now() + REJECT_COOLDOWN_MS)
        setScanError('invalid')
      },
      {
        preferredCamera: 'environment',
        maxScansPerSecond: 10,
        returnDetailedScanResult: true,
        onDecodeError: error => {
          // 空画面每帧都会报 NO_QR_CODE_FOUND，忽略；其余解码错误 QrScanner 自己会打日志
          if (String(error).includes(QrScanner.NO_QR_CODE_FOUND)) return
        },
      },
    )
    // 终端 QR 随主题可能是浅色块深底，正反差两种都试
    scanner.setInversionMode('both')
    void scanner.start().then(
      () => {
        if (!disposed) setCameraState('ready')
      },
      () => {
        if (!disposed) setCameraState('error')
      },
    )
    return () => {
      disposed = true
      scanner.destroy()
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3 py-1">
      <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-border-200/50 bg-bg-200/40">
        {/* playsInline + muted 是 iOS 内联播放与自动播放的前提 */}
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={t('servers.pairScanTitle')}
          className="w-full h-full object-cover"
        />
        {cameraState === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p role="status" className="text-[length:var(--fs-xs)] text-text-400">
              {t('servers.pairCameraStarting')}
            </p>
          </div>
        )}
      </div>

      <p className="text-[length:var(--fs-xs)] text-text-400 text-center leading-relaxed">
        {t('servers.pairScanHint')}
      </p>

      {cameraState === 'error' ? (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-[length:var(--fs-xs)] text-danger-100 text-center leading-relaxed">
            {t('servers.pairCameraError')}
          </p>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common:close')}
          </Button>
        </div>
      ) : (
        scanError && (
          <p role="alert" className="text-[length:var(--fs-xs)] text-danger-100 text-center leading-relaxed">
            {scanError === 'legacy' ? t('servers.pairScanLegacy') : t('servers.pairScanInvalid')}
          </p>
        )
      )}
    </div>
  )
}
