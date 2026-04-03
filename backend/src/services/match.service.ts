import { keccak256, encodeAbiParameters, type Hex, type Address } from "viem";
import { v4 as uuidv4 } from "uuid";
import { redis } from "../config/redis.js";
import { prisma } from "../config/prisma.js";
import * as chainService from "./chain.service.js";
import * as sseService from "./sse.service.js";
import type { QueueEntry } from "../types/index.js";

const QUEUE_KEY = "matchmaking:queue";
const MATCH_POLL_INTERVAL = 500; // ms

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
    await chainService.createMatch(
      matchIdBytes as Hex,
      entry1.walletAddress as Address,
      entry2.walletAddress as Address,
      entryFeeWei
    );
  } catch (err) {
    console.error("[matchmaking] createMatch tx failed:", err);
    await prisma.match.update({ where: { id: match.id }, data: { state: "CANCELLED" } });
    sseService.sendToUser(entry1.userId, "match_cancelled", { reason: "tx_failed" });
    sseService.sendToUser(entry2.userId, "match_cancelled", { reason: "tx_failed" });
  }
}
