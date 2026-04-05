import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

export type GamePhase = 'waiting' | 'observing' | 'drawing' | 'resolution' | 'calculating' | 'result' | null

export interface GameResult {
  won: boolean
  isDraw: boolean
  payout: string | null
  player1Score: number
  player2Score: number
}

export interface GameStartData {
  matchId: string
  startPrice: number
  observationDuration: number
  drawingDuration: number
  resolutionDuration: number
}

interface GameStatusContextValue {
  phase: GamePhase
  /** Epoch seconds when the current phase ends */
  phaseEndTime: number | null
  /** Non-null when phase === 'result' */
  result: GameResult | null
  /** Stored game_starting event data so late-mounting components can read it */
  pendingGameStart: GameStartData | null
  setPhase: (phase: GamePhase, durationSeconds?: number) => void
  setResult: (result: GameResult) => void
  setPendingGameStart: (data: GameStartData) => void
  consumePendingGameStart: () => GameStartData | null
  clear: () => void
}

const GameStatusContext = createContext<GameStatusContextValue | null>(null)

export function GameStatusProvider({ children }: { children: ReactNode }) {
  const [phase, setPhaseState] = useState<GamePhase>(null)
  const [phaseEndTime, setPhaseEndTime] = useState<number | null>(null)
  const [result, setResultState] = useState<GameResult | null>(null)
  const pendingGameStartRef = useRef<GameStartData | null>(null)
  const [, forceUpdate] = useState(0)

  const setPhase = useCallback((p: GamePhase, durationSeconds?: number) => {
    setPhaseState(p)
    setPhaseEndTime(durationSeconds ? Date.now() / 1000 + durationSeconds : null)
    if (p !== 'result') setResultState(null)
  }, [])

  const setResult = useCallback((r: GameResult) => {
    setPhaseState('result')
    setPhaseEndTime(null)
    setResultState(r)
  }, [])

  const setPendingGameStart = useCallback((data: GameStartData) => {
    pendingGameStartRef.current = data
    forceUpdate(n => n + 1)
  }, [])

  const consumePendingGameStart = useCallback((): GameStartData | null => {
    const data = pendingGameStartRef.current
    pendingGameStartRef.current = null
    return data
  }, [])

  const clear = useCallback(() => {
    setPhaseState(null)
    setPhaseEndTime(null)
    setResultState(null)
    pendingGameStartRef.current = null
  }, [])

  return (
    <GameStatusContext.Provider value={{
      phase, phaseEndTime, result,
      pendingGameStart: pendingGameStartRef.current,
      setPhase, setResult, setPendingGameStart, consumePendingGameStart, clear,
    }}>
      {children}
    </GameStatusContext.Provider>
  )
}

export function useGameStatus() {
  const ctx = useContext(GameStatusContext)
  if (!ctx) throw new Error('useGameStatus must be used within GameStatusProvider')
  return ctx
}

/** Ticking countdown hook — returns seconds remaining (0 when expired). */
export function useCountdown(endTime: number | null): number {
  const [remaining, setRemaining] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (endTime === null) {
      setRemaining(0)
      return
    }

    const tick = () => {
      const left = Math.max(0, Math.ceil(endTime - Date.now() / 1000))
      setRemaining(left)
      if (left > 0) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    tick()

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [endTime])

  return remaining
}
