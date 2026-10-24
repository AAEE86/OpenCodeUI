import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTheme } from '../../hooks'

/** 抓取宽度。出来本来就是糊的，分辨率再高没有意义。 */
const CAPTURE_WIDTH = 480
/** 画布比窗口大出的一圈（CSS px）。模糊的边缘衰减落在这圈里。 */
const EDGE_MARGIN = 48

/**
 * 桌面背景层。
 *
 * Rust 用 DXGI 把窗口背后的桌面抓下来、缩小、模糊，直接回原始 RGBA；
 * 这里一张 canvas 原样贴上去，由浏览器负责放大。
 *
 * 两个设计点：
 * - 不做 JPEG 编解码，一帧 480×300 的 RGBA 直接 `putImageData`，省 4ms 左右
 * - 循环跟着 `requestAnimationFrame` 走，和屏幕刷新同拍，不会自己压帧
 */
export function LiveBackdrop() {
  const { liveBackdrop, backdropInterval } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!liveBackdrop) return

    const canvas = canvasRef.current
    if (!canvas) return
    // desynchronized 绕过合成器直接写屏，省掉约一帧（16ms）的显示延迟。
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) return

    let cancelled = false
    let timer: number | null = null
    let failures = 0
    // 窗口最近一次移动的时间。拖动时抓得更勤，松手后回到克制节奏。
    let lastMoveAt = 0
    const unlistenMove = getCurrentWindow()
      .onMoved(() => {
        lastMoveAt = performance.now()
      })
      .catch(() => undefined)

    // 抓取尺寸跟着窗口比例走，canvas 反过来用 CSS 铺满窗口
    const applySize = () => {
      // 画布覆盖的是「窗口 + 四周一圈」，比例要按这个算，否则贴上去会被拉伸
      const cssWidth = Math.max(1, window.innerWidth + EDGE_MARGIN * 2)
      const cssHeight = Math.max(1, window.innerHeight + EDGE_MARGIN * 2)
      const width = Math.min(CAPTURE_WIDTH, Math.max(240, Math.round(cssWidth / 2)))
      const height = Math.max(120, Math.round((width * cssHeight) / cssWidth))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        ctx.imageSmoothingEnabled = true
      }
      return { width, height }
    }

    /** 返回这一轮有没有拿到新画面 */
    const step = async (): Promise<boolean> => {
      const { width, height } = applySize()
      try {
        const buffer = await invoke<ArrayBuffer>('capture_desktop_backdrop', {
          width,
          height,
          margin: Math.round(EDGE_MARGIN * window.devicePixelRatio),
          // 始终走「抓前设标记、等一帧合成」这条路，否则拿不到干净帧
          toggle: true,
        })
        if (cancelled) return false
        // 长度对不上就是「这一帧没变」的哨兵，什么都不做
        if (buffer && buffer.byteLength === width * height * 4) {
          const pixels = new Uint8ClampedArray(buffer)
          ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
          failures = 0
          return true
        }
        return false
      } catch {
        failures = Math.min(failures + 1, 8)
        return false
      }
    }

    /**
     * 不等 vsync：拿到帧就接着抓下一帧。
     *
     * 之前是 `requestAnimationFrame` 串起来的，每轮都要等一次屏幕刷新，
     * 抓取节奏被压到 30–40fps，拖动时背景明显跟手慢。
     * 现在把节奏交给抓取本身，绘制由浏览器在下一帧统一合成；
     * 画面没变时退到 16ms 一轮，静态时不会空转。
     */
    const loop = async () => {
      if (cancelled) return
      const fresh = await step()
      if (cancelled) return
      /*
       * 每次抓取都要让窗口从捕获里消失约一帧（等 DWM 合成）。
       * 33ms ≈ 30fps，手感流畅；代价是录屏里约两成的帧看不到应用。
       * 想录屏干净，把 33 改成 80（12fps）或 200（5fps）。
       */
      const moving = performance.now() - lastMoveAt < 250
      const delay = failures > 2 ? 400 : moving || fresh ? backdropInterval : 200
      timer = window.setTimeout(() => void loop(), delay)
    }

    void loop()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      // onMoved 返回的是 Promise<UnlistenFn>，可能晚于清理到达
      void unlistenMove.then(fn => fn?.())
    }
  }, [liveBackdrop, backdropInterval])

  if (!liveBackdrop) return null
  return <canvas ref={canvasRef} data-live-backdrop-canvas aria-hidden className="glass-live-backdrop" />
}
