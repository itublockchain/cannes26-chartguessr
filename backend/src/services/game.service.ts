import { prisma } from "../config/prisma.js";
import * as datastreamsService from "./datastreams.service.js";
import * as sseService from "./sse.service.js";
import { calculateScore } from "./scoring.service.js";
import { refundPlayer } from "./chain.service.js";
import type { DrawingPoint } from "../types/index.js";
import { type Address } from "viem";

const OBSERVATION_MS = 45_000; // 45 seconds — watch phase
const DRAWING_MS = 15_000; // 15 seconds — drawing phase
const RESOLUTION_MS = 60_000; // 60 seconds — split-screen viewing phase
const GAME_DURATION_MS = OBSERVATION_MS + DRAWING_MS + RESOLUTION_MS; // 120 seconds total

interface GameTimers {
  drawingPhase: ReturnType<typeof setTimeout>;
  resolutionPhase: ReturnType<typeof setTimeout>;
  gameEnd: ReturnType<typeof setTimeout>;
}

const activeGames = new Map<string, GameTimers>();

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
    observationDuration: OBSERVATION_MS / 1000,
    drawingDuration: DRAWING_MS / 1000,
    resolutionDuration: RESOLUTION_MS / 1000,
  };
  sseService.sendToWallet(match.player1.walletAddress, "game_starting", gameStartData);
  sseService.sendToWallet(match.player2.walletAddress, "game_starting", gameStartData);

  // Timer: drawing phase at 45s
  const drawingPhaseTimer = setTimeout(() => onDrawingPhaseStart(dbMatchId, onchainMatchId), OBSERVATION_MS);

  // Timer: resolution phase at 60s (drawings locked, split screen)
  const resolutionPhaseTimer = setTimeout(
    () => onResolutionPhaseStart(dbMatchId, onchainMatchId),
    OBSERVATION_MS + DRAWING_MS,
  );

  // Timer: game end at 120s
  const gameEndTimer = setTimeout(() => onGameEnd(dbMatchId, onchainMatchId), GAME_DURATION_MS);

  activeGames.set(onchainMatchId, {
    drawingPhase: drawingPhaseTimer,
    resolutionPhase: resolutionPhaseTimer,
    gameEnd: gameEndTimer,
  });
}

async function onDrawingPhaseStart(dbMatchId: string, onchainMatchId: string): Promise<void> {
  console.log(`[game] Drawing phase started for match ${onchainMatchId}`);

  const match = await prisma.match.findUnique({
    where: { id: dbMatchId },
    include: { player1: true, player2: true },
  });
  if (!match) return;

  const drawingPhaseData = {
    matchId: onchainMatchId,
    drawingDuration: DRAWING_MS / 1000,
  };
  sseService.sendToWallet(match.player1.walletAddress, "drawing_phase", drawingPhaseData);
  sseService.sendToWallet(match.player2.walletAddress, "drawing_phase", drawingPhaseData);
}

async function onResolutionPhaseStart(dbMatchId: string, onchainMatchId: string): Promise<void> {
  console.log(`[game] Resolution phase started for match ${onchainMatchId}`);

  const match = await prisma.match.findUnique({
    where: { id: dbMatchId },
    include: { player1: true, player2: true, drawings: true },
  });
  if (!match) return;

  // Find each player's drawing and send to the opponent
  const p1Drawing = match.drawings.find((d) => d.userId === match.player1Id);
  const p2Drawing = match.drawings.find((d) => d.userId === match.player2Id);

  const resolutionData = {
    matchId: onchainMatchId,
    resolutionDuration: RESOLUTION_MS / 1000,
    opponentDrawing: null as DrawingPoint[] | null,
  };

  // Send opponent's drawing to each player
  sseService.sendToWallet(match.player1.walletAddress, "resolution_phase", {
    ...resolutionData,
    opponentDrawing: p2Drawing ? (p2Drawing.pathData as unknown as DrawingPoint[]) : null,
  });
  sseService.sendToWallet(match.player2.walletAddress, "resolution_phase", {
    ...resolutionData,
    opponentDrawing: p1Drawing ? (p1Drawing.pathData as unknown as DrawingPoint[]) : null,
  });
}

