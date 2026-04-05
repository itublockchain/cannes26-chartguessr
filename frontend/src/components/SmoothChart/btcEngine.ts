import type { CandlestickData, UTCTimestamp } from 'lightweight-charts'

export type SourceCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  trades?: number
}

export type BackendMessage =
  | {
      type: 'snapshot'
      coin: string
      data: SourceCandle[]
    }
  | {
      type: 'candle1s'
      coin: string
      data: SourceCandle
      complete: boolean
    }
  | {
      type: 'subscriptionResponse'
      coin: string
      status: string
    }
  | {
      type: 'error'
      message: string
    }
  | {
      method: 'pong'
    }

type AggregatedCandleState = {
  startMs: number
  candle: CandlestickData<UTCTimestamp>
  volume: number
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function toTimeMs(value: unknown): number | null {
  const raw = toNumber(value)

  if (raw == null) {
    return null
  }

  if (raw > 1e14) {
    return Math.round(raw / 1e6)
  }

  if (raw > 1e11) {
    return Math.round(raw)
  }

  return Math.round(raw * 1000)
}

function normalizeSymbol(symbol: string) {
  return symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function symbolsMatch(actual: string, expected: string) {
  if (actual === expected) {
    return true
  }

  return actual.includes(expected) || expected.includes(actual)
}

export function parseBackendMessage(input: unknown): BackendMessage | null {
  if (typeof input !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    const type = parsed.type

    if (type === 'snapshot' && typeof parsed.coin === 'string' && Array.isArray(parsed.data)) {
      const candles = parsed.data.flatMap((entry) => normalizeSourceCandle(entry))
      return { type, coin: parsed.coin, data: candles }
    }

    if (
      type === 'candle1s' &&
      typeof parsed.coin === 'string' &&
      parsed.data != null
    ) {
      const candles = normalizeSourceCandle(parsed.data)
      if (candles.length === 0) {
        return null
      }

      return {
        type,
        coin: parsed.coin,
        data: candles[0],
        complete: Boolean(parsed.complete),
      }
    }

    if (type === 'subscriptionResponse' && typeof parsed.coin === 'string') {
      return {
        type,
        coin: parsed.coin,
        status: typeof parsed.status === 'string' ? parsed.status : 'ok',
      }
    }

    if (type === 'error' && typeof parsed.message === 'string') {
      return { type, message: parsed.message }
    }

    if (parsed.method === 'pong') {
      return { method: 'pong' }
    }

    return null
  } catch {
    return null
  }
}

function normalizeSourceCandle(input: unknown): SourceCandle[] {
  if (Array.isArray(input)) {
    return input.flatMap((entry) => normalizeSourceCandle(entry))
  }

  if (input == null || typeof input !== 'object') {
    return []
  }

  const record = input as Record<string, unknown>
  const timeMs = toTimeMs(record.time)
  const open = toNumber(record.open)
  const high = toNumber(record.high)
  const low = toNumber(record.low)
  const close = toNumber(record.close)

  if (timeMs == null || open == null || high == null || low == null || close == null) {
    return []
  }

  return [
    {
      time: timeMs,
      open,
      high,
      low,
      close,
      volume: toNumber(record.volume) ?? 0,
      trades: toNumber(record.trades) ?? undefined,
    },
  ]
}

export function createContinuousCandleEngine(intervalMs: number) {
  let current: AggregatedCandleState | null = null

  const alignToBucket = (timeMs: number) => Math.floor(timeMs / intervalMs) * intervalMs

  const createState = (startMs: number, open: number): AggregatedCandleState => ({
    startMs,
    candle: {
      time: Math.floor(startMs / 1000) as UTCTimestamp,
      open,
      high: open,
      low: open,
      close: open,
    },
    volume: 0,
  })

  const mergeSourceCandle = (source: SourceCandle) => {
    const sourceTimeMs = source.time * 1000
    const bucketStartMs = alignToBucket(sourceTimeMs)

    if (!current) {
      current = createState(bucketStartMs, source.open)
    }

    if (bucketStartMs < current.startMs) {
      return [] as CandlestickData<UTCTimestamp>[]
    }

    const updates: CandlestickData<UTCTimestamp>[] = []

    while (current.startMs < bucketStartMs) {
      const previousClose = current.candle.close
      const nextStartMs = current.startMs + intervalMs

      if (nextStartMs > bucketStartMs) {
        break
      }

      if (nextStartMs === bucketStartMs) {
        current = createState(bucketStartMs, previousClose)
        updates.push(current.candle)
        break
      }

      current = createState(nextStartMs, previousClose)
      updates.push(current.candle)
    }

    if (!current || current.startMs !== bucketStartMs) {
      current = createState(bucketStartMs, source.open)
      updates.push(current.candle)
    }

    current.candle.high = Math.max(current.candle.high, source.high)
    current.candle.low = Math.min(current.candle.low, source.low)
    current.candle.close = source.close
    current.volume += source.volume

    updates.push(current.candle)

    return updates
  }

  return {
    ingest(source: SourceCandle) {
      return mergeSourceCandle(source)
    },
    reset() {
      current = null
    },
  }
}

export function sourceCandlesFromBackendMessage(
  message: BackendMessage,
  targetCoin: string,
) {
  const expected = normalizeSymbol(targetCoin)

  if ('coin' in message && message.coin) {
    const actual = normalizeSymbol(message.coin)
    if (!symbolsMatch(actual, expected)) {
      return [] as SourceCandle[]
    }
  }

  if ('type' in message && message.type === 'snapshot') {
    return message.data
  }

  if ('type' in message && message.type === 'candle1s') {
    return [message.data]
  }

  return [] as SourceCandle[]
}
