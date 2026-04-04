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
//       const price = Number(decoded.price) / 1e18;
//       onPrice(price, report.observationsTimestamp);
//     }
//   });
//
//   stream.on("error", (err: Error) => {
//     console.error("[datastreams] Stream error:", err);
//   });
//
//   await stream.connect();
// }
// ──────────────────────────────────────────────────────────

import { env } from "../config/env.js";
import type { PricePoint } from "../types/index.js";
import * as sseService from "./sse.service.js";

const matchBuffers = new Map<string, PricePoint[]>();
let latestPrice: PricePoint | null = null;
let logCounter = 0;
let ws: WebSocket | null = null;

export function getLatestPrice(): PricePoint | null {
  return latestPrice;
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

function onPrice(price: number, timestamp: number) {
  latestPrice = { price, timestamp };

  if (logCounter++ % 10 === 0) {
    console.log(`[price] BTC/USD $${price.toFixed(2)} @ ${new Date(timestamp * 1000).toISOString()}`);
  }

  for (const [matchId, buffer] of matchBuffers.entries()) {
    buffer.push({ price, timestamp });
    sseService.broadcast("price_tick", { matchId, price, timestamp });
  }
}

export function init(): void {
  function connect() {
    ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@kline_1s");

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.k) {
          const price = parseFloat(data.k.c);
          const timestamp = Math.floor(data.k.t / 1000);
          onPrice(price, timestamp);
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
