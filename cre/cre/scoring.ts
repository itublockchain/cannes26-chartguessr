/**
 * Pure scoring functions for CRE workflow.
 * Mirrors backend/src/services/scoring.service.ts logic
 * so the DON can verify scores independently.
 */

export type PricePoint = {
  timestamp: number;
  price: number;
};

export type DrawingPoint = {
  timestamp: number;
  price: number;
};

export type ScoreResult = {
  winner: string;
  player1Score: number;
  player2Score: number;
  isDraw: boolean;
};

export type MatchData = {
  matchId: string;
  player1Address: string;
  player2Address: string;
  player1Drawing: DrawingPoint[] | null;
  player2Drawing: DrawingPoint[] | null;
  player1SubmittedAt: number; // epoch ms
  player2SubmittedAt: number; // epoch ms
  priceBuffer: PricePoint[];
};

const DRAW_THRESHOLD = 0.01;
const MIN_COVERAGE = 0.3; // drawing must cover at least 30% of prediction window
const OBSERVATION_DURATION = 45; // seconds
const DRAWING_PHASE_DURATION = 15; // seconds
const RESOLUTION_DURATION = 60; // seconds
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Compute match score from raw data (no DB access).
 * This is the pure-function equivalent of backend calculateScore.
 */
export function computeScore(data: MatchData): ScoreResult {
  const { priceBuffer, player1Drawing, player2Drawing } = data;

  if (priceBuffer.length === 0) {
    throw new Error("No price buffer");
  }

  // Extract resolution-phase prices (last 60s window: T0+60 → T0+120)
  const bufferStart = priceBuffer[0].timestamp;
  const resolutionStart = bufferStart + OBSERVATION_DURATION + DRAWING_PHASE_DURATION;
  const actualCurve = priceBuffer.filter((p) => p.timestamp >= resolutionStart);

  if (actualCurve.length === 0) {
    throw new Error("No price data for resolution phase");
  }

  const p1Valid = player1Drawing && hasMinCoverage(player1Drawing);
  const p2Valid = player2Drawing && hasMinCoverage(player2Drawing);

  // No valid drawings → draw
  if (!p1Valid && !p2Valid) {
    return { winner: ADDRESS_ZERO, player1Score: Infinity, player2Score: Infinity, isDraw: true };
  }
  // Only one valid → other wins
  if (!p1Valid) {
    return { winner: data.player2Address, player1Score: Infinity, player2Score: 0, isDraw: false };
  }
  if (!p2Valid) {
    return { winner: data.player1Address, player1Score: 0, player2Score: Infinity, isDraw: false };
  }

  // Both valid — score against resolution-phase actual prices
  const normalizedActual = normalizeTimeSeries(actualCurve, RESOLUTION_DURATION);
  const normalizedP1 = normalizeDrawingToActual(player1Drawing, normalizedActual);
  const normalizedP2 = normalizeDrawingToActual(player2Drawing, normalizedActual);

  const actualPrices = normalizedActual.map((p) => p.price);
  const p1Score = rmse(normalizedP1, actualPrices);
  const p2Score = rmse(normalizedP2, actualPrices);

  const diff = Math.abs(p1Score - p2Score);
  if (diff < DRAW_THRESHOLD) {
    // Tiebreaker: first to submit wins
    if (data.player1SubmittedAt <= data.player2SubmittedAt) {
      return { winner: data.player1Address, player1Score: p1Score, player2Score: p2Score, isDraw: false };
    }
    return { winner: data.player2Address, player1Score: p1Score, player2Score: p2Score, isDraw: false };
  }

  const winner = p1Score < p2Score ? data.player1Address : data.player2Address;
  return { winner, player1Score: p1Score, player2Score: p2Score, isDraw: false };
}

/** Check if drawing covers at least MIN_COVERAGE of the prediction window. */
export function hasMinCoverage(drawing: DrawingPoint[]): boolean {
  if (drawing.length < 2) return false;
  const drawingDuration = drawing[drawing.length - 1].timestamp - drawing[0].timestamp;
  return drawingDuration >= RESOLUTION_DURATION * MIN_COVERAGE;
}

/** Resample a time series to `count` evenly-spaced points. */
export function normalizeTimeSeries(points: PricePoint[], count: number): PricePoint[] {
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

/** Project a drawing onto the actual curve's timestamps. */
export function normalizeDrawingToActual(drawing: DrawingPoint[], actualCurve: PricePoint[]): number[] {
  return actualCurve.map((actual) => interpolateAt(drawing, actual.timestamp));
}

/** Linear interpolation at a given timestamp. */
export function interpolateAt(points: { timestamp: number; price: number }[], t: number): number {
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

/** Root mean square error between predicted and actual price arrays. */
export function rmse(predicted: number[], actual: number[]): number {
  const n = Math.min(predicted.length, actual.length);
  if (n === 0) return Infinity;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = predicted[i] - actual[i];
    sumSq += diff * diff;
  }

  return Math.sqrt(sumSq / n);
}
