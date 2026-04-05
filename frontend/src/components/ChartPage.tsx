import { useCallback, useState } from 'react'
import {
  OpponentMirrorChart,
  TradingChart,
  type MirrorGameWindow,
} from './TradingChart'

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000'

export function ChartPage() {
  const [gameRoundWindow, setGameRoundWindow] =
    useState<MirrorGameWindow | null>(null)

  const onGameRoundWindowKnown = useCallback((w: MirrorGameWindow) => {
    setGameRoundWindow(w)
  }, [])

  return (
    <TradingChart
      wsUrl={WS_URL}
      onGameRoundWindowKnown={onGameRoundWindowKnown}
      resultSidePane={
        <OpponentMirrorChart wsUrl={WS_URL} gameWindow={gameRoundWindow} />
      }
      onDrawingComplete={(points) => {
        console.log('[Drawing]', points)
      }}
      onGameStateChange={(state) => {
        console.log('[Game State]', state)
      }}
    />
  )
}
