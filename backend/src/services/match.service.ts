import { keccak256, encodeAbiParameters, type Address } from "viem";
import { v4 as uuidv4 } from "uuid";
import { redis } from "../config/redis.js";
import { prisma } from "../config/prisma.js";
import * as chainService from "./chain.service.js";
import * as sseService from "./sse.service.js";
import * as gameService from "./game.service.js";
import * as gatewayTransfer from "./gateway-transfer.service.js";
import type { QueueEntry } from "../types/index.js";

const QUEUE_KEY = "matchmaking:queue";
const MATCH_POLL_INTERVAL = 500; // ms
const ENTRY_FEE_USDC = 1_000000n; // 1 USDC (6 decimals)

/** Guard: matches currently being cancelled — prevents duplicate cancel/refund from concurrent disconnects */
const cancellingMatches = new Set<string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startMatchmaking(): void {
  if (pollTimer) return;
  pollTimer = setInterval(pollQueue, MATCH_POLL_INTERVAL);
  console.log("[matchmaking] Polling started");
}

export function stopMatchmaking(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function joinQueue(
  userId: string,
  walletAddress: string,
  characterId: string,
  entryFee: string
): Promise<number> {
  // Verify Gateway balance >= entry fee (warn but don't block for now)
  try {
    const { total } = await gatewayTransfer.getGatewayBalance(walletAddress);
    const entryFeeUsdc = parseInt(entryFee) / 1e6;
    if (total < entryFeeUsdc) {
      console.warn(`[matchmaking] Player ${userId} has insufficient Gateway balance: ${total.toFixed(2)} < ${entryFeeUsdc}`);
    }
  } catch (err) {
    console.warn("[matchmaking] Failed to check Gateway balance:", err);
  }

  const entry: QueueEntry = {
    userId,
    walletAddress,
    characterId,
    entryFee,
    joinedAt: Date.now(),
  };

  await redis.zadd(QUEUE_KEY, entry.joinedAt, JSON.stringify(entry));
  const position = await redis.zrank(QUEUE_KEY, JSON.stringify(entry));
  return (position ?? 0) + 1;
}

export async function leaveQueue(userId: string): Promise<boolean> {
  const members = await redis.zrange(QUEUE_KEY, 0, -1);
  for (const member of members) {
    const entry: QueueEntry = JSON.parse(member);
    if (entry.userId === userId) {
      await redis.zrem(QUEUE_KEY, member);
      return true;
    }
  }
  return false;
}

async function pollQueue(): Promise<void> {
  try {
    const queueLen = await redis.zcard(QUEUE_KEY);
    if (queueLen < 2) return;

    const results = await redis.zpopmin(QUEUE_KEY, 2);
    if (results.length < 4) {
      if (results.length >= 2) {
        await redis.zadd(QUEUE_KEY, parseFloat(results[1]), results[0]);
      }
      return;
    }

    const entry1: QueueEntry = JSON.parse(results[0]);
    const entry2: QueueEntry = JSON.parse(results[2]);

    if (entry1.entryFee !== entry2.entryFee) {
      await redis.zadd(QUEUE_KEY, entry1.joinedAt, JSON.stringify(entry1));
      await redis.zadd(QUEUE_KEY, entry2.joinedAt, JSON.stringify(entry2));
      return;
    }

    await createMatchFromPair(entry1, entry2);
  } catch (err) {
    console.error("[matchmaking] Poll error:", err);
  }
}

async function createMatchFromPair(entry1: QueueEntry, entry2: QueueEntry): Promise<void> {
  const entryFeeWei = BigInt(entry1.entryFee);
  const operatorAddress = chainService.getOperatorAddress() as Address;

  const matchIdBytes = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        entry1.walletAddress as Address,
        entry2.walletAddress as Address,
        BigInt(Date.now()),
        BigInt(Math.floor(Math.random() * 1e9)),
      ]
    )
  );

  const match = await prisma.match.create({
    data: {
      id: uuidv4(),
      onchainMatchId: matchIdBytes,
      player1Id: entry1.userId,
      player2Id: entry2.userId,
      entryFee: entry1.entryFee,
      state: "CREATED",
    },
  });

  console.log(`[matchmaking] Paired: ${entry1.walletAddress} vs ${entry2.walletAddress} → ${matchIdBytes}`);

  try {
    // Try to collect entry fees via Gateway (non-blocking — game starts regardless)
    try {
      console.log(`[matchmaking] Transferring entry fees via Gateway...`);
      await Promise.all([
        gatewayTransfer.transferToArc(entry1.walletAddress as Address, operatorAddress, entryFeeWei),
        gatewayTransfer.transferToArc(entry2.walletAddress as Address, operatorAddress, entryFeeWei),
      ]);
      console.log(`[matchmaking] Entry fees collected`);
    } catch (transferErr) {
      console.warn("[matchmaking] Gateway transfer failed (continuing anyway):", transferErr);
    }

    // Go directly to LOCKED and start game
    // (on-chain escrow skipped — settlement handled via direct USDC transfers)
    await prisma.match.update({
      where: { id: match.id },
      data: { state: "LOCKED", lockedAt: new Date() },
    });

    // Notify players
    sseService.sendToWallet(entry1.walletAddress, "match_created", {
      matchId: matchIdBytes,
      opponent: entry2.walletAddress,
      entryFee: entry1.entryFee,
    });
    sseService.sendToWallet(entry2.walletAddress, "match_created", {
      matchId: matchIdBytes,
      opponent: entry1.walletAddress,
      entryFee: entry1.entryFee,
    });

    // Start game immediately
    gameService.onMatchLocked(match.id, matchIdBytes);
  } catch (err: any) {
    console.error("[matchmaking] Match setup failed:", err);
    await prisma.match.update({ where: { id: match.id }, data: { state: "CANCELLED" } });
    sseService.sendToUser(entry1.userId, "match_cancelled", { matchId: matchIdBytes, reason: "setup_failed" });
    sseService.sendToUser(entry2.userId, "match_cancelled", { matchId: matchIdBytes, reason: "setup_failed" });

    // Refund entry fees if Gateway transfer succeeded
    await refundBothPlayers(
      entry1.walletAddress as Address,
      entry2.walletAddress as Address,
      entryFeeWei,
      matchIdBytes,
    );
  }
}

