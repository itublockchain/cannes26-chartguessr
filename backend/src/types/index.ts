// Matches Chainlink Data Streams V3 Report schema (Crypto Streams)
export interface PriceReport {
  feedID: string;
  validFromTimestamp: number;
  observationsTimestamp: number;
  price: string;       // int192 as string (18 decimals)
  bid: string;         // int192 as string (18 decimals)
  ask: string;         // int192 as string (18 decimals)
}

// Simplified price point for buffers and scoring
export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface DrawingPoint {
  timestamp: number;
  price: number;
}

export interface ScoreResult {
  winner: string;
  player1Score: number;
  player2Score: number;
  isDraw: boolean;
}

export interface SSEClient {
  id: string;
  userId: string;
  walletAddress: string;
  res: import("express").Response;
}

export interface QueueEntry {
  userId: string;
  walletAddress: string;
  characterId: string;
  entryFee: string;
  joinedAt: number;
}

export interface JwtPayload {
  userId: string;
  walletAddress: string;
}
