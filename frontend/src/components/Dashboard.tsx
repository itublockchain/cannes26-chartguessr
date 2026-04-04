import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserProfile } from '../App';

export interface DashboardProps {
  profile: UserProfile | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ profile }) => {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <h1 className="text-2xl font-bold text-foreground mb-2">Dashboard</h1>
      <p className="text-muted-foreground mb-6">Welcome, {profile?.nickname || 'Player'}</p>
      <button
        onClick={() => navigate('/game')}
        className="bg-accent text-accent-foreground px-8 py-3 rounded-full font-bold hover:bg-accent/90 transition-colors"
      >
        PLAY NOW
      </button>
    </div>
  );
};
