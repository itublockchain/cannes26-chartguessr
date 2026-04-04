import { useEffect, useRef } from 'react'
import { parseBackendMessage, sourceCandlesFromBackendMessage } from './btcEngine'

const TARGET_COIN = (import.meta.env.VITE_PRICE_COIN ?? 'BTC').toUpperCase()
const WS_URL = import.meta.env.VITE_PRICE_WS_URL ?? 'ws://localhost:4000'
const WINDOW_SECONDS = 300
const MOTION_MS = 1000
const PLACEHOLDER_PRICE = 42500
const PLACEHOLDER_POINTS = 180
const HISTORY_LIMIT = 900

type TimeValuePoint = {
  timeSec: number
  value: number
}

type MotionState = {
  from: TimeValuePoint
  to: TimeValuePoint
  startedAt: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

const smoothstep = (amount: number) => amount * amount * (3 - 2 * amount)

export function SmoothChart() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current

    if (!container || !canvas || mountedRef.current) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    mountedRef.current = true

    const points: TimeValuePoint[] = []
    const displayPointRef = { current: null as TimeValuePoint | null }
    const motionRef = { current: null as MotionState | null }
    const pendingPointRef = { current: null as TimeValuePoint | null }
    const velocityRef = { current: 0 }

    let active = true
    let reconnectTimer: number | null = null
    let reconnectDelay = 500
    let animationFrame: number | null = null
    let socket: WebSocket | null = null
    let lastMotionEndAt = performance.now()
    let cssWidth = 0
    let cssHeight = 0
    let dpr = 1

    const syncCanvasSize = () => {
      const rect = container.getBoundingClientRect()

      cssWidth = Math.max(1, Math.floor(rect.width))
      cssHeight = Math.max(1, Math.floor(rect.height))
      dpr = Math.max(1, window.devicePixelRatio || 1)

      canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
      canvas.style.width = '100%'
      canvas.style.height = '100%'

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const resizeObserver = new ResizeObserver(() => {
      syncCanvasSize()
      draw()
    })

    const trimHistory = () => {
      while (points.length > HISTORY_LIMIT) {
        points.shift()
      }
    }

    const pushPoint = (point: TimeValuePoint) => {
      const lastPoint = points[points.length - 1]

      if (!lastPoint || lastPoint.timeSec < point.timeSec) {
        points.push(point)
        trimHistory()
      }
    }

    const buildSyntheticSeed = () => {
      points.length = 0

      const nowSec = Math.floor(Date.now() / 1000)

      for (let index = PLACEHOLDER_POINTS; index >= 0; index -= 1) {
        const timeSec = nowSec - index
        const drift = Math.sin(index / 7) * 18 + Math.cos(index / 13) * 9

        points.push({
          timeSec,
          value: PLACEHOLDER_PRICE + drift,
        })
      }

      const lastPoint = points[points.length - 1]
      const previousPoint = points[points.length - 2] ?? lastPoint

      displayPointRef.current = lastPoint
      velocityRef.current = clamp(lastPoint.value - previousPoint.value, -10, 10)
    }

    const setSeedFromBackend = (sourcePoints: TimeValuePoint[]) => {
      points.length = 0
      pendingPointRef.current = null

      if (!sourcePoints.length) {
        buildSyntheticSeed()
        return
      }

      for (const point of sourcePoints) {
        pushPoint(point)
      }

      const lastPoint = points[points.length - 1]
      const previousPoint = points[points.length - 2] ?? lastPoint

      displayPointRef.current = lastPoint
      velocityRef.current = clamp(lastPoint.value - previousPoint.value, -10, 10)
      motionRef.current = null
      lastMotionEndAt = performance.now()
    }

    const startMotion = (from: TimeValuePoint, to: TimeValuePoint) => {
      motionRef.current = {
        from,
        to,
        startedAt: performance.now(),
      }
    }

    const finishMotion = () => {
      const motion = motionRef.current

      if (!motion) {
        return
      }

      const completed = motion.to

      displayPointRef.current = completed
      velocityRef.current = clamp(completed.value - motion.from.value, -10, 10)
      pushPoint(completed)

      motionRef.current = null
      lastMotionEndAt = performance.now()

      if (pendingPointRef.current) {
        const pendingPoint = pendingPointRef.current
        pendingPointRef.current = null
        startMotion(completed, pendingPoint)
      } else {
        startMotion(completed, {
          timeSec: completed.timeSec + 1,
          value: completed.value,
        })
      }
    }

    const maybeStartSyntheticMotion = () => {
      if (motionRef.current || !displayPointRef.current) {
        return
      }

      const basePoint = displayPointRef.current

      startMotion(basePoint, {
        timeSec: basePoint.timeSec + 1,
        value: basePoint.value,
      })
    }

    const applyIncomingPoint = (point: TimeValuePoint) => {
      const currentDisplayPoint = displayPointRef.current

      if (!currentDisplayPoint) {
        displayPointRef.current = point
        pushPoint(point)
        lastMotionEndAt = performance.now()
        return
      }

      const nextTimeSec = Math.max(currentDisplayPoint.timeSec + 1, point.timeSec)
      const targetPoint = {
        timeSec: nextTimeSec,
        value: point.value,
      }

      if (motionRef.current) {
        pendingPointRef.current = targetPoint
        return
      }

      startMotion(currentDisplayPoint, targetPoint)
    }

    const getCombinedPoints = () => {
      const combined = [...points]
      const displayPoint = displayPointRef.current

      if (displayPoint) {
        const lastPoint = combined[combined.length - 1]

        if (!lastPoint || lastPoint.timeSec !== displayPoint.timeSec || lastPoint.value !== displayPoint.value) {
          combined.push(displayPoint)
        }
      }

      combined.sort((left, right) => left.timeSec - right.timeSec)

      return combined
    }

    const drawGrid = (
      left: number,
      top: number,
      width: number,
      height: number,
      horizontalLines: number,
      verticalLines: number,
      color: string,
    ) => {
      context.strokeStyle = color
      context.lineWidth = 1

      for (let index = 1; index < verticalLines; index += 1) {
        const x = left + (width * index) / verticalLines
        context.beginPath()
        context.moveTo(x, top)
        context.lineTo(x, top + height)
        context.stroke()
      }

      for (let index = 1; index < horizontalLines; index += 1) {
        const y = top + (height * index) / horizontalLines
        context.beginPath()
        context.moveTo(left, y)
        context.lineTo(left + width, y)
        context.stroke()
      }
    }

    const drawSeries = (
      pointsForSeries: Array<{ x: number; y: number }>,
      color: string,
      width: number,
      fill: boolean,
      fillColor: string | CanvasGradient,
      baselineY: number,
    ) => {
      if (pointsForSeries.length < 2) {
        return
      }

      context.save()
      context.lineWidth = width
      context.strokeStyle = color
      context.lineJoin = 'round'
      context.lineCap = 'round'

      context.beginPath()
      context.moveTo(pointsForSeries[0].x, pointsForSeries[0].y)

      for (let index = 1; index < pointsForSeries.length; index += 1) {
        const prev = pointsForSeries[index - 1]
        const current = pointsForSeries[index]
        const midX = (prev.x + current.x) / 2

        context.quadraticCurveTo(prev.x, prev.y, midX, (prev.y + current.y) / 2)
        context.quadraticCurveTo(current.x, current.y, current.x, current.y)
      }

      context.stroke()

      if (fill) {
        context.lineTo(pointsForSeries[pointsForSeries.length - 1].x, baselineY)
        context.lineTo(pointsForSeries[0].x, baselineY)
        context.closePath()
        context.fillStyle = fillColor
        context.fill()
      }

      context.restore()
    }

    const draw = () => {
      if (cssWidth <= 0 || cssHeight <= 0) {
        return
      }

      context.clearRect(0, 0, cssWidth, cssHeight)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, cssWidth, cssHeight)

      const combinedPoints = getCombinedPoints()

      if (!combinedPoints.length) {
        return
      }

      const latestPoint = combinedPoints[combinedPoints.length - 1]
      const latestTime = latestPoint.timeSec
      const windowStart = latestTime - 300
      const visiblePoints = combinedPoints.filter((point) => point.timeSec >= windowStart - 2)

      const pricePaneTop = 2
      const pricePaneLeft = 2
      const pricePaneHeight = Math.max(1, cssHeight - 4)
      const pricePaneWidth = Math.max(1, cssWidth - 4)
      const pricePaneBottom = pricePaneTop + pricePaneHeight

      const priceValues = visiblePoints.map((point) => point.value)
      const minPrice = Math.min(...priceValues)
      const maxPrice = Math.max(...priceValues)
      const pricePadding = Math.max((maxPrice - minPrice) * 0.16, 10)
      const priceMin = minPrice - pricePadding
      const priceMax = maxPrice + pricePadding
      const priceRange = Math.max(1, priceMax - priceMin)

      const timeToX = (timeSec: number) => {
        const normalized = clamp((timeSec - windowStart) / WINDOW_SECONDS, 0, 1)
        return pricePaneLeft + normalized * pricePaneWidth
      }

      const priceToY = (value: number) => {
        const normalized = clamp((value - priceMin) / priceRange, 0, 1)
        return pricePaneBottom - normalized * pricePaneHeight
      }

      drawGrid(pricePaneLeft, pricePaneTop, pricePaneWidth, pricePaneHeight, 4, 6, 'rgba(247, 147, 26, 0.08)')

      const priceSeriesPoints = visiblePoints.map((point) => ({
        x: timeToX(point.timeSec),
        y: priceToY(point.value),
      }))

      const gradient = context.createLinearGradient(0, pricePaneTop, 0, pricePaneBottom)
      gradient.addColorStop(0, 'rgba(247, 147, 26, 0.18)')
      gradient.addColorStop(1, 'rgba(247, 147, 26, 0.02)')

      drawSeries(priceSeriesPoints, '#f7931a', 2.8, true, gradient, pricePaneBottom)

      const currentPriceX = timeToX(latestPoint.timeSec)
      const currentPriceY = priceToY(latestPoint.value)

      context.fillStyle = '#f7931a'
      context.beginPath()
      context.arc(currentPriceX, currentPriceY, 3.5, 0, Math.PI * 2)
      context.fill()

    }

    const animate = () => {
      if (!active) {
        return
      }

      const motion = motionRef.current

      if (motion) {
        const elapsed = performance.now() - motion.startedAt
        const progress = clamp(elapsed / MOTION_MS, 0, 1)
        const eased = smoothstep(progress)

        displayPointRef.current = {
          timeSec: lerp(motion.from.timeSec, motion.to.timeSec, progress),
          value: lerp(motion.from.value, motion.to.value, eased),
        }

        if (progress >= 1) {
          finishMotion()
        }
      } else if (displayPointRef.current && performance.now() - lastMotionEndAt >= 850) {
        maybeStartSyntheticMotion()
      }

      draw()
      animationFrame = window.requestAnimationFrame(animate)
    }

    const scheduleReconnect = () => {
      if (!active || reconnectTimer != null) {
        return
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null

        if (active) {
          connect()
        }
      }, reconnectDelay)

      reconnectDelay = Math.min(reconnectDelay * 1.5, 5000)
    }

    const connect = () => {
      if (!active) {
        return
      }

      socket?.close()
      socket = new WebSocket(WS_URL)

      socket.onopen = () => {
        if (!active || !socket) {
          return
        }

        reconnectDelay = 500
        socket.send(JSON.stringify({ method: 'subscribe', coin: TARGET_COIN }))
      }

      socket.onmessage = (event) => {
        const message = parseBackendMessage(event.data)

        if (!message || !('type' in message)) {
          return
        }

        if (message.type !== 'snapshot' && message.type !== 'candle1s') {
          return
        }

        const sourceCandles = sourceCandlesFromBackendMessage(message, TARGET_COIN)

        if (!sourceCandles.length) {
          return
        }

        if (message.type === 'snapshot') {
          setSeedFromBackend(
            sourceCandles.map((candle) => ({
              timeSec: Math.floor(candle.time / 1000),
              value: candle.close,
            })),
          )

          return
        }

        const sourceCandle = sourceCandles[sourceCandles.length - 1]

        applyIncomingPoint({
          timeSec: Math.floor(sourceCandle.time / 1000),
          value: sourceCandle.close,
        })
      }

      socket.onerror = () => {
        if (active) {
          socket?.close()
        }
      }

      socket.onclose = () => {
        if (active) {
          scheduleReconnect()
        }
      }
    }

    syncCanvasSize()
    resizeObserver.observe(container)
    buildSyntheticSeed()
    draw()
    animationFrame = window.requestAnimationFrame(animate)
    connect()

    return () => {
      active = false

      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
      }

      if (animationFrame != null) {
        window.cancelAnimationFrame(animationFrame)
      }

      resizeObserver.disconnect()
      socket?.close()
      mountedRef.current = false
    }
  }, [])

  return (
    <div ref={containerRef} className="relative w-screen h-[100svh] bg-white overflow-hidden p-[6px] border-2 border-black">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  )
}
