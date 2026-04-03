export type GameState = 
  | 'waiting'
  | 'match'
  | 'payment'
  | 'Prepearing'
  | 'Calculation'
  | 'Resolve';

export interface GameStateEvent {
  state: GameState;
  [key: string]: any; // Gerekirse sonradan gelecek extra alanlar için esneklik
}
