import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  formatUnits,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import * as sseService from "./sse.service.js";

const arcTestnet = defineChain({
  id: env.arcChainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [env.arcRpcUrl] } },
});

const escrowAbi = [
  {
    type: "function",
    name: "createMatch",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "player1", type: "address" },
      { name: "player2", type: "address" },
      { name: "entryFee", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleMatch",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "winner", type: "address" },
      { name: "startPrice", type: "int256" },
      { name: "endPrice", type: "int256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelMatch",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "MatchCreated",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "player1", type: "address", indexed: true },
      { name: "player2", type: "address", indexed: true },
      { name: "entryFee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PlayerEntered",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "MatchLocked",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MatchResolved",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "startPrice", type: "int256", indexed: false },
      { name: "endPrice", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MatchDraw",
    inputs: [{ name: "matchId", type: "bytes32", indexed: true }],
  },
  {
    type: "event",
    name: "MatchCancelled",
    inputs: [{ name: "matchId", type: "bytes32", indexed: true }],
  },
] as const;

let publicClient: ReturnType<typeof createPublicClient>;
let walletClient: ReturnType<typeof createWalletClient>;
let operatorAccount: ReturnType<typeof privateKeyToAccount>;

/**
 * Simple transaction queue — serializes all operator wallet transactions
 * to prevent nonce collisions from concurrent calls.
 */
let txQueue: Promise<void> = Promise.resolve();
function enqueueTx<T>(fn: () => Promise<T>): Promise<T> {
  const p = txQueue.then(fn, fn);
  // Update the queue tail (swallow errors so the queue continues)
  txQueue = p.then(() => {}, () => {});
  return p;
}

export function init() {
  operatorAccount = privateKeyToAccount(env.operatorPrivateKey as Hex);

  publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(env.arcRpcUrl),
  });

  walletClient = createWalletClient({
    account: operatorAccount,
    chain: arcTestnet,
    transport: http(env.arcRpcUrl),
  });

  listenEvents();
}

const contractAddress = () => env.escrowContractAddress as Address;

export function getOperatorAddress(): string {
  return operatorAccount.address;
}

