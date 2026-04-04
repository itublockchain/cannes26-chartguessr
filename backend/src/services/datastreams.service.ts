// ─── Chainlink Data Streams (requires API key + secret) ───
// import { createClient, decodeReport, type DataStreamsClient } from "@chainlink/data-streams-sdk";
//
// async function initDataStreams(): Promise<void> {
//   const client = createClient({
//     apiKey: env.chainlinkDsApiKey,
//     userSecret: env.chainlinkDsUserSecret,
//     endpoint: env.chainlinkDsRestUrl,
//     wsEndpoint: env.chainlinkDsWsUrl,
//   });
//
//   const stream = client.createStream([env.btcUsdFeedId]);
//
//   stream.on("report", (report: any) => {
//     const decoded = decodeReport(report.fullReport, report.feedID);
//     if ("price" in decoded) {
//       onReport({
//         feedID: report.feedID,
//         validFromTimestamp: report.validFromTimestamp,
//         observationsTimestamp: report.observationsTimestamp,
//         price: decoded.price.toString(),
//         bid: (decoded as any).bid.toString(),
//         ask: (decoded as any).ask.toString(),
//       });
//     }
//   });
//
//   stream.on("error", (err: Error) => {
//     console.error("[price] Stream error:", err);
//   });
//
//   await stream.connect();
// }
// ──────────────────────────────────────────────────────────

import { env } from "../config/env.js";
import type { PriceReport, PricePoint } from "../types/index.js";
import * as sseService from "./sse.service.js";

const BTC_USD_FEED_ID = env.btcUsdFeedId || "0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8";
const DECIMALS = 1e18;

const matchBuffers = new Map<string, PricePoint[]>();
let latestReport: PriceReport | null = null;
let logCounter = 0;
let ws: WebSocket | null = null;

export function getLatestReport(): PriceReport | null {
  return latestReport;
}

export function getLatestPrice(): PricePoint | null {
  if (!latestReport) return null;
  return {
    timestamp: latestReport.observationsTimestamp,
    price: Number(latestReport.price) / DECIMALS,
  };
}

export function startBuffer(matchId: string): void {
  matchBuffers.set(matchId, []);
}

export function stopBuffer(matchId: string): PricePoint[] {
  const buffer = matchBuffers.get(matchId) || [];
  matchBuffers.delete(matchId);
  return buffer;
}

export function getBuffer(matchId: string): PricePoint[] {
  return matchBuffers.get(matchId) || [];
}

/**
 * Central handler — all sources (Chainlink or Binance) produce a PriceReport.
 */
function onReport(report: PriceReport) {
  latestReport = report;

  const price = Number(report.price) / DECIMALS;
  const timestamp = report.observationsTimestamp;

  if (logCounter++ % 10 === 0) {
    console.log(`[price] BTC/USD $${price.toFixed(2)} @ ${new Date(timestamp * 1000).toISOString()}`);
  }

  for (const [matchId, buffer] of matchBuffers.entries()) {
    buffer.push({ price, timestamp });
    sseService.broadcast("price_tick", { matchId, report });
  }
}

/**
 * Convert Binance kline data to Chainlink V3 Report schema.
 */
function binanceToReport(data: any): PriceReport {
  const close = parseFloat(data.k.c);
  const high = parseFloat(data.k.h);
  const low = parseFloat(data.k.l);
  const timestamp = Math.floor(data.k.t / 1000);

  // Map to V3 schema: price=close, bid=low, ask=high (best approximation)
  return {
    feedID: BTC_USD_FEED_ID,
    validFromTimestamp: timestamp,
    observationsTimestamp: timestamp,
    price: BigInt(Math.round(close * DECIMALS)).toString(),
    bid: BigInt(Math.round(low * DECIMALS)).toString(),
    ask: BigInt(Math.round(high * DECIMALS)).toString(),
  };
}

export function init(): void {
  function connect() {
    ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@kline_1s");

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.k) {
          onReport(binanceToReport(data));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log("[price] WS closed, reconnecting in 3s...");
      setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("[price] WS error:", err);
    };

    ws.onopen = () => {
      console.log("[price] Connected to Binance BTC/USD feed");
    };
  }

  connect();
}

export function shutdown(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
}
