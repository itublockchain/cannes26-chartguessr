import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useSSE } from '../context/SSEContext'
import { useGameStatus } from '../context/GameStatusContext'
import { useAuth } from '../hooks/useAuth'
import { Loader2 } from 'lucide-react'
import { TradingChart, type DrawingPoint, type TradingChartGameConfig, OpponentMirrorChart } from './TradingChart'
import type { DrawingPointData } from '../types/sse'
import type { UserProfile } from '../App'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
const WS_URL = import.meta.env.VITE_WS_URL ?? API_BASE.replace(/^http/, 'ws')

export interface GameProps {
  profile: UserProfile | null
}

export const Game: React.FC<GameProps> = ({ profile }) => {
  const navigate = useNavigate()
  const { primaryWallet } = useDynamicContext()
  const { on } = useSSE()
  const { token } = useAuth()
  const { setPhase, setResult, consumePendingGameStart, clear: clearGameStatus } = useGameStatus()
  const matchIdRef = useRef<string | null>(null)
  const drawingSubmittedRef = useRef(false)
  const pendingPointsRef = useRef<DrawingPoint[]>([])
  const [gamePhase, setGamePhase] = useState<'waiting' | 'observing' | 'drawing' | 'resolution'>('waiting')
  const [phaseDurations, setPhaseDurations] = useState<{ observation: number; drawing: number; resolution: number } | null>(null)
  const [opponentDrawing, setOpponentDrawing] = useState<DrawingPointData[] | null>(null)
  const [gameRoundWindow, setGameRoundWindow] = useState<{ startTime: number; endTime: number } | null>(null)

  // Game config derived from backend phase durations
  const gameConfig = useMemo((): TradingChartGameConfig | undefined => {
    if (!phaseDurations) return undefined
    return {
      observationSeconds: phaseDurations.observation,
      tahminPhaseSeconds: phaseDurations.drawing,
      brushTargetSeconds: phaseDurations.resolution,
    }
  }, [phaseDurations])

  // Map SSE-driven game phase to chart's internal phase number
  const chartPhase = useMemo((): 1 | 2 | 3 | undefined => {
    if (gamePhase === 'observing') return 1
    if (gamePhase === 'drawing') return 2
    if (gamePhase === 'resolution') return 3
    return undefined
  }, [gamePhase])

  // On mount: consume any pending game_starting data from context (race condition fix)
  useEffect(() => {
    const pending = consumePendingGameStart()
    if (pending) {
      matchIdRef.current = pending.matchId
      drawingSubmittedRef.current = false
      pendingPointsRef.current = []
      setPhaseDurations({
        observation: pending.observationDuration,
        drawing: pending.drawingDuration,
        resolution: pending.resolutionDuration,
      })
      setGamePhase('observing')
      setPhase('observing', pending.observationDuration)
    } else {
      setPhase('waiting')
    }
    return () => clearGameStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SSE: game_starting → store matchId and phase durations
  useEffect(() => {
    return on('game_starting', (data) => {
      matchIdRef.current = data.matchId
      drawingSubmittedRef.current = false
      pendingPointsRef.current = []
      setOpponentDrawing(null)
      setPhaseDurations({
        observation: data.observationDuration,
        drawing: data.drawingDuration,
        resolution: data.resolutionDuration,
      })
      setGamePhase('observing')
      setPhase('observing', data.observationDuration)
    })
  }, [on, setPhase])

  // SSE: drawing_phase → enable drawing
  useEffect(() => {
    return on('drawing_phase', (data) => {
      setGamePhase('drawing')
      setPhase('drawing', data.drawingDuration)
    })
  }, [on, setPhase])

  // SSE: resolution_phase → split screen, show opponent drawing
  useEffect(() => {
    return on('resolution_phase', (data) => {
      setGamePhase('resolution')
      setPhase('resolution', data.resolutionDuration)
      if (data.opponentDrawing) {
        setOpponentDrawing(data.opponentDrawing)
      }
    })
  }, [on, setPhase])

  // SSE: calculating
  useEffect(() => {
    return on('calculating', () => {
      setPhase('calculating')
    })
  }, [on, setPhase])

  // SSE: match_cancelled → back to dashboard
  useEffect(() => {
    return on('match_cancelled', () => {
      clearGameStatus()
      navigate('/', { replace: true })
    })
  }, [on, navigate, clearGameStatus])

  // SSE: result → show in header, then navigate after delay
  useEffect(() => {
    return on('result', (data) => {
      const myAddress = primaryWallet?.address?.toLowerCase() ?? ''
      const won = data.winner?.toLowerCase() === myAddress
      setResult({
        won,
        isDraw: data.isDraw ?? false,
        payout: data.payout ?? null,
        player1Score: data.player1Score ?? 0,
        player2Score: data.player2Score ?? 0,
      })
      setTimeout(() => {
        clearGameStatus()
        navigate('/', { replace: true })
      }, 4000)
    })
  }, [on, navigate, clearGameStatus, setResult, primaryWallet])

  // Submit drawing to backend
  const submitDrawing = useCallback(async (points: DrawingPoint[]) => {
    const matchId = matchIdRef.current
    if (!matchId || !token || drawingSubmittedRef.current || points.length === 0) return

    drawingSubmittedRef.current = true
    try {
      await fetch(`${API_BASE}/match/draw/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          matchId,
          pathData: points,
        }),
      })
    } catch (err) {
      console.error('[Game] Submit failed:', err)
      drawingSubmittedRef.current = false
    }
  }, [token])

  // Collect drawing points as user draws
  const handleDrawingComplete = useCallback((points: DrawingPoint[]) => {
    if (points.length > 0) {
      pendingPointsRef.current = [...pendingPointsRef.current, ...points]
    }
  }, [])

  // Auto-submit drawing when game locks (drawing phase ends → resolution)
  const handleGameStateChange = useCallback((state: 'drawing' | 'locked' | 'scored') => {
    console.log('[Game State]', state)
    if (state === 'locked') {
      // Submit accumulated drawing points
      if (pendingPointsRef.current.length > 0) {
        submitDrawing(pendingPointsRef.current)
      }
    }
  }, [submitDrawing])

  // Opponent mirror chart shown in right half during resolution
  const opponentPane = useMemo(() => {
    if (gamePhase !== 'resolution' || !gameRoundWindow) return null
    return (
      <OpponentMirrorChart
        wsUrl={WS_URL}
        gameWindow={gameRoundWindow}
        opponentDrawing={opponentDrawing}
      />
    )
  }, [gamePhase, gameRoundWindow, opponentDrawing])

  if (!gameConfig) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="animate-spin" size={20} />
          <p className="text-lg">Waiting for match to start...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0">
      <TradingChart
        wsUrl={WS_URL}
        gameConfig={gameConfig}
        externalPhase={chartPhase}
        onDrawingComplete={handleDrawingComplete}
        onGameStateChange={handleGameStateChange}
        resultSidePane={opponentPane}
        onGameRoundWindowKnown={setGameRoundWindow}
      />
    </div>
  )
}
