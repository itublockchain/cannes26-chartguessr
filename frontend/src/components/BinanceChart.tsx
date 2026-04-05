import { useEffect, useRef } from 'react'

const BINANCE_WS = 'wss://stream.binance.com:9443/ws/btcusdt@kline_1s'
const BINANCE_REST = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=500'
const WINDOW_SECONDS = 300
const MOTION_MS = 1000
const HISTORY_LIMIT = 900

type Point = { timeSec: number; value: number }
type Motion = { from: Point; to: Point; startedAt: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (t: number) => t * t * (3 - 2 * t)

export function BinanceChart() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas || mountedRef.current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    mountedRef.current = true

    const points: Point[] = []
    const displayRef = { current: null as Point | null }
    const motionRef = { current: null as Motion | null }
    const pendingRef = { current: null as Point | null }
    const velocityRef = { current: 0 }

    let active = true
    let animFrame: number | null = null
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let reconnectDelay = 500
    let lastMotionEnd = performance.now()
    let cssW = 0, cssH = 0, dpr = 1

    // smoothed Y-axis range
    let smoothMin = 0
    let smoothMax = 1
    let rangeInited = false

    // smoothed line points — lerp entire series each frame
    let currentLine: { x: number; y: number }[] = []

    // --- canvas sizing ---
    const syncSize = () => {
      const r = container.getBoundingClientRect()
      cssW = Math.max(1, Math.floor(r.width))
      cssH = Math.max(1, Math.floor(r.height))
      dpr = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const ro = new ResizeObserver(() => { syncSize(); draw() })

    // --- point helpers ---
    const push = (p: Point) => {
      const last = points[points.length - 1]
      if (!last || last.timeSec < p.timeSec) {
        points.push(p)
        while (points.length > HISTORY_LIMIT) points.shift()
      }
    }

    const startMotion = (from: Point, to: Point) => {
      motionRef.current = { from, to, startedAt: performance.now() }
    }

    const finishMotion = () => {
      const m = motionRef.current
      if (!m) return
      displayRef.current = m.to
      velocityRef.current = clamp(m.to.value - m.from.value, -10, 10)
      push(m.to)
      motionRef.current = null
      lastMotionEnd = performance.now()
      if (pendingRef.current) {
        const p = pendingRef.current
        pendingRef.current = null
        startMotion(m.to, p)
      } else {
        startMotion(m.to, { timeSec: m.to.timeSec + 1, value: m.to.value })
      }
    }

    const applyPoint = (p: Point) => {
      const cur = displayRef.current
      if (!cur) { displayRef.current = p; push(p); lastMotionEnd = performance.now(); return }
      const target = { timeSec: Math.max(cur.timeSec + 1, p.timeSec), value: p.value }
      if (motionRef.current) { pendingRef.current = target; return }
      startMotion(cur, target)
    }

    const setSeed = (src: Point[]) => {
      points.length = 0
      pendingRef.current = null
      for (const p of src) push(p)
      const last = points[points.length - 1]
      const prev = points[points.length - 2] ?? last
      displayRef.current = last
      velocityRef.current = clamp(last.value - prev.value, -10, 10)
      motionRef.current = null
      lastMotionEnd = performance.now()
    }

    // --- combined points ---
    const getCombined = () => {
      const c = [...points]
      const dp = displayRef.current
      if (dp) {
        const last = c[c.length - 1]
        if (!last || last.timeSec !== dp.timeSec || last.value !== dp.value) c.push(dp)
      }
      c.sort((a, b) => a.timeSec - b.timeSec)
      return c
    }

    // --- drawing ---
    const BUCKET_SEC = 15

    const drawGrid = (l: number, t: number, w: number, h: number) => {
      ctx.strokeStyle = 'rgba(255, 155, 81, 0.06)'
      ctx.lineWidth = 1
      for (let i = 1; i < 6; i++) { const x = l + (w * i) / 6; ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + h); ctx.stroke() }
      for (let i = 1; i < 4; i++) { const y = t + (h * i) / 4; ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + w, y); ctx.stroke() }
    }

    // Time-based downsample + EMA smoothing
    const downsampleByTime = (src: Point[], anchorTime: number): Point[] => {
      if (src.length < 3) return src

      // 1) bucket average — anchor buckets to anchorTime so they align with window edge
      const buckets: Point[] = []
      const toBucket = (t: number) => anchorTime + Math.floor((t - anchorTime) / BUCKET_SEC) * BUCKET_SEC
      let curBucket = toBucket(src[0].timeSec)
      let sum = 0, count = 0

      for (const p of src) {
        const b = toBucket(p.timeSec)
        if (b !== curBucket && count > 0) {
          buckets.push({ timeSec: curBucket, value: sum / count })
          sum = 0; count = 0; curBucket = b
        }
        sum += p.value; count++
      }
      if (count > 0) {
        buckets.push({ timeSec: src[src.length - 1].timeSec, value: sum / count })
      }

      // 2) EMA smoothing pass
      if (buckets.length < 2) return buckets
      const alpha = 0.35
      const smoothed: Point[] = [buckets[0]]
      for (let i = 1; i < buckets.length; i++) {
        smoothed.push({
          timeSec: buckets[i].timeSec,
          value: alpha * buckets[i].value + (1 - alpha) * smoothed[i - 1].value,
        })
      }
      return smoothed
    }

    // Monotone cubic Hermite spline (no overshoot, stable)
    const drawCurve = (pts: { x: number; y: number }[], baseY: number) => {
      const n = pts.length
      if (n < 2) return

      // compute tangents (Fritsch-Carlson monotone)
      const dx: number[] = []
      const dy: number[] = []
      const slope: number[] = []
      for (let i = 0; i < n - 1; i++) {
        dx.push(pts[i + 1].x - pts[i].x)
        dy.push(pts[i + 1].y - pts[i].y)
        slope.push(dx[i] === 0 ? 0 : dy[i] / dx[i])
      }

      const tangent: number[] = [slope[0]]
      for (let i = 1; i < n - 1; i++) {
        if (slope[i - 1] * slope[i] <= 0) {
          tangent.push(0)
        } else {
          tangent.push((slope[i - 1] + slope[i]) / 2)
        }
      }
      tangent.push(slope[n - 2])

      // Fritsch-Carlson adjustment to ensure monotonicity
      for (let i = 0; i < n - 1; i++) {
        if (Math.abs(slope[i]) < 1e-10) {
          tangent[i] = 0; tangent[i + 1] = 0
        } else {
          const a = tangent[i] / slope[i]
          const b = tangent[i + 1] / slope[i]
          const s = a * a + b * b
          if (s > 9) {
            const t = 3 / Math.sqrt(s)
            tangent[i] = t * a * slope[i]
            tangent[i + 1] = t * b * slope[i]
          }
        }
      }

      ctx.save()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = 'hsl(26, 100%, 66%)'
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)

      for (let i = 0; i < n - 1; i++) {
        const d = dx[i]
        const cp1x = pts[i].x + d / 3
        const cp1y = pts[i].y + tangent[i] * d / 3
        const cp2x = pts[i + 1].x - d / 3
        const cp2y = pts[i + 1].y - tangent[i + 1] * d / 3
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pts[i + 1].x, pts[i + 1].y)
      }

      ctx.stroke()

      // gradient fill
      ctx.lineTo(pts[n - 1].x, baseY)
      ctx.lineTo(pts[0].x, baseY)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, 0, 0, baseY)
      grad.addColorStop(0, 'rgba(255, 155, 81, 0.14)')
      grad.addColorStop(1, 'rgba(255, 155, 81, 0.01)')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.restore()
    }

    const draw = () => {
      if (cssW <= 0 || cssH <= 0) return
      ctx.clearRect(0, 0, cssW, cssH)

      ctx.fillStyle = 'hsl(0, 0%, 100%)'
      ctx.fillRect(0, 0, cssW, cssH)

      const combined = getCombined()
      if (!combined.length) return

      const latest = combined[combined.length - 1]
      const winStart = latest.timeSec - WINDOW_SECONDS
      // include extra points before window so spline enters smoothly from left
      const visible = combined.filter(p => p.timeSec >= winStart - BUCKET_SEC * 3)

      const sampled = downsampleByTime(visible, winStart)

      const pad = 2
      const pW = Math.max(1, cssW - pad * 2)
      const pH = Math.max(1, cssH - pad * 2)
      const pBottom = pad + pH

      const vals = sampled.map(p => p.value)
      const mn = Math.min(...vals), mx = Math.max(...vals)
      const pp = Math.max((mx - mn) * 0.16, 10)
      const targetMin = mn - pp, targetMax = mx + pp

      // smoothly lerp Y-axis range toward target
      const RANGE_LERP = 0.08
      if (!rangeInited) {
        smoothMin = targetMin; smoothMax = targetMax; rangeInited = true
      } else {
        smoothMin += (targetMin - smoothMin) * RANGE_LERP
        smoothMax += (targetMax - smoothMax) * RANGE_LERP
      }
      const pRange = Math.max(1, smoothMax - smoothMin)

      const tx = (t: number) => pad + ((t - winStart) / WINDOW_SECONDS) * pW
      const py = (v: number) => pBottom - clamp((v - smoothMin) / pRange, 0, 1) * pH

      drawGrid(pad, pad, pW, pH)

      // target line from current data
      const targetLine = sampled.map(p => ({ x: tx(p.timeSec), y: py(p.value) }))

      // lerp currentLine toward targetLine for smooth transitions
      const LINE_LERP = 0.12
      if (!currentLine.length) {
        currentLine = targetLine.map(p => ({ ...p }))
      } else {
        // match lengths: resample currentLine to targetLine's length
        const oldLen = currentLine.length
        const newLen = targetLine.length
        if (oldLen !== newLen) {
          const resampled: { x: number; y: number }[] = []
          for (let i = 0; i < newLen; i++) {
            const srcIdx = (i / Math.max(1, newLen - 1)) * Math.max(1, oldLen - 1)
            const lo = Math.floor(srcIdx)
            const hi = Math.min(lo + 1, oldLen - 1)
            const frac = srcIdx - lo
            resampled.push({
              x: currentLine[lo].x + (currentLine[hi].x - currentLine[lo].x) * frac,
              y: currentLine[lo].y + (currentLine[hi].y - currentLine[lo].y) * frac,
            })
          }
          currentLine = resampled
        }
        // lerp each point
        for (let i = 0; i < currentLine.length; i++) {
          currentLine[i].x += (targetLine[i].x - currentLine[i].x) * LINE_LERP
          currentLine[i].y += (targetLine[i].y - currentLine[i].y) * LINE_LERP
        }
      }

      // clip & draw
      ctx.save()
      ctx.beginPath()
      ctx.rect(pad, pad, pW, pH)
      ctx.clip()
      drawCurve(currentLine, pBottom)
      ctx.restore()

      // dot at latest
      const last = currentLine[currentLine.length - 1]
      ctx.fillStyle = 'hsl(26, 100%, 66%)'
      ctx.beginPath()
      ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2)
      ctx.fill()

      // price label
      ctx.font = '600 13px Satoshi, sans-serif'
      ctx.fillStyle = 'hsl(205, 26%, 20%)'
      ctx.textAlign = 'right'
      ctx.fillText(`$${latest.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cssW - 12, 24)

      // BTC/USD label
      ctx.font = '700 11px Satoshi, sans-serif'
      ctx.fillStyle = 'hsl(205, 14%, 46%)'
      ctx.textAlign = 'left'
      ctx.fillText('BTC / USD', 12, 24)
    }

    // --- animation loop ---
    const animate = () => {
      if (!active) return
      const m = motionRef.current
      if (m) {
        const elapsed = performance.now() - m.startedAt
        const t = clamp(elapsed / MOTION_MS, 0, 1)
        displayRef.current = { timeSec: lerp(m.from.timeSec, m.to.timeSec, t), value: lerp(m.from.value, m.to.value, smoothstep(t)) }
        if (t >= 1) finishMotion()
      } else if (displayRef.current && performance.now() - lastMotionEnd >= 850) {
        const bp = displayRef.current
        startMotion(bp, { timeSec: bp.timeSec + 1, value: bp.value })
      }
      draw()
      animFrame = requestAnimationFrame(animate)
    }

    // --- Binance REST seed ---
    const fetchSeed = async () => {
      try {
        const res = await fetch(BINANCE_REST)
        if (!res.ok) return
        const klines: unknown[][] = await res.json()
        const seed: Point[] = klines.map(k => ({
          timeSec: Math.floor(Number(k[0]) / 1000),
          value: parseFloat(k[4] as string), // close price
        }))
        if (seed.length) setSeed(seed)
      } catch { /* silent */ }
    }

    // --- Binance WebSocket ---
    const scheduleReconnect = () => {
      if (!active || reconnectTimer != null) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        if (active) connectWs()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 1.5, 5000)
    }

    const connectWs = () => {
      if (!active) return
      socket?.close()
      socket = new WebSocket(BINANCE_WS)

      socket.onopen = () => { reconnectDelay = 500 }

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          const k = msg?.k
          if (!k) return
          applyPoint({
            timeSec: Math.floor(Number(k.t) / 1000),
            value: parseFloat(k.c), // close
          })
        } catch { /* ignore */ }
      }

      socket.onerror = () => { if (active) socket?.close() }
      socket.onclose = () => { if (active) scheduleReconnect() }
    }

    // --- init ---
    syncSize()
    ro.observe(container)
    fetchSeed().then(() => {
      if (active) connectWs()
    })
    animFrame = requestAnimationFrame(animate)

    return () => {
      active = false
      if (reconnectTimer != null) clearTimeout(reconnectTimer)
      if (animFrame != null) cancelAnimationFrame(animFrame)
      ro.disconnect()
      socket?.close()
      mountedRef.current = false
    }
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  )
}
