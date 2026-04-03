export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface DrawingPoint {
  x: number;
  y: number;
  t: number;
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
