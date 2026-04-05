import React, { useState, useEffect } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import {
  createPublicClient,
  parseUnits,
  http,
  type Address,
} from 'viem'
import { useChainBalances, CHAINS, type SupportedChain } from '../hooks/useBalances'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'

const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const

const erc20Abi = [
  {
    type: 'function' as const,
    name: 'approve',
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const gatewayWalletAbi = [
  {
    type: 'function' as const,
    name: 'deposit',
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

type Step = 'idle' | 'switching' | 'approving' | 'depositing' | 'success' | 'error'

interface DepositModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeposited?: () => void
}

export const DepositModal: React.FC<DepositModalProps> = ({
  open,
  onOpenChange,
  onDeposited,
}) => {
  const { primaryWallet } = useDynamicContext()
  const walletAddress = primaryWallet?.address

  const { data: usdcBalances, isLoading: balancesLoading } = useChainBalances(
    open ? walletAddress : undefined,
  )

  const [selected, setSelected] = useState<SupportedChain>(CHAINS[0])
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [chainPickerOpen, setChainPickerOpen] = useState(false)

  // Auto-select first chain with balance
  useEffect(() => {
    if (!usdcBalances) return
    const withBalance = CHAINS.find((c) => parseFloat(usdcBalances[c.key] || '0') > 0)
    if (withBalance) setSelected(withBalance)
  }, [usdcBalances])

  const chainsWithBalance = CHAINS.filter(
    (c) => parseFloat(usdcBalances?.[c.key] || '0') > 0,
  )

  const reset = () => {
    setAmount('')
    setStep('idle')
    setErrorMsg('')
    setChainPickerOpen(false)
  }

  const handleClose = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const handleDeposit = async () => {
    if (!primaryWallet || !amount || parseFloat(amount) <= 0) return

    try {
      const account = primaryWallet.address as Address

      // Switch network if needed
      setStep('switching')
      await primaryWallet.switchNetwork(selected.chainId)

      const walletClient = await (primaryWallet as any).getWalletClient()

      const publicClient = createPublicClient({
        chain: selected.chain,
        transport: http(selected.rpc),
      })

      const value = parseUnits(amount, 6)

      // Step 1: Approve
      setStep('approving')
      const approveHash = await walletClient.writeContract({
        account,
        chain: selected.chain,
        address: selected.usdc,
        abi: erc20Abi,
        functionName: 'approve',
        args: [GATEWAY_WALLET, value],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })

      // Step 2: Deposit
      setStep('depositing')
      const depositHash = await walletClient.writeContract({
        account,
        chain: selected.chain,
        address: GATEWAY_WALLET,
        abi: gatewayWalletAbi,
        functionName: 'deposit',
        args: [selected.usdc, value],
      })
      await publicClient.waitForTransactionReceipt({ hash: depositHash })

      setStep('success')
      onDeposited?.()
    } catch (err: any) {
      setStep('error')
      setErrorMsg(err?.shortMessage || err?.message || 'Transaction failed')
    }
  }

  const parsedAmount = parseFloat(amount)
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0
  const chainBalance = usdcBalances?.[selected.key]

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/usdc-logo.png" alt="USDC" width={24} height={24} />
            Deposit USDC
          </DialogTitle>
          <DialogDescription>
            Deposit USDC from any supported chain into your unified Gateway balance.
          </DialogDescription>
        </DialogHeader>

        {step === 'idle' && (
          <div className="flex flex-col gap-4 pt-2">
            {/* Chain selector */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Source Chain
              </label>

              {balancesLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2.5 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  Loading balances...
                </div>
              ) : chainsWithBalance.length === 0 ? (
                <div className="rounded-md border border-input bg-background px-3 py-2.5 text-sm text-muted-foreground">
                  No USDC found on any chain
                </div>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setChainPickerOpen(!chainPickerOpen)}
                    className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <span className="font-medium">{selected.name}</span>
                    <div className="flex items-center gap-2">
                      {chainBalance !== undefined && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {parseFloat(chainBalance).toFixed(2)} USDC
                        </span>
                      )}
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </div>
                  </button>

                  {chainPickerOpen && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-lg max-h-[240px] overflow-y-auto">
                      {chainsWithBalance.map((c) => (
                        <button
                          key={c.key}
                          onClick={() => {
                            setSelected(c)
                            setChainPickerOpen(false)
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors ${
                            c.key === selected.key ? 'bg-muted/30' : ''
                          }`}
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {parseFloat(usdcBalances?.[c.key] || '0').toFixed(2)} USDC
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Amount */}
            {chainsWithBalance.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-foreground">Amount</label>
                  {chainBalance !== undefined && (
                    <button
                      onClick={() => setAmount(chainBalance)}
                      className="text-xs text-accent hover:underline cursor-pointer"
                    >
                      Max: {parseFloat(chainBalance).toFixed(2)}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                    USDC
                  </span>
                </div>
              </div>
            )}

            {chainsWithBalance.length > 0 && (
              <Button
                onClick={handleDeposit}
                disabled={!isValid}
                className="w-full rounded-full font-bold"
              >
                Deposit from {selected.name}
              </Button>
            )}
          </div>
        )}

        {(step === 'switching' || step === 'approving' || step === 'depositing') && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 size={36} className="animate-spin text-accent" />
            <div className="text-center">
              <p className="font-semibold text-foreground">
                {step === 'switching'
                  ? `Switching to ${selected.name}...`
                  : step === 'approving'
                    ? 'Approving USDC...'
                    : 'Depositing...'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {step === 'switching'
                  ? 'Confirm the network switch in your wallet'
                  : step === 'approving'
                    ? 'Confirm the approval in your wallet'
                    : 'Confirm the deposit in your wallet'}
              </p>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 size={36} className="text-green-500" />
            <div className="text-center">
              <p className="font-semibold text-foreground">Deposit Successful</p>
              <p className="text-sm text-muted-foreground mt-1">
                {amount} USDC deposited from {selected.name}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-2 max-w-[300px]">
                Your unified balance will update once the transaction reaches finality. This typically takes 13–19 minutes depending on the chain.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              className="rounded-full"
            >
              Done
            </Button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <AlertCircle size={36} className="text-destructive" />
            <div className="text-center">
              <p className="font-semibold text-foreground">Transaction Failed</p>
              <p className="text-sm text-muted-foreground mt-1 break-all">
                {errorMsg}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setStep('idle')}
              className="rounded-full"
            >
              Try Again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
