import { useEffect, useState } from 'react'
import { useSSE } from '../context/SSEContext'
import type { SSEEventType, SSEEventMap } from '../types/sse'

/** Holds the latest event received from SSE */
export interface LatestSSEEvent {
  type: SSEEventType
  data: SSEEventMap[SSEEventType]
}

/**
 * Subscribes to all SSE events and returns the latest one.
 * Must be used inside SSEProvider.
 */
export function useGameStateSSE() {
  const { on, connected } = useSSE()
  const [latestEvent, setLatestEvent] = useState<LatestSSEEvent | null>(null)

  useEffect(() => {
    const events: SSEEventType[] = [
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

    const unsubs = events.map((eventName) =>
      on(eventName, (data) => {
        setLatestEvent({ type: eventName, data })
      })
    )

    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [on])

  return { latestEvent, connected }
}
