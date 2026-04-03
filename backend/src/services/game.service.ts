import { prisma } from "../config/prisma.js";
import * as datastreamsService from "./datastreams.service.js";
import * as sseService from "./sse.service.js";
import type { DrawingPoint } from "../types/index.js";

const GAME_DURATION_MS = 60_000; // 60 seconds
const activeGames = new Map<string, ReturnType<typeof setTimeout>>();

export async function onMatchLocked(dbMatchId: string, onchainMatchId: string): Promise<void> {
  console.log(`[game] Starting game for match ${onchainMatchId}`);

  // Get current price as startPrice
  const currentPrice = datastreamsService.getLatestPrice();
  const startPrice = currentPrice?.price ?? 0;

  // Start buffering price data for this match
  datastreamsService.startBuffer(onchainMatchId);

  // Update DB state
  await prisma.match.update({
    where: { id: dbMatchId },
    data: { state: "PLAYING", startPrice: startPrice.toString() },
  });

  // Notify players
  const match = await prisma.match.findUnique({
    where: { id: dbMatchId },
    include: { player1: true, player2: true },
  });
  if (!match) return;

  const gameStartData = {
    matchId: onchainMatchId,
    startPrice,
    duration: GAME_DURATION_MS / 1000,
  };
  sseService.sendToWallet(match.player1.walletAddress, "game_starting", gameStartData);
  sseService.sendToWallet(match.player2.walletAddress, "game_starting", gameStartData);

  // Set timer for game end
  const timer = setTimeout(() => onGameEnd(dbMatchId, onchainMatchId), GAME_DURATION_MS);
  activeGames.set(onchainMatchId, timer);
}

async function onGameEnd(dbMatchId: string, onchainMatchId: string): Promise<void> {
  console.log(`[game] Game ended for match ${onchainMatchId}`);
  activeGames.delete(onchainMatchId);

  // Stop buffering and save price data
  const priceBuffer = datastreamsService.stopBuffer(onchainMatchId);

  const endPrice = priceBuffer.length > 0 ? priceBuffer[priceBuffer.length - 1].price : 0;

  await prisma.match.update({
    where: { id: dbMatchId },
    data: {
      state: "CALCULATING",
      endPrice: endPrice.toString(),
      priceBuffer: priceBuffer as any,
    },
  });

  const match = await prisma.match.findUnique({
    where: { id: dbMatchId },
    include: { player1: true, player2: true },
  });
  if (!match) return;

  sseService.sendToWallet(match.player1.walletAddress, "calculating", { matchId: onchainMatchId });
  sseService.sendToWallet(match.player2.walletAddress, "calculating", { matchId: onchainMatchId });

  // CRE will call /cre/score and then settleMatch on-chain.
  // In fallback mode (no CRE), the backend settles directly.
  // See routes/cre.routes.ts for fallback implementation.
}

export async function submitDrawing(
  matchId: string,
  userId: string,
  pathData: DrawingPoint[]
): Promise<void> {
  const match = await prisma.match.findUnique({ where: { onchainMatchId: matchId } });
  if (!match) throw new Error("Match not found");
  if (match.state !== "PLAYING" && match.state !== "LOCKED") throw new Error("Not in playing state");

  // Validate player belongs to match
  if (userId !== match.player1Id && userId !== match.player2Id) {
    throw new Error("Not a player in this match");
  }

  // Check for existing drawing
  const existing = await prisma.drawing.findFirst({
    where: { matchId: match.id, userId },
  });
  if (existing) throw new Error("Drawing already submitted");

  await prisma.drawing.create({
    data: {
      matchId: match.id,
      userId,
      pathData: pathData as any,
    },
  });

  // Notify both players
  const fullMatch = await prisma.match.findUnique({
    where: { id: match.id },
    include: { player1: true, player2: true },
  });
  if (fullMatch) {
    sseService.sendToWallet(fullMatch.player1.walletAddress, "drawing_submitted", { matchId, player: userId });
    sseService.sendToWallet(fullMatch.player2.walletAddress, "drawing_submitted", { matchId, player: userId });
  }
}

export function isGameActive(onchainMatchId: string): boolean {
  return activeGames.has(onchainMatchId);
}
