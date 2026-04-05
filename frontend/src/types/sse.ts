export interface PriceReport {
  feedID: string
  validFromTimestamp: number
  observationsTimestamp: number
  /** int192 string, 18 decimals. Real price = Number(price) / 1e18 */
  price: string
  bid: string
  ask: string
}

export interface MatchCreatedEvent {
  matchId: string
  opponent: string
  entryFee: string
}

export interface PlayerEnteredEvent {
  matchId: string
  player: string
}

export interface MatchLockedEvent {
  matchId: string
}

export interface GameStartingEvent {
  matchId: string
  startPrice: number
  duration: number
  observationDuration: number
  drawingDuration: number
  resolutionDuration: number
}

export interface DrawingPointData {
  timestamp: number
  price: number
}

export interface ResolutionPhaseEvent {
  matchId: string
  resolutionDuration: number
  opponentDrawing: DrawingPointData[] | null
}

export interface DrawingPhaseEvent {
  matchId: string
  drawingDuration: number
}

export interface PriceTickEvent {
  matchId: string
  report: PriceReport
}

export interface DrawingSubmittedEvent {
  matchId: string
  player: string
}

export interface CalculatingEvent {
  matchId: string
}

export interface ResultEvent {
  matchId: string
  winner: string | null
  player1Score?: number
  player2Score?: number
  payout?: string
  startPrice?: number
  endPrice?: number
  isDraw?: boolean
}

export interface MatchCancelledEvent {
  matchId: string
  reason: string
}

export type SSEEventMap = {
  match_created: MatchCreatedEvent
  player_entered: PlayerEnteredEvent
  match_locked: MatchLockedEvent
  game_starting: GameStartingEvent
  drawing_phase: DrawingPhaseEvent
  resolution_phase: ResolutionPhaseEvent
  price_tick: PriceTickEvent
  drawing_submitted: DrawingSubmittedEvent
  calculating: CalculatingEvent
  result: ResultEvent
  match_cancelled: MatchCancelledEvent
}

export type SSEEventType = keyof SSEEventMap
