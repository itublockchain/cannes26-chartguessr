import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from 'react'
import type { SSEEventMap, SSEEventType } from '../types/sse'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

type SSEListener<T extends SSEEventType = SSEEventType> = (data: SSEEventMap[T]) => void

interface SSEContextValue {
  /** Whether the SSE connection is open */
  connected: boolean
  /** Subscribe to a named SSE event. Returns an unsubscribe function. */
  on: <T extends SSEEventType>(event: T, listener: SSEListener<T>) => () => void
}

const SSEContext = createContext<SSEContextValue | null>(null)

const SSE_EVENTS: SSEEventType[] = [
  'match_created',
  'player_entered',
  'match_locked',
  'game_starting',
  'price_tick',
  'drawing_submitted',
  'calculating',
  'result',
  'match_cancelled',
]

export function SSEProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const listenersRef = useRef(new Map<SSEEventType, Set<SSEListener<any>>>())
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectRef = useRef<number | null>(null)

  const emit = useCallback(<T extends SSEEventType>(event: T, data: SSEEventMap[T]) => {
    const set = listenersRef.current.get(event)
    if (set) {
      for (const fn of set) fn(data)
    }
  }, [])

  const on = useCallback(<T extends SSEEventType>(event: T, listener: SSEListener<T>) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set())
    }
    listenersRef.current.get(event)!.add(listener)
    return () => {
      listenersRef.current.get(event)?.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setConnected(false)
      return
    }

    const connect = () => {
      const es = new EventSource(`${API_BASE}/sse/connect?token=${encodeURIComponent(token)}`)
      eventSourceRef.current = es

      es.onopen = () => {
        console.log('[SSE] Connected')
        setConnected(true)
      }

      // Register listeners for each named event
      for (const eventName of SSE_EVENTS) {
        es.addEventListener(eventName, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data)
            if (eventName === 'price_tick') {
              const price = Number(data.report?.price) / 1e18
              console.log(`[SSE] price_tick — BTC/USD: $${price.toFixed(2)}`)
            }
            emit(eventName, data)
          } catch (err) {
            console.error(`[SSE] Failed to parse ${eventName}:`, err)
          }
        })
      }

      es.onerror = () => {
        console.warn('[SSE] Connection error, reconnecting in 5s...')
        es.close()
        eventSourceRef.current = null
        setConnected(false)
        reconnectRef.current = window.setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      if (reconnectRef.current !== null) {
        clearTimeout(reconnectRef.current)
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setConnected(false)
    }
  }, [token, emit])

  return (
    <SSEContext.Provider value={{ connected, on }}>
      {children}
    </SSEContext.Provider>
  )
}

export function useSSE() {
  const ctx = useContext(SSEContext)
  if (!ctx) throw new Error('useSSE must be used within SSEProvider')
  return ctx
}
