import React, { useState } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { useGameStatus, useCountdown, type GamePhase, type GameResult } from '../context/GameStatusContext'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { DepositModal } from './DepositModal'
import { LogOut, Copy, Check, Eye, Pencil, BarChart3, Loader2, Trophy, Handshake } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const PHASE_CONFIG: Record<Exclude<GamePhase, null | 'result'>, { label: string; icon: React.ReactNode; color: string }> = {
  waiting: { label: 'Waiting', icon: <Loader2 size={14} className="animate-spin" />, color: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
  observing: { label: 'Observing', icon: <Eye size={14} />, color: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  drawing: { label: 'Drawing', icon: <Pencil size={14} />, color: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  resolution: { label: 'Resolution', icon: <BarChart3 size={14} />, color: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  calculating: { label: 'Calculating', icon: <Loader2 size={14} className="animate-spin" />, color: 'bg-orange-500/15 text-orange-500 border-orange-500/30' },
}

function ResultBadge({ result }: { result: GameResult }) {
  if (result.isDraw) {
    return (
      <div className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold border bg-yellow-500/15 text-yellow-500 border-yellow-500/30 animate-in fade-in duration-300">
        <Handshake size={16} />
        <span>Draw</span>
      </div>
    )
  }

  const payoutDisplay = result.payout
    ? `+${(Number(result.payout) / 1e6).toFixed(2)} USDC`
    : null

  return (
    <div className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold border animate-in fade-in duration-300 ${
      result.won
        ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
        : 'bg-red-500/15 text-red-500 border-red-500/30'
    }`}>
      <Trophy size={16} />
      <span>{result.won ? 'You Won!' : 'You Lost'}</span>
      {payoutDisplay && result.won && (
        <span className="font-mono text-xs opacity-80">{payoutDisplay}</span>
      )}
    </div>
  )
}

function GameStatusBadge() {
  const { phase, phaseEndTime, result } = useGameStatus()
  const remaining = useCountdown(phaseEndTime)

  if (!phase) return null

  if (phase === 'result' && result) {
    return <ResultBadge result={result} />
  }

  const cfg = PHASE_CONFIG[phase as Exclude<GamePhase, null | 'result'>]
  if (!cfg) return null

  return (
    <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold border ${cfg.color} tabular-nums`}>
      {cfg.icon}
      <span>{cfg.label}</span>
      {remaining > 0 && <span className="font-mono text-xs opacity-80">{remaining}s</span>}
    </div>
  )
}

function useGameBalance(token: string | null) {
  return useQuery({
    queryKey: ['gameBalance', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/user/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Balance fetch failed')
      return res.json() as Promise<{ gatewayBalance: string; lockedAmount: string; available: string }>
    },
    enabled: !!token,
  })
}

export const Header: React.FC = () => {
  const { primaryWallet, handleLogOut } = useDynamicContext()
  const { token } = useAuth()
  const [copied, setCopied] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const queryClient = useQueryClient()

  const walletAddress = primaryWallet?.address ?? ''

  const { data: balance, isLoading: balanceLoading } = useGameBalance(token)

  const handleCopy = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDeposited = () => {
    queryClient.invalidateQueries({ queryKey: ['gameBalance'] })
    queryClient.invalidateQueries({ queryKey: ['chainBalances'] })
  }

  return (
    <header className="flex items-center justify-between px-8 py-4 shrink-0 border-b border-border bg-card/60 backdrop-blur-sm">
      <img
        src="/game-logo.svg"
        alt="Game"
        className="h-6 w-auto max-w-[240px] object-contain object-left select-none"
      />
      <div className="flex items-center gap-3">
        {/* USDC Balance — click to deposit */}
        <button
          onClick={() => setDepositOpen(true)}
          className="flex items-center gap-2 bg-muted/60 rounded-full px-4 py-2 hover:bg-muted transition-colors cursor-pointer"
        >
          <img src="/usdc-logo.png" alt="USDC" width={20} height={20} className="shrink-0" />
          <span className="text-sm font-bold text-foreground tabular-nums">
            {balanceLoading ? '...' : balance ? `${balance.available} USDC` : '— USDC'}
          </span>
        </button>

        <Separator orientation="vertical" className="h-6" />

        {/* Wallet Address */}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 bg-muted/60 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <span className="font-mono text-xs">{truncateAddress(walletAddress)}</span>
          {copied ? (
            <Check size={13} className="text-green-500" />
          ) : (
            <Copy size={13} />
          )}
        </button>

        <Separator orientation="vertical" className="h-6" />

        {/* Logout */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogOut}
          className="text-muted-foreground hover:text-white"
        >
          <LogOut size={16} />
        </Button>
      </div>

      <DepositModal
        open={depositOpen}
        onOpenChange={setDepositOpen}
        onDeposited={handleDeposited}
      />
    </header>
  )
}
