import { useEffect, useState, useCallback } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useDynamicContext, DynamicWidget } from '@dynamic-labs/sdk-react-core'
import { useGameStateSSE } from './hooks/useGameStateSSE'
import { ProfileCreation } from './components/ProfileCreation'
import { Dashboard } from './components/Dashboard'
import { Connect } from './components/Connect'
import { Game } from './components/Game'
import { AnimatedBackground } from './components/AnimatedBackground'
import { PageTransition } from './components/PageTransition'

export interface UserProfile {
  nickname: string;
  avatar: string;
}

const ARC_TESTNET_CHAIN_ID = 5042002

function App() {
  // Keeps server-sent events alive
  useGameStateSSE()

  const { primaryWallet } = useDynamicContext()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [cardScale, setCardScale] = useState(1)
  const navigate = useNavigate()
  const location = useLocation()

  const updateScale = useCallback(() => {
    const scaleX = Math.min(1, (window.innerWidth - 120) / 1300)
    const scaleY = Math.min(1, (window.innerHeight - 120) / 900)
    setCardScale(Math.max(0.5, Math.min(scaleX, scaleY)))
  }, [])

  useEffect(() => {
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [updateScale])

  // Auto-switch to ARC Testnet when wallet connects
  useEffect(() => {
    if (primaryWallet) {
      primaryWallet.switchNetwork(ARC_TESTNET_CHAIN_ID).catch(console.error)
    }
  }, [primaryWallet])

  // Centralized redirect logic for guarding routes based on authentication state
  useEffect(() => {
    // Wallet is not connected
    if (!primaryWallet && location.pathname !== '/connect') {
      navigate('/connect', { replace: true })
    } 
    // Wallet is connected, but no profile exists
    else if (primaryWallet && !profile && location.pathname !== '/profile') {
      navigate('/profile', { replace: true })
    }
    // Wallet is connected and profile exists, but user is on a login/onboarding page
    else if (primaryWallet && profile && (location.pathname === '/connect' || location.pathname === '/profile')) {
      navigate('/', { replace: true })
    }
  }, [primaryWallet, profile, location.pathname, navigate])

  return (
    <>
      <AnimatedBackground />

      {/* Mobile/Tablet Screen Warning Overlay (< 800px) */}
      <div className="hidden max-[800px]:flex fixed inset-0 z-[9999] bg-[#05091e] text-white flex-col items-center justify-center p-8 text-center select-none">
        <div className="z-10 flex flex-col items-center bg-[#1e1e3c]/80 backdrop-blur-md p-10 rounded-3xl border border-white/10 shadow-2xl">
          <span className="text-6xl mb-6">⚠️</span>
          <h2 className="text-4xl font-black text-[#ffcc00] mb-4 drop-shadow-[0_0_15px_rgba(255,204,0,0.5)]">
            Switch to Desktop
          </h2>
          <p className="text-xl text-[#e0e0e0] leading-relaxed max-w-[400px]">
            CryptoPredict requires a minimum screen width of 800px. Please resize your window or switch to a larger device for the best experience.
          </p>
        </div>
      </div>

      <div className="w-screen h-screen flex items-center justify-center overflow-hidden">
        <div className="flex flex-col items-end gap-3" style={{ transform: `scale(${cardScale})`, transformOrigin: 'center center' }}>
          {/* Dynamic Widget - above card, right-aligned */}
          <div className="z-[999]">
            <DynamicWidget
              innerButtonComponent={
                primaryWallet ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '9px', color: '#f5f5f5', fontFamily: "'Neue Haas Grotesk Display', sans-serif", fontSize: '13px', fontWeight: 500 }}>
                    Wallet Connected
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#639ce6', boxShadow: '0 0 6px rgba(99,156,230,0.8)', flexShrink: 0 }} />
                    {primaryWallet.address.slice(0, 6)}...{primaryWallet.address.slice(-4)}
                  </span>
                ) : (
                  <span style={{ color: '#f5f5f5', fontFamily: "'Neue Haas Grotesk Display', sans-serif", fontSize: '13px', fontWeight: 500 }}>Connect Wallet</span>
                )
              }
            />
          </div>

          {/* Card */}
          <div className="card">
            <PageTransition>
              {(displayLocation) => (
                <Routes location={displayLocation}>
                  <Route path="/connect" element={<Connect />} />

                  <Route
                    path="/profile"
                    element={
                      <ProfileCreation
                        onProfileSaved={(nickname, avatar) => {
                          console.log("Saved profile:", { nickname, avatar });
                          setProfile({ nickname, avatar });
                          navigate('/');
                        }}
                      />
                    }
                  />

                  <Route path="/" element={<Dashboard profile={profile} />} />

                  {/* The Game Arena Route */}
                  <Route path="/game" element={<Game profile={profile} />} />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              )}
            </PageTransition>
          </div>
        </div>
      </div>
    </>
  )
}

export default App
