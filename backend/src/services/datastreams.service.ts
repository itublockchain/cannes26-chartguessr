import { createClient, decodeReport, type DataStreamsClient } from "@chainlink/data-streams-sdk";
import { env } from "../config/env.js";
import type { PricePoint } from "../types/index.js";
import * as sseService from "./sse.service.js";

const matchBuffers = new Map<string, PricePoint[]>();
let latestPrice: PricePoint | null = null;
let logCounter = 0;

let dsStream: ReturnType<DataStreamsClient["createStream"]> | null = null;
let fallbackWs: WebSocket | null = null;

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
    console.log(`[datastreams] BTC/USD $${price.toFixed(2)} @ ${new Date(timestamp * 1000).toISOString()}`);
  }

  for (const [matchId, buffer] of matchBuffers.entries()) {
    buffer.push({ price, timestamp });
    sseService.broadcast("price_tick", { matchId, price, timestamp });
  }
}

export function init(): void {
  if (env.chainlinkDsApiKey && env.chainlinkDsUserSecret) {
    initDataStreams();
  } else {
    console.log("[datastreams] No API key — using Binance WS fallback");
    initBinanceFallback();
  }
}

async function initDataStreams(): Promise<void> {
  try {
    const client = createClient({
      apiKey: env.chainlinkDsApiKey,
      userSecret: env.chainlinkDsUserSecret,
      endpoint: env.chainlinkDsRestUrl,
      wsEndpoint: env.chainlinkDsWsUrl,
    });

    dsStream = client.createStream([env.btcUsdFeedId]);

    dsStream.on("report", (report: any) => {
      try {
        const decoded = decodeReport(report.fullReport, report.feedID);
        // BTC/USD is V3 (Crypto) — price is bigint with 18 decimals
        if ("price" in decoded) {
          const price = Number(decoded.price) / 1e18;
          onPrice(price, report.observationsTimestamp);
        }
      } catch (err: any) {
        console.error("[datastreams] Failed to decode report:", err);
      }
    });

    dsStream.on("error", (err: Error) => {
      console.error("[datastreams] Stream error:", err);
    });

    await dsStream.connect();
    console.log("[datastreams] Connected to Chainlink Data Streams (mainnet)");
  } catch (err) {
    console.error("[datastreams] Failed to connect to Data Streams, falling back to Binance:", err);
    initBinanceFallback();
  }
}

function initBinanceFallback(): void {
  function connect() {
    fallbackWs = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@kline_1s");

    fallbackWs.onmessage = (event) => {
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

    fallbackWs.onclose = () => {
      console.log("[datastreams] Binance WS closed, reconnecting in 3s...");
      setTimeout(connect, 3000);
    };

    fallbackWs.onerror = (err) => {
      console.error("[datastreams] Binance WS error:", err);
    };

    fallbackWs.onopen = () => {
      console.log("[datastreams] Connected to Binance WS fallback");
    };
  }

  connect();
}

export function shutdown(): void {
  if (dsStream) {
    dsStream.close();
    dsStream = null;
  }
  if (fallbackWs) {
    fallbackWs.close();
    fallbackWs = null;
  }
}
