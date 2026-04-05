import { prisma } from "../config/prisma.js";
import type { DrawingPoint, PricePoint, ScoreResult } from "../types/index.js";

type MatchDrawingForScore = {
  userId: string;
  pathData: unknown;
  submittedAt: Date;
};

const DRAW_THRESHOLD = 0.01;
const MIN_COVERAGE = 0.3; // Drawing must cover at least 30% of the prediction window
const OBSERVATION_DURATION = 45; // seconds — watch phase
const DRAWING_PHASE_DURATION = 15; // seconds — drawing phase
const RESOLUTION_DURATION = 60; // seconds — prediction window (scored against actual)

export async function calculateScore(
  matchId: string,
  _startPrice: string,
  _endPrice: string
): Promise<ScoreResult> {
  const match = await prisma.match.findUnique({
    where: { onchainMatchId: matchId },
    include: {
      drawings: { include: { user: true } },
      player1: true,
      player2: true,
    },
  });

  if (!match) throw new Error("Match not found");
  if (!match.priceBuffer) throw new Error("No price buffer");

  const fullBuffer = match.priceBuffer as unknown as PricePoint[];

  // Extract the resolution-phase portion (last 60s) of the price buffer
  // This is the period the drawings predict: T0+60 to T0+120
  const bufferStart = fullBuffer.length > 0 ? fullBuffer[0].timestamp : 0;
  const resolutionStart = bufferStart + OBSERVATION_DURATION + DRAWING_PHASE_DURATION;
  const actualCurve = fullBuffer.filter((p) => p.timestamp >= resolutionStart);

  if (actualCurve.length === 0) throw new Error("No price data for resolution phase");

  const p1Drawing = match.drawings.find((d: MatchDrawingForScore) => d.userId === match.player1Id);
  const p2Drawing = match.drawings.find((d: MatchDrawingForScore) => d.userId === match.player2Id);

  const p1Path = p1Drawing ? (p1Drawing.pathData as unknown as DrawingPoint[]) : null;
  const p2Path = p2Drawing ? (p2Drawing.pathData as unknown as DrawingPoint[]) : null;

  console.log(`[scoring] Match ${matchId}: p1 drawing ${p1Path ? `${p1Path.length} points` : "NONE"}, p2 drawing ${p2Path ? `${p2Path.length} points` : "NONE"}`);
  if (p1Path && p1Path.length >= 2) {
    const span = p1Path[p1Path.length - 1].timestamp - p1Path[0].timestamp;
    console.log(`[scoring] p1 span: ${span}s (need ${RESOLUTION_DURATION * MIN_COVERAGE}s)`);
  }
  if (p2Path && p2Path.length >= 2) {
    const span = p2Path[p2Path.length - 1].timestamp - p2Path[0].timestamp;
    console.log(`[scoring] p2 span: ${span}s (need ${RESOLUTION_DURATION * MIN_COVERAGE}s)`);
  }

  const p1Valid = p1Path && hasMinCoverage(p1Path);
  const p2Valid = p2Path && hasMinCoverage(p2Path);

  // No valid drawings → draw
  if (!p1Valid && !p2Valid) {
    console.log(`[scoring] Neither drawing is valid — draw`);
    return { winner: ADDRESS_ZERO, player1Score: Infinity, player2Score: Infinity, isDraw: true };
  }
  // Only one valid → other wins
  if (!p1Valid) {
    return { winner: match.player2.walletAddress, player1Score: Infinity, player2Score: 0, isDraw: false };
  }
  if (!p2Valid) {
    return { winner: match.player1.walletAddress, player1Score: 0, player2Score: Infinity, isDraw: false };
  }

  // Both valid — score them against the resolution-phase actual prices
  const normalizedActual = normalizeTimeSeries(actualCurve, RESOLUTION_DURATION);
  const normalizedP1 = normalizeDrawingToActual(p1Path, normalizedActual);
  const normalizedP2 = normalizeDrawingToActual(p2Path, normalizedActual);

  const actualPrices = normalizedActual.map((p) => p.price);
  const p1Score = rmse(normalizedP1, actualPrices);
  const p2Score = rmse(normalizedP2, actualPrices);

  const diff = Math.abs(p1Score - p2Score);
  if (diff < DRAW_THRESHOLD) {
    // Tiebreaker: first to submit wins
    if (p1Drawing!.submittedAt <= p2Drawing!.submittedAt) {
      return { winner: match.player1.walletAddress, player1Score: p1Score, player2Score: p2Score, isDraw: false };
    }
    return { winner: match.player2.walletAddress, player1Score: p1Score, player2Score: p2Score, isDraw: false };
  }

  const winner = p1Score < p2Score ? match.player1.walletAddress : match.player2.walletAddress;
  return { winner, player1Score: p1Score, player2Score: p2Score, isDraw: false };
}

/**
 * Check if drawing covers at least 90% of the game duration.
 * Drawing points are {timestamp, price} with 1 point per second.
 */
function hasMinCoverage(drawing: DrawingPoint[]): boolean {
  if (drawing.length < 2) return false;

  const drawingDuration = drawing[drawing.length - 1].timestamp - drawing[0].timestamp;
  return drawingDuration >= RESOLUTION_DURATION * MIN_COVERAGE;
}

function normalizeTimeSeries(points: PricePoint[], count: number): PricePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array(count).fill(points[0]);

  const startT = points[0].timestamp;
  const endT = points[points.length - 1].timestamp;
  const duration = endT - startT || 1;
  const result: PricePoint[] = [];

  for (let i = 0; i < count; i++) {
    const t = startT + (duration * i) / (count - 1);
    result.push({ timestamp: t, price: interpolateAt(points, t) });
  }

  return result;
}

function normalizeDrawingToActual(drawing: DrawingPoint[], actualCurve: PricePoint[]): number[] {
  return actualCurve.map((actual) => interpolateAt(drawing, actual.timestamp));
}

function interpolateAt(points: { timestamp: number; price: number }[], t: number): number {
  if (t <= points[0].timestamp) return points[0].price;
  if (t >= points[points.length - 1].timestamp) return points[points.length - 1].price;

  for (let i = 0; i < points.length - 1; i++) {
    if (t >= points[i].timestamp && t <= points[i + 1].timestamp) {
      const ratio = (t - points[i].timestamp) / (points[i + 1].timestamp - points[i].timestamp);
      return points[i].price + ratio * (points[i + 1].price - points[i].price);
    }
  }

  return points[points.length - 1].price;
}

function rmse(predicted: number[], actual: number[]): number {
  const n = Math.min(predicted.length, actual.length);
  if (n === 0) return Infinity;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = predicted[i] - actual[i];
    sumSq += diff * diff;
  }

  return Math.sqrt(sumSq / n);
}

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
