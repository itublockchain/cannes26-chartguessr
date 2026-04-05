import { useEffect, useState, useCallback } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useDynamicContext, DynamicWidget } from '@dynamic-labs/sdk-react-core'
import { useAuth } from './hooks/useAuth'
import { SSEProvider, useSSE } from './context/SSEContext'
import { GameStatusProvider, useGameStatus } from './context/GameStatusContext'
import { ProfileCreation } from './components/ProfileCreation'
import { DelegateSetup } from './components/DelegateSetup'
import { Dashboard } from './components/Dashboard'
import { Connect } from './components/Connect'
import { Game } from './components/Game'
import { Header } from './components/Header'
import { SmoothChart } from './components/SmoothChart/SmoothChart'

export interface UserProfile {
  nickname: string;
  avatar: string;
}

const ARC_TESTNET_CHAIN_ID = 5042002

/**
 * Always-mounted listener: captures game_starting SSE events so they're never
 * lost during route transitions (Dashboard unmount → Game mount gap).
 */
function GlobalGameStartListener() {
  const { on } = useSSE()
  const { setPendingGameStart } = useGameStatus()

  useEffect(() => {
    return on('game_starting', (data) => {
      setPendingGameStart({
        matchId: data.matchId,
        startPrice: data.startPrice,
        observationDuration: data.observationDuration,
        drawingDuration: data.drawingDuration,
        resolutionDuration: data.resolutionDuration,
      })
    })
  }, [on, setPendingGameStart])

  return null
}

function App() {
  const { primaryWallet, sdkHasLoaded } = useDynamicContext()
  const { token, profile, loading, delegateActive, saveProfile, markDelegateActive } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Auto-switch to ARC Testnet when wallet connects
  useEffect(() => {
    if (primaryWallet) {
      primaryWallet.switchNetwork(ARC_TESTNET_CHAIN_ID).catch(console.error)
    }
  }, [primaryWallet])

  // Centralized redirect logic
  useEffect(() => {
    if (!sdkHasLoaded || loading) return

    // Exempt /smooth-chart from redirect logic
    if (location.pathname === '/smooth-chart') return

    if (!primaryWallet && location.pathname !== '/connect') {
      navigate('/connect', { replace: true })
    } else if (primaryWallet && !profile && location.pathname !== '/profile') {
      navigate('/profile', { replace: true })
    } else if (primaryWallet && profile && !delegateActive && location.pathname !== '/delegate') {
      navigate('/delegate', { replace: true })
    } else if (primaryWallet && profile && delegateActive && ['/connect', '/profile', '/delegate'].includes(location.pathname)) {
      navigate('/', { replace: true })
    }
  }, [sdkHasLoaded, loading, primaryWallet, profile, delegateActive, location.pathname, navigate])

  return (
    <SSEProvider token={token}>
    <GameStatusProvider>
      <GlobalGameStartListener />
      {/* Mobile/Tablet Screen Warning Overlay (< 800px) */}
      <div className="hidden max-[800px]:flex fixed inset-0 z-[9999] bg-background text-foreground flex-col items-center justify-center p-8 text-center select-none">
        <div className="flex flex-col items-center bg-card p-10 rounded-3xl border border-border shadow-lg">
          <h2 className="text-2xl font-black text-foreground mb-4">
            Switch to Desktop
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed max-w-[400px]">
            CryptoPredict requires a minimum screen width of 800px. Please resize your window or switch to a larger device.
          </p>
        </div>
      </div>

      <Routes>
        <Route path="/connect" element={<Connect />} />
        <Route
          path="/profile"
          element={
            <ProfileCreation
              onProfileSaved={async (nickname, avatar) => {
                await saveProfile(nickname, avatar)
                navigate('/')
              }}
            />
          }
        />
        <Route
          path="/delegate"
          element={
            <DelegateSetup
              onComplete={async () => {
                await markDelegateActive()
                navigate('/')
              }}
            />
          }
        />
        <Route path="/" element={<div className="absolute inset-0 flex flex-col"><Header /><Dashboard profile={profile} /></div>} />
        <Route path="/game" element={<div className="absolute inset-0 flex flex-col"><Header /><Game profile={profile} /></div>} />
        <Route path="/smooth-chart" element={<SmoothChart />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GameStatusProvider>
    </SSEProvider>
  )
}

export default App
