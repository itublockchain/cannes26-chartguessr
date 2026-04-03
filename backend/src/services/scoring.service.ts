import { prisma } from "../config/prisma.js";
import type { DrawingPoint, PricePoint, ScoreResult } from "../types/index.js";

const DRAW_THRESHOLD = 0.01; // RMSE difference below this = draw

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

  const actualCurve = match.priceBuffer as unknown as PricePoint[];

  const p1Drawing = match.drawings.find((d) => d.userId === match.player1Id);
  const p2Drawing = match.drawings.find((d) => d.userId === match.player2Id);

  if (!p1Drawing || !p2Drawing) {
    // If a player didn't submit a drawing, the other wins
    if (!p1Drawing && !p2Drawing) return { winner: ADDRESS_ZERO, player1Score: Infinity, player2Score: Infinity, isDraw: true };
    if (!p1Drawing) return { winner: match.player2.walletAddress, player1Score: Infinity, player2Score: 0, isDraw: false };
    return { winner: match.player1.walletAddress, player1Score: 0, player2Score: Infinity, isDraw: false };
  }

  const normalizedActual = normalizeTimeSeries(actualCurve, 60);
  const p1Path = p1Drawing.pathData as unknown as DrawingPoint[];
  const p2Path = p2Drawing.pathData as unknown as DrawingPoint[];

  const normalizedP1 = normalizeDrawing(p1Path, normalizedActual, 60);
  const normalizedP2 = normalizeDrawing(p2Path, normalizedActual, 60);

  const p1Score = rmse(normalizedP1, normalizedActual.map((p) => p.price));
  const p2Score = rmse(normalizedP2, normalizedActual.map((p) => p.price));

  const diff = Math.abs(p1Score - p2Score);
  if (diff < DRAW_THRESHOLD) {
    // Tiebreaker: first to submit wins
    if (p1Drawing.submittedAt <= p2Drawing.submittedAt) {
      return { winner: match.player1.walletAddress, player1Score: p1Score, player2Score: p2Score, isDraw: false };
    }
    return { winner: match.player2.walletAddress, player1Score: p1Score, player2Score: p2Score, isDraw: false };
  }

  // Lower RMSE wins
  const winner = p1Score < p2Score ? match.player1.walletAddress : match.player2.walletAddress;
  return { winner, player1Score: p1Score, player2Score: p2Score, isDraw: false };
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
    const price = interpolate(points, t);
    result.push({ timestamp: t, price });
  }

  return result;
}

function normalizeDrawing(drawing: DrawingPoint[], actualCurve: PricePoint[], count: number): number[] {
  if (drawing.length === 0) return Array(count).fill(0);

  // Drawing y-values represent predicted prices
  // Normalize to same number of points as actual curve
  const startT = drawing[0].t;
  const endT = drawing[drawing.length - 1].t;
  const duration = endT - startT || 1;
  const result: number[] = [];

  for (let i = 0; i < count; i++) {
    const t = startT + (duration * i) / (count - 1);
    result.push(interpolateDrawing(drawing, t));
  }

  return result;
}

function interpolate(points: PricePoint[], t: number): number {
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

function interpolateDrawing(points: DrawingPoint[], t: number): number {
  if (t <= points[0].t) return points[0].y;
  if (t >= points[points.length - 1].t) return points[points.length - 1].y;

  for (let i = 0; i < points.length - 1; i++) {
    if (t >= points[i].t && t <= points[i + 1].t) {
      const ratio = (t - points[i].t) / (points[i + 1].t - points[i].t);
      return points[i].y + ratio * (points[i + 1].y - points[i].y);
    }
  }

  return points[points.length - 1].y;
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
