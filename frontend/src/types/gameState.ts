export type GameState = 
  | 'waiting'
  | 'match'
  | 'payment'
  | 'Prepearing'
  | 'Calculation'
  | 'Resolve';

export interface GameStateEvent {
  state: GameState;
  [key: string]: unknown; // Gerekirse sonradan gelecek extra alanlar için esneklik
}
