import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  pad,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

// --- Constants ---

const ARC_DOMAIN = 26;
const ARC_RPC = env.arcRpcUrl;

const arcTestnet = defineChain({
  id: env.arcChainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address;
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as Address;
const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1";

const ARC_USDC = env.usdcAddress as Address;

const MAX_FEE = 1000n; // 0.001 USDC (6 decimals) — Gateway API minimum

// --- EIP-712 Types ---

const EIP712_DOMAIN = { name: "GatewayWallet", version: "1" } as const;

const BURN_INTENT_TYPES = {
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
} as const;

// --- ABI ---

const gatewayMinterAbi = [
  {
    type: "function" as const,
    name: "gatewayMint",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable" as const,
  },
] as const;

// --- Clients ---

let operatorAccount: ReturnType<typeof privateKeyToAccount>;
let publicClient: any;
let walletClient: any;

export function init() {
  operatorAccount = privateKeyToAccount(env.operatorPrivateKey as Hex);

  publicClient = createPublicClient({
    chain: arcTestnet as any,
    transport: http(ARC_RPC),
  });

  walletClient = createWalletClient({
    account: operatorAccount,
    chain: arcTestnet as any,
    transport: http(ARC_RPC),
  });

  console.log("[gateway-transfer] Initialized, operator:", operatorAccount.address);
}

// --- Gateway Balance ---

const EVM_DOMAINS = [0, 1, 2, 3, 6, 7, 10, 13, 14, 16, 19, 26] as const;

interface BalanceEntry {
  domain: number;
  balance: string;
}

export async function getGatewayBalance(address: string): Promise<{
  total: number;
  perDomain: BalanceEntry[];
}> {
  const res = await fetch(`${GATEWAY_API}/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: EVM_DOMAINS.map((domain) => ({ domain, depositor: address })),
    }),
  });

  if (!res.ok) throw new Error("Gateway balance API error");
  const data = await res.json();

  const perDomain: BalanceEntry[] = (data.balances ?? [])
    .filter((b: any) => parseFloat(b.balance || "0") > 0)
    .map((b: any) => ({ domain: b.domain, balance: b.balance }));

  const total = perDomain.reduce((sum, b) => sum + parseFloat(b.balance), 0);

  return { total, perDomain };
}

// --- Domain → USDC address mapping ---

const DOMAIN_USDC: Record<number, Address> = {
  0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
  1: "0x5425890298aed601595a70AB815c96711a31Bc65", // Avalanche Fuji
  2: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", // Optimism Sepolia
  3: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  6: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  7: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", // Polygon Amoy
  26: ARC_USDC, // Arc Testnet
};

// --- Transfer: burn from user's Gateway balance → mint to recipient on Arc ---

export async function transferToArc(
  depositorAddress: Address,
  recipientAddress: Address,
  amount: bigint
): Promise<Hex> {
  // 1. Get per-domain balances to know where to burn from
  const { perDomain } = await getGatewayBalance(depositorAddress);

  if (perDomain.length === 0) {
    throw new Error("No Gateway balance available");
  }

  // 2. Build burn intents — burn from domains with balance until amount is covered
  let remaining = amount;
  const burnIntents: Array<{ burnIntent: any; signature: Hex }> = [];

  for (const entry of perDomain) {
    if (remaining <= 0n) break;

    const domainBalance = BigInt(Math.floor(parseFloat(entry.balance) * 1e6));
    const burnAmount = domainBalance < remaining ? domainBalance : remaining;
    remaining -= burnAmount;

    const sourceUsdc = DOMAIN_USDC[entry.domain];
    if (!sourceUsdc) continue;

    const salt = ("0x" + randomBytes(32).toString("hex")) as Hex;

    const message = {
      maxBlockHeight: maxUint256,
      maxFee: MAX_FEE,
      spec: {
        version: 1,
        sourceDomain: entry.domain,
        destinationDomain: ARC_DOMAIN,
        sourceContract: pad(GATEWAY_WALLET, { size: 32 }),
        destinationContract: pad(GATEWAY_MINTER, { size: 32 }),
        sourceToken: pad(sourceUsdc, { size: 32 }),
        destinationToken: pad(ARC_USDC, { size: 32 }),
        sourceDepositor: pad(depositorAddress, { size: 32 }),
        destinationRecipient: pad(recipientAddress, { size: 32 }),
        sourceSigner: pad(operatorAccount.address, { size: 32 }),
        destinationCaller: pad("0x0000000000000000000000000000000000000000" as Address, { size: 32 }),
        value: burnAmount,
        salt,
        hookData: "0x" as Hex,
      },
    };

    // 3. Sign burn intent as delegate (operator signs on behalf of depositor)
    const signature = await operatorAccount.signTypedData({
      domain: EIP712_DOMAIN,
      types: BURN_INTENT_TYPES,
      primaryType: "BurnIntent",
      message,
    });

    burnIntents.push({ burnIntent: message, signature });
  }

  if (remaining > 0n) {
    throw new Error("Insufficient Gateway balance");
  }

  // 4. Submit to Gateway API for attestation
  const transferRes = await fetch(`${GATEWAY_API}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(burnIntents, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    ),
  });

  if (!transferRes.ok) {
    const errBody = await transferRes.text();
    throw new Error(`Gateway transfer API error: ${transferRes.status} ${errBody}`);
  }

  const { attestation, signature: attestSig } = await transferRes.json();

  // 5. Execute gatewayMint on Arc Testnet
  const mintHash = await walletClient.writeContract({
    chain: arcTestnet as any,
    account: operatorAccount,
    address: GATEWAY_MINTER,
    abi: gatewayMinterAbi,
    functionName: "gatewayMint",
    args: [attestation as Hex, attestSig as Hex],
  });

  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`[gateway-transfer] Minted ${amount} to ${recipientAddress} on Arc, tx: ${mintHash}`);

  return mintHash;
}
