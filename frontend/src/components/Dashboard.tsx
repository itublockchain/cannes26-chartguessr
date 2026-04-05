import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSSE } from '../context/SSEContext'
import { Separator } from './ui/separator'
import { BinanceChart } from './BinanceChart'
import { Button } from './ui/button'
import { Loader2, AlertCircle } from 'lucide-react'
import type { UserProfile } from '../App'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
const ENTRY_FEE = '1' // 1 USDC display

export interface DashboardProps {
  profile: UserProfile | null
}

type FlowState = 'idle' | 'joining' | 'searching' | 'matched' | 'error'

export const Dashboard: React.FC<DashboardProps> = ({ profile }) => {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { on } = useSSE()

  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // SSE: match_created → backend already handled entry fees, game starts
  useEffect(() => {
    const unsub = on('match_created', () => {
      setFlowState('matched')
      setTimeout(() => navigate('/game'), 800)
    })
    return unsub
  }, [on, navigate])

  // SSE: game_starting → navigate to game (data stored by GlobalGameStartListener)
  useEffect(() => {
    const unsub = on('game_starting', () => {
      navigate('/game')
    })
    return unsub
  }, [on, navigate])

  // SSE: match_cancelled → back to idle
  useEffect(() => {
    const unsub = on('match_cancelled', () => {
      setFlowState('idle')
    })
    return unsub
  }, [on])

  const handlePlay = useCallback(async () => {
    if (!token || !profile) return

    setFlowState('joining')
    setErrorMsg('')

    try {
      const res = await fetch(`${API_BASE}/match/queue/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ characterId: profile.avatar }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to join queue' }))
        throw new Error(data.error || 'Failed to join queue')
      }

      setFlowState('searching')
    } catch (err: any) {
      setFlowState('error')
      setErrorMsg(err?.message || 'Something went wrong')
    }
  }, [token, profile])

  const handleCancel = useCallback(async () => {
    if (!token) return
    try {
      await fetch(`${API_BASE}/match/queue/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
    } catch { /* ignore */ }
    setFlowState('idle')
  }, [token])

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left: 1v1 Invitation */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">

        {/* IDLE / ERROR */}
        {(flowState === 'idle' || flowState === 'error') && (
          <>
            <div className="flex flex-col items-center mb-8">
              <span className="text-xs font-bold tracking-[0.2em] uppercase text-muted-foreground mb-3">
                1 vs 1
              </span>
              <h1 className="text-4xl font-black tracking-tight text-foreground mb-3 text-center">
                Predict the Chart
              </h1>
              <p className="text-base text-muted-foreground text-center max-w-[360px] leading-relaxed">
                Draw your BTC price prediction against an opponent.
                Closest to the actual chart wins the pot.
              </p>
            </div>

            <div className="flex items-center gap-3 bg-muted/40 border border-border rounded-2xl px-6 py-4 mb-8">
              <img src="/usdc-logo.png" alt="USDC" width={28} height={28} className="shrink-0" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground font-medium">Entry Fee</span>
                <span className="text-lg font-bold text-foreground tabular-nums">{ENTRY_FEE} USDC</span>
              </div>
              <div className="ml-4 flex flex-col">
                <span className="text-xs text-muted-foreground font-medium">Win up to</span>
                <span className="text-lg font-bold text-green-400 tabular-nums">{Number(ENTRY_FEE) * 2} USDC</span>
              </div>
            </div>

            <Button
              onClick={handlePlay}
              disabled={!token || !profile}
              className="rounded-full px-12 py-6 text-base font-black tracking-wide"
            >
              PLAY NOW
            </Button>

            {flowState === 'error' && (
              <div className="flex items-center gap-2 mt-4">
                <AlertCircle size={14} className="text-destructive" />
                <p className="text-sm text-destructive">{errorMsg}</p>
              </div>
            )}

            <div className="flex items-center gap-6 mt-8 text-xs text-muted-foreground">
              <span>60s round</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
              <span>Live BTC/USD</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
              <span>On-chain settlement</span>
            </div>
          </>
        )}

        {/* JOINING / SEARCHING */}
        {(flowState === 'joining' || flowState === 'searching') && (
          <div className="flex flex-col items-center">
            <Loader2 size={40} className="animate-spin text-accent mb-6" />
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {flowState === 'joining' ? 'Joining Queue...' : 'Finding Opponent...'}
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
              Scanning the arena for challengers
            </p>
            {flowState === 'searching' && (
              <Button variant="outline" onClick={handleCancel} className="rounded-full px-8">
                Cancel
              </Button>
            )}
          </div>
        )}

        {/* MATCHED — heading to game */}
        {flowState === 'matched' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Match Starting!</h2>
            <p className="text-sm text-muted-foreground">Get ready...</p>
          </div>
        )}
      </div>

      {/* Divider */}
      <Separator orientation="vertical" />

      {/* Right: Live BTC Chart */}
      <div className="flex-1 min-h-0">
        <BinanceChart />
      </div>
    </div>
  )
}
