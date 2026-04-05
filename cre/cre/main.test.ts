import { describe, expect } from "bun:test";
import { newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { onCronTrigger, initWorkflow } from "./main";
import type { Config } from "./main";
import {
  computeScore,
  hasMinCoverage,
  normalizeTimeSeries,
  interpolateAt,
  rmse,
  type MatchData,
  type PricePoint,
  type DrawingPoint,
} from "./scoring";

// ── Workflow tests ──────────────────────────────────────────────────

describe("onCronTrigger", () => {
  test("returns status ok with backend url", async () => {
    const config: Config = {
      schedule: "*/5 * * * *",
      backendUrl: "https://api.example.com",
      creScoringSecret: "test-secret",
    };
    const runtime = newTestRuntime();
    runtime.config = config;

    const result = onCronTrigger(runtime);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe("ok");
    expect(parsed.backendUrl).toBe("https://api.example.com");
  });
});

describe("initWorkflow", () => {
  test("returns one handler with correct cron schedule", async () => {
    const testSchedule = "0 0 * * *";
    const config: Config = {
      schedule: testSchedule,
      backendUrl: "https://api.example.com",
      creScoringSecret: "s",
    };

    const handlers = initWorkflow(config);

    expect(handlers).toBeArray();
    expect(handlers).toHaveLength(1);
    expect(handlers[0].trigger.config.schedule).toBe(testSchedule);
  });
});

// ── Scoring tests ───────────────────────────────────────────────────

function makePriceBuffer(startTime: number, seconds: number, priceFn: (t: number) => number): PricePoint[] {
  const buf: PricePoint[] = [];
  for (let i = 0; i <= seconds; i++) {
    buf.push({ timestamp: startTime + i, price: priceFn(i) });
  }
  return buf;
}

describe("hasMinCoverage", () => {
  test("returns false for fewer than 2 points", async () => {
    expect(hasMinCoverage([])).toBe(false);
    expect(hasMinCoverage([{ timestamp: 0, price: 100 }])).toBe(false);
  });

  test("returns false for short drawing", async () => {
    // 10s span < 60 * 0.3 = 18s
    expect(hasMinCoverage([
      { timestamp: 0, price: 100 },
      { timestamp: 10, price: 110 },
    ])).toBe(false);
  });

  test("returns true for sufficient coverage", async () => {
    // 20s span >= 60 * 0.3 = 18s
    expect(hasMinCoverage([
      { timestamp: 0, price: 100 },
      { timestamp: 20, price: 110 },
    ])).toBe(true);
  });
});

describe("interpolateAt", () => {
  const points: PricePoint[] = [
    { timestamp: 0, price: 100 },
    { timestamp: 10, price: 200 },
  ];

  test("clamps to first point before range", async () => {
    expect(interpolateAt(points, -5)).toBe(100);
  });

  test("clamps to last point after range", async () => {
    expect(interpolateAt(points, 15)).toBe(200);
  });

  test("interpolates midpoint", async () => {
    expect(interpolateAt(points, 5)).toBe(150);
  });
});

describe("normalizeTimeSeries", () => {
  test("handles empty array", async () => {
    expect(normalizeTimeSeries([], 10)).toEqual([]);
  });

  test("resamples to requested count", async () => {
    const points: PricePoint[] = [
      { timestamp: 0, price: 100 },
      { timestamp: 60, price: 200 },
    ];
    const result = normalizeTimeSeries(points, 7);
    expect(result).toHaveLength(7);
    expect(result[0].price).toBe(100);
    expect(result[6].price).toBeCloseTo(200);
  });
});

describe("rmse", () => {
  test("returns 0 for identical arrays", async () => {
    expect(rmse([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  test("returns Infinity for empty arrays", async () => {
    expect(rmse([], [])).toBe(Infinity);
  });

  test("computes correct value", async () => {
    // rmse([1,2,3], [4,5,6]) = sqrt((9+9+9)/3) = 3
    expect(rmse([1, 2, 3], [4, 5, 6])).toBe(3);
  });
});

describe("computeScore", () => {
  const T0 = 1000;
  // Full 120s buffer: 0-45 observation, 45-60 drawing, 60-120 resolution
  const linearBuffer = makePriceBuffer(T0, 120, (t) => 100 + t);

  const baseMatch: MatchData = {
    matchId: "0x01",
    player1Address: "0xAAAA",
    player2Address: "0xBBBB",
    player1Drawing: null,
    player2Drawing: null,
    player1SubmittedAt: T0 + 50_000,
    player2SubmittedAt: T0 + 51_000,
    priceBuffer: linearBuffer,
  };

  test("draw when neither player has a valid drawing", async () => {
    const result = computeScore(baseMatch);
    expect(result.isDraw).toBe(true);
    expect(result.winner).toBe("0x0000000000000000000000000000000000000000");
  });

  test("player2 wins when only player2 has valid drawing", async () => {
    const result = computeScore({
      ...baseMatch,
      player2Drawing: makePriceBuffer(T0 + 60, 60, (t) => 100 + 60 + t).map((p) => ({
        timestamp: p.timestamp,
        price: p.price,
      })),
    });
    expect(result.isDraw).toBe(false);
    expect(result.winner).toBe("0xBBBB");
    expect(result.player1Score).toBe(Infinity);
  });

  test("player1 wins when only player1 has valid drawing", async () => {
    const result = computeScore({
      ...baseMatch,
      player1Drawing: makePriceBuffer(T0 + 60, 60, (t) => 100 + 60 + t).map((p) => ({
        timestamp: p.timestamp,
        price: p.price,
      })),
    });
    expect(result.isDraw).toBe(false);
    expect(result.winner).toBe("0xAAAA");
  });

  test("better prediction wins", async () => {
    // p1 perfectly matches the resolution curve
    const perfectDrawing: DrawingPoint[] = makePriceBuffer(T0 + 60, 60, (t) => 100 + 60 + t);
    // p2 is off by +50
    const offsetDrawing: DrawingPoint[] = makePriceBuffer(T0 + 60, 60, (t) => 150 + 60 + t);

    const result = computeScore({
      ...baseMatch,
      player1Drawing: perfectDrawing,
      player2Drawing: offsetDrawing,
    });

    expect(result.isDraw).toBe(false);
    expect(result.winner).toBe("0xAAAA");
    expect(result.player1Score).toBeLessThan(result.player2Score);
  });

  test("near-tie uses submission time tiebreaker", async () => {
    // Both drawings nearly identical (same curve)
    const drawing: DrawingPoint[] = makePriceBuffer(T0 + 60, 60, (t) => 100 + 60 + t);

    const result = computeScore({
      ...baseMatch,
      player1Drawing: drawing,
      player2Drawing: drawing,
      player1SubmittedAt: T0 + 52_000, // submitted later
      player2SubmittedAt: T0 + 50_000, // submitted earlier
    });

    // Both have identical RMSE → tiebreaker: p2 submitted first
    expect(result.winner).toBe("0xBBBB");
  });

  test("throws on empty price buffer", async () => {
    expect(() =>
      computeScore({ ...baseMatch, priceBuffer: [] })
    ).toThrow("No price buffer");
  });
});
