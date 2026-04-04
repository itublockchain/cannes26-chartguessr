import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useGameStateSSE } from './hooks/useGameStateSSE'
import { ProfileCreation } from './components/ProfileCreation'
import { Dashboard } from './components/Dashboard'
import { Connect } from './components/Connect'
import { Game } from './components/Game'

export interface UserProfile {
  nickname: string;
  avatar: string;
}

function App() {
  // Keeps server-sent events alive
  useGameStateSSE()
  
  const { primaryWallet } = useDynamicContext()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

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
      {/* Mobile/Tablet Screen Warning Overlay (< 800px) */}
      <div className="hidden max-[800px]:flex fixed inset-0 z-[9999] bg-radial-space text-white flex-col items-center justify-center p-8 text-center select-none">
        {/* Background removed */}
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

      <Routes>
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
    </>
  )
}

export default App
