import { createRequire } from "node:module";
import type { Server } from "node:http";

const require = createRequire(import.meta.url);
const WS = require("ws");

type WsSocket = InstanceType<typeof WS>;
const WsServer = WS.Server as new (opts: { server: Server }) => {
  on(event: "connection", cb: (ws: WsSocket) => void): void;
};

interface Candle1s {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

const recentCandles: Candle1s[] = [];
const MAX_SNAPSHOT = 300; // keep last 5 min of 1s candles
const clients = new Set<WsSocket>();

let wss: InstanceType<typeof WsServer> | null = null;

export function init(server: Server): void {
  wss = new WsServer({ server });

  wss.on("connection", (ws: WsSocket) => {
    clients.add(ws);

    ws.on("message", (raw: { toString(): string }) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.method === "subscribe") {
          // Send snapshot of recent candles
          if (recentCandles.length > 0) {
            ws.send(JSON.stringify({ type: "snapshot", data: recentCandles }));
          }
        }

        if (msg.method === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  console.log("[ws] WebSocket server attached to HTTP server");
}

/** Called by datastreams.service on each Binance kline tick */
export function pushCandle(candle: Candle1s): void {
  recentCandles.push(candle);
  if (recentCandles.length > MAX_SNAPSHOT) {
    recentCandles.splice(0, recentCandles.length - MAX_SNAPSHOT);
  }

  const payload = JSON.stringify({ type: "candle1s", data: candle });
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(payload);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
