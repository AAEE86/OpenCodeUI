/**
 * 配对链接 / QR 载荷 → 防抖兑换 → 回填地址与凭据。
 *
 * 添加服务器与编辑服务器表单共用：粘贴链接或扫码后自动兑换，
 * 成功时回调把 url + token 回填到表单字段（用户仍要点保存才落库）。
 * 兑换过的 token 留在 ref 里：code 是一次性的，连接失败重试必须复用
 * 上次的 token（官方 useRedeemPairing 的 last 缓存同款）。
 */

import { useEffect, useRef, useState } from 'react'
import { isLegacyPairingLink, isMixedContent, parsePairingLink, redeemPairingLink } from '../../../utils/pairing'

export type PairRedeemState =
  | { kind: 'idle' }
  | { kind: 'redeeming' }
  | { kind: 'paired'; url: string }
  | { kind: 'expired' }
  | { kind: 'unreachable' }
  | { kind: 'mixedContent' }
  | { kind: 'legacy' }

export function usePairLinkRedeem({
  onPaired,
  onInput,
}: {
  /** 兑换成功：回填 url + token（服务端约定用户名固定为 opencode，token 作密码） */
  onPaired: (url: string, token: string) => void
  /** 配对输入变化（清表单级错误） */
  onInput?: () => void
}) {
  const [pairLink, setPairLink] = useState('')
  const [pairState, setPairState] = useState<PairRedeemState>({ kind: 'idle' })
  const [pairScanOpen, setPairScanOpen] = useState(false)
  const redeemedRef = useRef<{ code: string; url: string; token: string } | null>(null)
  const pairSeqRef = useRef(0)
  const pairTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 粘贴 pair 链接 / QR 载荷 → 防抖兑换（全部在事件处理器里驱动，不经 effect）
  const handlePairLinkChange = (value: string) => {
    setPairLink(value)
    onInput?.()
    if (pairTimerRef.current) {
      clearTimeout(pairTimerRef.current)
      pairTimerRef.current = null
    }
    const seq = ++pairSeqRef.current
    const trimmed = value.trim()
    if (!trimmed) {
      setPairState({ kind: 'idle' })
      return
    }
    if (isLegacyPairingLink(trimmed)) {
      setPairState({ kind: 'legacy' })
      return
    }
    const link = parsePairingLink(trimmed)
    if (!link) {
      setPairState({ kind: 'idle' })
      return
    }
    const cached = redeemedRef.current
    if (cached && cached.code === link.code) {
      onPaired(link.urls.includes(cached.url) ? cached.url : link.urls[0], cached.token)
      setPairState({ kind: 'paired', url: cached.url })
      return
    }
    // 不做混合内容前置拦截：Chrome 142+ 的 Local Network Access 权限允许
    // HTTPS 页面访问 http 局域网地址，先发请求（触发授权弹窗），失败后再诊断
    pairTimerRef.current = setTimeout(() => {
      pairTimerRef.current = null
      setPairState({ kind: 'redeeming' })
      void redeemPairingLink(link).then(result => {
        if (seq !== pairSeqRef.current) return
        if (result.type === 'paired') {
          redeemedRef.current = { code: link.code, url: result.url, token: result.token }
          onPaired(result.url, result.token)
          setPairState({ kind: 'paired', url: result.url })
          return
        }
        // 不可达且所有地址都是「HTTPS 页面够 http 目标」时，给出更准确的混合内容提示
        if (
          result.type === 'unreachable' &&
          link.urls.every(address => isMixedContent(window.location.href, address))
        ) {
          setPairState({ kind: 'mixedContent' })
          return
        }
        setPairState({ kind: result.type })
      })
    }, 400)
  }

  // 卸载时取消在途防抖与作废响应
  useEffect(() => {
    return () => {
      pairSeqRef.current += 1
      if (pairTimerRef.current) clearTimeout(pairTimerRef.current)
    }
  }, [])

  return { pairLink, pairState, pairScanOpen, setPairScanOpen, handlePairLinkChange }
}
