import type { Response } from "express";
import type { SSEClient } from "../types/index.js";

const clients = new Map<string, SSEClient>();

type DisconnectHandler = (userId: string, walletAddress: string) => void;
let disconnectHandler: DisconnectHandler | null = null;

export function onDisconnect(handler: DisconnectHandler): void {
  disconnectHandler = handler;
}

export function addClient(userId: string, walletAddress: string, res: Response): string {
  const id = `${userId}-${Date.now()}`;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", clientId: id })}\n\n`);

  clients.set(id, { id, userId, walletAddress, res });

  res.on("close", () => {
    clients.delete(id);

    // If this user has no remaining SSE connections, fire disconnect
    const stillConnected = [...clients.values()].some((c) => c.userId === userId);
    if (!stillConnected && disconnectHandler) {
      disconnectHandler(userId, walletAddress);
    }
  });

  return id;
}

export function sendToUser(userId: string, event: string, data: unknown): void {
  for (const client of clients.values()) {
    if (client.userId === userId) {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }
}

export function sendToWallet(walletAddress: string, event: string, data: unknown): void {
  const addr = walletAddress.toLowerCase();
  for (const client of clients.values()) {
    if (client.walletAddress === addr) {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.values()) {
    client.res.write(payload);
  }
}

export function getClientCount(): number {
  return clients.size;
}

export function isUserConnected(userId: string): boolean {
  return [...clients.values()].some((c) => c.userId === userId);
}