// Only cancel in pre-game states — once the game is PLAYING, backend timers
// drive it to completion regardless of SSE connection state.
const CANCELABLE_STATES = [
  "CREATED",
  "AWAITING_PLAYERS",
  "PARTIAL",
] as const;

export async function onPlayerDisconnect(userId: string, walletAddress: string): Promise<void> {
  console.log(`[matchmaking] Player disconnected: ${userId}`);

  // 1. Remove from queue if present
  await leaveQueue(userId);

  // 2. Find any active match for this player
  const activeMatch = await prisma.match.findFirst({
    where: {
      OR: [{ player1Id: userId }, { player2Id: userId }],
      state: { in: [...CANCELABLE_STATES] },
    },
    include: { player1: true, player2: true },
  });

  if (!activeMatch) return;

  // Guard: skip if another disconnect handler is already cancelling this match
  if (cancellingMatches.has(activeMatch.onchainMatchId)) return;
  cancellingMatches.add(activeMatch.onchainMatchId);

  console.log(`[matchmaking] Cancelling match ${activeMatch.onchainMatchId} due to disconnect`);

  try {
    // 3. Update DB first (prevents race with second disconnect)
    await prisma.match.update({
      where: { id: activeMatch.id },
      data: { state: "CANCELLED" },
    });

    // 4. Notify other player
    const otherId =
      activeMatch.player1Id === userId ? activeMatch.player2Id : activeMatch.player1Id;
    sseService.sendToUser(otherId, "match_cancelled", {
      matchId: activeMatch.onchainMatchId,
      reason: "opponent_disconnected",
    });

    // 5. Refund entry fees sequentially
    const entryFee = BigInt(activeMatch.entryFee.toString());
    await refundBothPlayers(
      activeMatch.player1.walletAddress as Address,
      activeMatch.player2.walletAddress as Address,
      entryFee,
      activeMatch.onchainMatchId,
    );
  } finally {
    cancellingMatches.delete(activeMatch.onchainMatchId);
  }
}

async function refundBothPlayers(
  player1: Address,
  player2: Address,
  entryFee: bigint,
  matchId: string,
): Promise<void> {
  console.log(`[matchmaking] Refunding entry fees for match ${matchId}`);
  try {
    await chainService.refundPlayer(player1, entryFee);
  } catch (err) {
    console.error(`[matchmaking] Refund to ${player1} failed:`, err);
  }
  try {
    await chainService.refundPlayer(player2, entryFee);
  } catch (err) {
    console.error(`[matchmaking] Refund to ${player2} failed:`, err);
  }
}
