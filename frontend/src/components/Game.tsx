import React, { useState } from 'react';
import type { UserProfile } from '../App';

export interface GameProps {
  profile: UserProfile | null;
}

export const Game: React.FC<GameProps> = ({ profile }) => {
  const MOCK_STATES = ['IDLE', 'WAITING_LOBBY', 'DRAW_PREDICTION', 'REVEAL_RESULTS'];
  const [gameState, setGameState] = useState<string>(MOCK_STATES[0]);

  const cycleState = () => {
    const currentIndex = MOCK_STATES.indexOf(gameState);
    setGameState(MOCK_STATES[(currentIndex + 1) % MOCK_STATES.length]);
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-center px-8 py-4 shrink-0">
        <button
          onClick={cycleState}
          className="text-xs text-muted-foreground border border-border px-3 py-1.5 rounded-full hover:bg-muted transition-colors"
        >
          DEBUG: {gameState}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">State: {gameState}</p>
      </div>

      <div className="flex items-center justify-center px-8 pb-6 shrink-0">
        <span className="text-sm text-muted-foreground">{profile?.nickname || 'Player'}</span>
      </div>
    </div>
  );
};