async function onGameEnd(dbMatchId: string, onchainMatchId: string): Promise<void> {
  console.log(`[game] Game ended for match ${onchainMatchId}`);
  const timers = activeGames.get(onchainMatchId);
  if (timers) {
    clearTimeout(timers.drawingPhase);
    clearTimeout(timers.resolutionPhase);
    clearTimeout(timers.gameEnd);
  }
  activeGames.delete(onchainMatchId);

  // Stop buffering and save price data
  const priceBuffer = datastreamsService.stopBuffer(onchainMatchId);

  const startPrice = priceBuffer.length > 0 ? priceBuffer[0].price : 0;
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

  // Score and settle
  const entryFee = BigInt(match.entryFee.toString());
  const PLATFORM_FEE_BPS = 500n; // 5%

  try {
    const scoreResult = await calculateScore(
      onchainMatchId,
      startPrice.toString(),
      endPrice.toString(),
    );

    console.log(
      `[game] Score: p1=${scoreResult.player1Score} p2=${scoreResult.player2Score} winner=${scoreResult.winner} isDraw=${scoreResult.isDraw}`,
    );

    // Settle via direct USDC transfers from operator wallet
    // (on-chain escrow is not used since enterMatch was skipped)
    if (scoreResult.isDraw) {
      // Refund both players
      await refundPlayer(match.player1.walletAddress as Address, entryFee);
      await refundPlayer(match.player2.walletAddress as Address, entryFee);
    } else {
      // Winner gets pot minus platform fee
      const pot = entryFee * 2n;
      const fee = (pot * PLATFORM_FEE_BPS) / 10_000n;
      const payout = pot - fee;
      await refundPlayer(scoreResult.winner as Address, payout);
    }

    // Update DB state
    await prisma.match.update({
      where: { id: dbMatchId },
      data: {
        state: scoreResult.isDraw ? "DRAW" : "RESOLVED",
        winnerId: scoreResult.isDraw
          ? null
          : match.player1.walletAddress.toLowerCase() === scoreResult.winner.toLowerCase()
            ? match.player1Id
            : match.player2Id,
        startPrice: startPrice.toString(),
        endPrice: endPrice.toString(),
        resolvedAt: new Date(),
      },
    });

    // Compute payout string for frontend
    const payout = scoreResult.isDraw
      ? entryFee.toString()
      : ((entryFee * 2n) - ((entryFee * 2n * PLATFORM_FEE_BPS) / 10_000n)).toString();

    // Send result with actual scores
    const resultData = {
      matchId: onchainMatchId,
      winner: scoreResult.isDraw ? null : scoreResult.winner,
      player1Score: scoreResult.player1Score,
      player2Score: scoreResult.player2Score,
      payout,
      startPrice,
      endPrice,
      isDraw: scoreResult.isDraw,
    };
    sseService.sendToWallet(match.player1.walletAddress, "result", resultData);
    sseService.sendToWallet(match.player2.walletAddress, "result", resultData);
  } catch (err) {
    console.error(`[game] Score/settle failed for match ${onchainMatchId}:`, err);
    // Refund both on failure so nobody loses funds
    try {
      await refundPlayer(match.player1.walletAddress as Address, entryFee);
      await refundPlayer(match.player2.walletAddress as Address, entryFee);
    } catch (refundErr) {
      console.error(`[game] Emergency refund failed:`, refundErr);
    }
    const errorResult = {
      matchId: onchainMatchId,
      winner: null,
      player1Score: 0,
      player2Score: 0,
      isDraw: true,
    };
    sseService.sendToWallet(match.player1.walletAddress, "result", errorResult);
    sseService.sendToWallet(match.player2.walletAddress, "result", errorResult);
  }
}

export async function submitDrawing(
  matchId: string,
  userId: string,
  pathData: DrawingPoint[]
): Promise<void> {
  const match = await prisma.match.findUnique({ where: { onchainMatchId: matchId } });
  if (!match) throw new Error("Match not found");
  if (match.state !== "PLAYING" && match.state !== "LOCKED" && match.state !== "CALCULATING") throw new Error("Not in playing state");

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
