import React, { useEffect, useState, useCallback } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { LogOut, Copy, Check } from 'lucide-react'

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1/balances'

// Circle Gateway EVM domain IDs (Solana excluded — incompatible address format)
const EVM_DOMAINS = [0, 1, 2, 3, 6, 7, 10, 13, 14, 16, 19, 26] as const

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export const Header: React.FC = () => {
  const { primaryWallet, handleLogOut } = useDynamicContext()
  const [balance, setBalance] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const walletAddress = primaryWallet?.address ?? ''

  const fetchBalance = useCallback(async () => {
    if (!walletAddress) return
    try {
      const res = await fetch(GATEWAY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'USDC',
          sources: EVM_DOMAINS.map((domain) => ({
            domain,
            depositor: walletAddress,
          })),
        }),
      })
      if (!res.ok) throw new Error('Gateway API error')
      const data = await res.json()

      const total = (data.balances ?? []).reduce(
        (sum: number, b: { balance: string }) => sum + parseFloat(b.balance || '0'),
        0,
      )
      setBalance(total.toFixed(2))
    } catch {
      setBalance('0.00')
    }
  }, [walletAddress])

  useEffect(() => {
    fetchBalance()
    const interval = setInterval(fetchBalance, 15_000)
    return () => clearInterval(interval)
  }, [fetchBalance])

  const handleCopy = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <header className="flex items-center justify-between px-8 py-4 shrink-0 border-b border-border bg-card/60 backdrop-blur-sm">
      <img
        src="/game-logo.svg"
        alt="Game"
        className="h-6 w-auto max-w-[240px] object-contain object-left select-none"
      />
      <div className="flex items-center gap-3">
        {/* USDC Balance */}
        <div className="flex items-center gap-2 bg-muted/60 rounded-full px-4 py-2">
          <img src="/usdc-logo.png" alt="USDC" width={20} height={20} className="shrink-0" />
          <span className="text-sm font-bold text-foreground tabular-nums">
            {balance !== null ? `${balance} USDC` : '— USDC'}
          </span>
        </div>

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
    </header>
  )
}
