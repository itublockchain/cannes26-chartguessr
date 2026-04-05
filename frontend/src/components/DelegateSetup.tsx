import React, { useState, useEffect } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { createPublicClient, http, type Address } from 'viem'
import { Button } from './ui/button'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

const ARC_TESTNET_CHAIN_ID = 5042002
const ARC_RPC = 'https://rpc.testnet.arc.network'
const ARC_CHAIN = {
  id: ARC_TESTNET_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] } },
} as const

const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const

const addDelegateAbi = [
  {
    type: 'function' as const,
    name: 'addDelegate',
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'delegate', type: 'address' },
    ],
    outputs: [],
  },
] as const

interface DelegateSetupProps {
  onComplete: () => void
}

type Step = 'intro' | 'switching' | 'confirming' | 'success' | 'error'

export const DelegateSetup: React.FC<DelegateSetupProps> = ({ onComplete }) => {
  const { primaryWallet } = useDynamicContext()
  const [step, setStep] = useState<Step>('intro')
  const [errorMsg, setErrorMsg] = useState('')
  const [config, setConfig] = useState<{ operatorAddress: string; usdcAddress: string } | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {})
  }, [])

  const handleDelegate = async () => {
    if (!primaryWallet || !config) return

    try {
      const account = primaryWallet.address as Address

      setStep('switching')
      await primaryWallet.switchNetwork(ARC_TESTNET_CHAIN_ID)

      const walletClient = await (primaryWallet as any).getWalletClient()
      const publicClient = createPublicClient({
        chain: ARC_CHAIN as any,
        transport: http(ARC_RPC),
      })

      setStep('confirming')
      const hash = await walletClient.writeContract({
        account,
        chain: ARC_CHAIN,
        address: GATEWAY_WALLET,
        abi: addDelegateAbi,
        functionName: 'addDelegate',
        args: [config.usdcAddress as Address, config.operatorAddress as Address],
      })
      await publicClient.waitForTransactionReceipt({ hash })

      setStep('success')
    } catch (err: any) {
      setStep('error')
      setErrorMsg(err?.shortMessage || err?.message || 'Transaction failed')
    }
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center max-w-[420px] px-6 text-center">
        {step === 'intro' && (
          <>
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-6">
              <ShieldCheck size={32} className="text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-3">
              Authorize Game Wallet
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">
              To play matches, ChartGuesser needs permission to manage your USDC entry fees through Circle Gateway.
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed mb-8">
              This is a one-time on-chain approval on Arc Testnet. You can revoke it anytime.
            </p>
            <Button
              onClick={handleDelegate}
              disabled={!config}
              className="rounded-full px-10 py-5 text-base font-bold"
            >
              Authorize
            </Button>
          </>
        )}

        {(step === 'switching' || step === 'confirming') && (
          <>
            <Loader2 size={40} className="animate-spin text-accent mb-6" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              {step === 'switching' ? 'Switching Network...' : 'Confirm in Wallet...'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {step === 'switching'
                ? 'Switching to Arc Testnet'
                : 'Approve the delegate authorization in your wallet'}
            </p>
          </>
        )}

        {step === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">All Set!</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your game wallet is authorized. You're ready to play.
            </p>
            <Button onClick={onComplete} className="rounded-full px-10 py-5 text-base font-bold">
              Let's Go
            </Button>
          </>
        )}

        {step === 'error' && (
          <>
            <AlertCircle size={40} className="text-destructive mb-6" />
            <h2 className="text-xl font-bold text-foreground mb-2">Authorization Failed</h2>
            <p className="text-sm text-muted-foreground mb-6 break-all">{errorMsg}</p>
            <Button variant="outline" onClick={() => setStep('intro')} className="rounded-full px-8">
              Try Again
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
