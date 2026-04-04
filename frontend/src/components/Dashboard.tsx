import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DynamicWidget } from '@dynamic-labs/sdk-react-core';
import type { UserProfile } from '../App';

export interface DashboardProps {
  profile: UserProfile | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ profile }) => {
  const navigate = useNavigate();

  return (
    <div className="relative flex flex-row w-screen h-screen overflow-hidden">
      {/* Background removed */}
      
      {/* Dynamic Widget Top Right */}
      <div className="absolute top-5 right-5 z-50">
        <DynamicWidget />
      </div>

      {/* Center: Avatar on Sphere */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[700px] flex flex-col items-center justify-center z-10 pointer-events-none">
        <div className="text-4xl font-bold text-white text-glow z-[3] mb-8">
          {profile?.nickname || 'Player'}
        </div>
        <div className="z-[2] animate-float-avatar -mb-16">
          <img 
            src={`https://api.dicebear.com/8.x/adventurer/svg?seed=${profile?.avatar || 'Felix'}`} 
            alt="Current Avatar" 
            className="w-[250px] h-[250px] filter drop-shadow-[0_20px_20px_rgba(0,0,0,0.8)] pointer-events-auto"
          />
        </div>
        {/* Glassmorphic 3D Energy Sphere */}
        <div 
          className="w-[450px] h-[450px] rounded-full z-[1] border-t border-[#a07aff]/40 shadow-2xl pointer-events-auto"
          style={{
            background: 'radial-gradient(circle at 35% 20%, rgba(200, 180, 255, 0.9) 0%, rgba(120, 80, 240, 0.85) 20%, rgba(30, 10, 120, 0.95) 55%, rgba(5, 0, 30, 1) 90%)',
            boxShadow: 'inset -50px -50px 100px rgba(0,0,0,0.9), inset 20px 20px 80px rgba(255,255,255,0.4), 0 -20px 100px rgba(131,103,240,0.4), 0 0 150px rgba(66,0,255,0.3)',
          }}
        ></div>
      </div>

      {/* Right Side: Play Button & Info */}
      <div className="absolute right-[8%] top-1/2 -translate-y-1/2 flex flex-col items-end w-[500px] z-20 text-right">
        <h1 className="text-7xl font-extrabold mb-6 text-white text-glow leading-tight">
          CryptoPredict<br/>Arena
        </h1>
        <p className="text-2xl text-[#a0a0c0] italic drop-shadow-md mb-16">
          Welcome back, <span className="text-[#ffcc00] not-italic">{profile?.nickname || 'Player'}</span>!
        </p>
        <button 
          onClick={() => navigate('/game')}
          className="bg-btn-gradient text-white border-none py-6 px-16 rounded-full text-3xl font-bold uppercase tracking-widest cursor-pointer btn-shadow transition-transform duration-100 outline-none hover:-translate-y-1 active:translate-y-2"
        >
          PLAY NOW
        </button>
      </div>
    </div>
  );
};
