import { useMemo } from 'react'
import { encode } from 'uqr'

interface QrCodeProps {
  value: string
  /** 渲染边长（px），默认 200 */
  size?: number
  className?: string
  ariaLabel?: string
}

const QUIET_ZONE = 4

/**
 * QR 码（uqr 编码 → SVG 矢量渲染）。
 * 白底黑块保证任意主题下的扫码对比度；模块合并成一条 path，
 * 大载荷（pair QR 的 {"code","urls"} JSON）也只有两个 SVG 节点。
 */
export function QrCode({ value, size = 200, className, ariaLabel }: QrCodeProps) {
  const { path, viewSize } = useMemo(() => {
    const { data, size: n } = encode(value)
    let d = ''
    for (let y = 0; y < n; y++) {
      const row = data[y]
      for (let x = 0; x < n; x++) {
        if (row[x]) d += `M${x + QUIET_ZONE},${y + QUIET_ZONE}h1v1h-1z`
      }
    }
    return { path: d, viewSize: n + QUIET_ZONE * 2 }
  }, [value])

  return (
    <svg
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel ?? 'QR code'}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={viewSize} height={viewSize} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
