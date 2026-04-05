import { useEffect, useState, useRef, useCallback } from 'react'
import { getAuthToken, useIsLoggedIn } from '@dynamic-labs/sdk-react-core'
import type { UserProfile } from '../App'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

interface AuthState {
  token: string | null
  profile: UserProfile | null
  loading: boolean
  delegateActive: boolean
}

export function useAuth() {
  const isLoggedIn = useIsLoggedIn()
  const [state, setState] = useState<AuthState>({ token: null, profile: null, loading: true, delegateActive: false })
  const verifyingRef = useRef(false)

  useEffect(() => {
    if (!isLoggedIn) {
      setState({ token: null, profile: null, loading: false, delegateActive: false })
      return
    }

    // isLoggedIn just became true — block redirects until verify completes
    setState(s => ({ ...s, loading: true }))

    const verify = async () => {
      if (verifyingRef.current) return
      verifyingRef.current = true

      try {
        const dynamicToken = getAuthToken()
        if (!dynamicToken) {
          setState(s => ({ ...s, loading: false }))
          return
        }

        // 1. Get backend JWT
        const authRes = await fetch(`${API_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dynamicToken }),
        })
        if (!authRes.ok) throw new Error('Auth verify failed')
        const { token: backendToken } = await authRes.json()

        // 2. Fetch profile from backend
        let profile: UserProfile | null = null
        const profileRes = await fetch(`${API_BASE}/user/profile`, {
          headers: { Authorization: `Bearer ${backendToken}` },
        })
        let delegateActive = false
        if (profileRes.ok) {
          const { user } = await profileRes.json()
          if (user.username && user.characterId) {
            profile = { nickname: user.username, avatar: user.characterId }
          }
          delegateActive = !!user.delegateActive
        }

        // 3. Set everything in one update
        setState({ token: backendToken, profile, loading: false, delegateActive })
      } catch (err) {
        console.error('[Auth] Verification failed:', err)
        setState({ token: null, profile: null, loading: false, delegateActive: false })
      } finally {
        verifyingRef.current = false
      }
    }

    verify()
  }, [isLoggedIn])

  const saveProfile = useCallback(async (nickname: string, avatar: string) => {
    if (!state.token) return
    const res = await fetch(`${API_BASE}/user/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ username: nickname, characterId: avatar }),
    })
    if (!res.ok) throw new Error('Failed to save profile')
    setState(s => ({ ...s, profile: { nickname, avatar } }))
  }, [state.token])

  const markDelegateActive = useCallback(async () => {
    if (!state.token) return
    await fetch(`${API_BASE}/user/delegate-confirmed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    })
    setState(s => ({ ...s, delegateActive: true }))
  }, [state.token])

  return {
    token: state.token,
    profile: state.profile,
    loading: state.loading,
    delegateActive: state.delegateActive,
    saveProfile,
    markDelegateActive,
  }
}
