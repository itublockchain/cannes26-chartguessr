import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, formatUnits, type Address } from 'viem'
import type { Chain } from 'viem'

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1/balances'

// Circle Gateway EVM domain IDs (Solana excluded)
const EVM_DOMAINS = [0, 1, 2, 3, 6, 7, 10, 13, 14, 16, 19, 26] as const

export type SupportedChain = {
  key: string
  name: string
  chainId: number
  domain: number
  usdc: Address
  rpc: string
  chain: Chain
}

export const CHAINS: SupportedChain[] = [
  {
    key: 'arcTestnet',
    name: 'Arc Testnet',
    chainId: 5042002,
    domain: 26,
    usdc: '0x3600000000000000000000000000000000000000',
    rpc: 'https://rpc.testnet.arc.network',
    chain: {
      id: 5042002, name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
    } as Chain,
  },
  {
    key: 'sepolia',
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    domain: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    chain: {
      id: 11155111, name: 'Sepolia',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'] } },
    } as Chain,
  },
  {
    key: 'baseSepolia',
    name: 'Base Sepolia',
    chainId: 84532,
    domain: 6,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpc: 'https://sepolia.base.org',
    chain: {
      id: 84532, name: 'Base Sepolia',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
    } as Chain,
  },
  {
    key: 'arbitrumSepolia',
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    domain: 3,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    chain: {
      id: 421614, name: 'Arbitrum Sepolia',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } },
    } as Chain,
  },
  {
    key: 'optimismSepolia',
    name: 'Optimism Sepolia',
    chainId: 11155420,
    domain: 2,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    rpc: 'https://sepolia.optimism.io',
    chain: {
      id: 11155420, name: 'Optimism Sepolia',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://sepolia.optimism.io'] } },
    } as Chain,
  },
  {
    key: 'avalancheFuji',
    name: 'Avalanche Fuji',
    chainId: 43113,
    domain: 1,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',
    chain: {
      id: 43113, name: 'Avalanche Fuji',
      nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
      rpcUrls: { default: { http: ['https://api.avax-test.network/ext/bc/C/rpc'] } },
    } as Chain,
  },
  {
    key: 'polygonAmoy',
    name: 'Polygon Amoy',
    chainId: 80002,
    domain: 7,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    rpc: 'https://rpc-amoy.polygon.technology',
    chain: {
      id: 80002, name: 'Polygon Amoy',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc-amoy.polygon.technology'] } },
    } as Chain,
  },
]

const balanceOfAbi = [
  {
    type: 'function' as const,
    name: 'balanceOf',
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// --- Gateway unified balance ---
async function fetchGatewayBalance(address: string): Promise<string> {
  const res = await fetch(GATEWAY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: EVM_DOMAINS.map((domain) => ({ domain, depositor: address })),
    }),
  })
  if (!res.ok) throw new Error('Gateway API error')
  const data = await res.json()
  const total = (data.balances ?? []).reduce(
    (sum: number, b: { balance: string }) => sum + parseFloat(b.balance || '0'),
    0,
  )
  return total.toFixed(2)
}

export function useGatewayBalance(address: string | undefined) {
  return useQuery({
    queryKey: ['gatewayBalance', address],
    queryFn: () => fetchGatewayBalance(address!),
    enabled: !!address,
  })
}

// --- Per-chain USDC wallet balances ---
async function fetchChainBalances(address: Address): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  await Promise.allSettled(
    CHAINS.map(async (c) => {
      const client = createPublicClient({ chain: c.chain, transport: http(c.rpc) })
      const raw = await client.readContract({
        address: c.usdc,
        abi: balanceOfAbi,
        functionName: 'balanceOf',
        args: [address],
      })
      results[c.key] = formatUnits(raw, 6)
    }),
  )
  return results
}

export function useChainBalances(address: string | undefined) {
  return useQuery({
    queryKey: ['chainBalances', address],
    queryFn: () => fetchChainBalances(address as Address),
    enabled: !!address,
  })
}