export function createMatch(
  matchId: Hex,
  player1: Address,
  player2: Address,
  entryFee: bigint
): Promise<Hex> {
  return enqueueTx(async () => {
    const hash = await walletClient.writeContract({
      chain: arcTestnet,
      account: operatorAccount,
      address: contractAddress(),
      abi: escrowAbi,
      functionName: "createMatch",
      args: [matchId, player1, player2, entryFee],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });
}

export function settleMatch(
  matchId: Hex,
  winner: Address,
  startPrice: bigint,
  endPrice: bigint
): Promise<Hex> {
  return enqueueTx(async () => {
    const hash = await walletClient.writeContract({
      chain: arcTestnet,
      account: operatorAccount,
      address: contractAddress(),
      abi: escrowAbi,
      functionName: "settleMatch",
      args: [matchId, winner, startPrice, endPrice],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[chain] settleMatch tx: ${hash} winner=${winner}`);
    return hash;
  });
}

export function cancelMatch(matchId: Hex): Promise<Hex> {
  return enqueueTx(async () => {
    const hash = await walletClient.writeContract({
      chain: arcTestnet,
      account: operatorAccount,
      address: contractAddress(),
      abi: escrowAbi,
      functionName: "cancelMatch",
      args: [matchId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });
}

const erc20TransferAbi = [
  {
    type: "function" as const,
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable" as const,
  },
] as const;

export function refundPlayer(playerAddress: Address, amount: bigint): Promise<Hex> {
  return enqueueTx(async () => {
    const usdcAddress = env.usdcAddress as Address;
    const hash = await walletClient.writeContract({
      chain: arcTestnet,
      account: operatorAccount,
      address: usdcAddress,
      abi: erc20TransferAbi,
      functionName: "transfer",
      args: [playerAddress, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[chain] Refunded ${amount} USDC to ${playerAddress}, tx: ${hash}`);
    return hash;
  });
}

function listenEvents() {
  const address = contractAddress();

  // MatchCreated
  publicClient.watchContractEvent({
    address,
    abi: escrowAbi,
    eventName: "MatchCreated",
    onLogs: async (logs: any[]) => {
      for (const log of logs) {
        const { matchId, player1, player2, entryFee } = log.args;
        if (!matchId || !player1 || !player2) continue;
        console.log(`[chain] MatchCreated: ${matchId}`);

        // Only update if still in CREATED state (match.service may have already advanced to LOCKED)
        await prisma.match.updateMany({
          where: { onchainMatchId: matchId, state: "CREATED" },
          data: { state: "AWAITING_PLAYERS" },
        });
      }
    },
  });

  // PlayerEntered
  publicClient.watchContractEvent({
    address,
    abi: escrowAbi,
    eventName: "PlayerEntered",
    onLogs: async (logs: any[]) => {
      for (const log of logs) {
        const { matchId, player } = log.args;
        if (!matchId || !player) continue;
        console.log(`[chain] PlayerEntered: ${matchId} ${player}`);

        const match = await prisma.match.findUnique({
          where: { onchainMatchId: matchId },
          include: { player1: true, player2: true },
        });
        if (!match) continue;

        if (match.state === "AWAITING_PLAYERS") {
          await prisma.match.update({ where: { id: match.id }, data: { state: "PARTIAL" } });
        }

        sseService.sendToWallet(match.player1.walletAddress, "player_entered", { matchId, player });
        sseService.sendToWallet(match.player2.walletAddress, "player_entered", { matchId, player });
      }
    },
  });

  // MatchLocked
  publicClient.watchContractEvent({
    address,
    abi: escrowAbi,
    eventName: "MatchLocked",
    onLogs: async (logs: any[]) => {
      for (const log of logs) {
        const { matchId, timestamp } = log.args;
        if (!matchId) continue;
        console.log(`[chain] MatchLocked: ${matchId}`);

        const match = await prisma.match.findUnique({
          where: { onchainMatchId: matchId },
          include: { player1: true, player2: true },
        });
        if (!match) continue;

        // Skip if match.service already advanced past this state
        if (match.state === "LOCKED" || match.state === "PLAYING") continue;

        await prisma.match.update({
          where: { id: match.id },
          data: { state: "LOCKED", lockedAt: new Date(Number(timestamp ?? 0n) * 1000) },
        });

        sseService.sendToWallet(match.player1.walletAddress, "match_locked", { matchId });
        sseService.sendToWallet(match.player2.walletAddress, "match_locked", { matchId });

        const { onMatchLocked } = await import("./game.service.js");
        onMatchLocked(match.id, matchId);
      }
    },
  });

  // MatchResolved
  publicClient.watchContractEvent({
    address,
    abi: escrowAbi,
    eventName: "MatchResolved",
    onLogs: async (logs: any[]) => {
      for (const log of logs) {
        const { matchId, winner, payout, fee, startPrice, endPrice } = log.args;
        if (!matchId || !winner) continue;
        console.log(`[chain] MatchResolved: ${matchId} winner=${winner}`);

        const match = await prisma.match.findUnique({
          where: { onchainMatchId: matchId },
          include: { player1: true, player2: true },
        });
        if (!match) continue;

        const winnerId = match.player1.walletAddress.toLowerCase() === winner.toLowerCase()
          ? match.player1Id
          : match.player2Id;

        const startPriceFmt = formatUnits(startPrice ?? 0n, 18);
        const endPriceFmt = formatUnits(endPrice ?? 0n, 18);

        await prisma.match.update({
          where: { id: match.id },
          data: {
            state: "RESOLVED",
            winnerId,
            startPrice: startPriceFmt,
            endPrice: endPriceFmt,
            resolvedAt: new Date(),
          },
        });

        const resultData = {
          matchId,
          winner,
          player1Score: 0,
          player2Score: 0,
          payout: payout?.toString(),
          startPrice: startPriceFmt,
          endPrice: endPriceFmt,
        };
        sseService.sendToWallet(match.player1.walletAddress, "result", resultData);
        sseService.sendToWallet(match.player2.walletAddress, "result", resultData);
      }
    },
  });

  // MatchDraw
  publicClient.watchContractEvent({
    address,
    abi: escrowAbi,
    eventName: "MatchDraw",
    onLogs: async (logs: any[]) => {
      for (const log of logs) {
        const { matchId } = log.args;
        if (!matchId) continue;
        console.log(`[chain] MatchDraw: ${matchId}`);

        const match = await prisma.match.findUnique({
          where: { onchainMatchId: matchId },
          include: { player1: true, player2: true },
        });
        if (!match) continue;

        await prisma.match.update({ where: { id: match.id }, data: { state: "DRAW", resolvedAt: new Date() } });

        sseService.sendToWallet(match.player1.walletAddress, "result", { matchId, winner: null, isDraw: true });
        sseService.sendToWallet(match.player2.walletAddress, "result", { matchId, winner: null, isDraw: true });
      }
    },
  });

  // MatchCancelled
  publicClient.watchContractEvent({
    address,
    abi: escrowAbi,
    eventName: "MatchCancelled",
    onLogs: async (logs: any[]) => {
      for (const log of logs) {
        const { matchId } = log.args;
        if (!matchId) continue;
        console.log(`[chain] MatchCancelled: ${matchId}`);

        const match = await prisma.match.findUnique({
          where: { onchainMatchId: matchId },
          include: { player1: true, player2: true },
        });
        if (!match) continue;

        await prisma.match.update({ where: { id: match.id }, data: { state: "CANCELLED" } });

        sseService.sendToWallet(match.player1.walletAddress, "match_cancelled", { matchId, reason: "cancelled" });
        sseService.sendToWallet(match.player2.walletAddress, "match_cancelled", { matchId, reason: "cancelled" });
      }
    },
  });

  console.log("[chain] Event listeners active");
}
