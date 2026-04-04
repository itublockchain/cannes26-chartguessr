import React, { useState } from 'react';
import type { UserProfile } from '../App';
import { DynamicWidget } from '@dynamic-labs/sdk-react-core';
import { motion, AnimatePresence } from 'framer-motion';

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

  const renderStateContent = () => {
    switch(gameState) {
      case 'IDLE':
        return (
          <AnimatePresence mode="wait">
            <motion.div
              key="searching"
              className="flex flex-col items-center gap-8 justify-center w-full h-full"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {/* Orbital spinner (Copied directly from pre-hack matchmaking) */}
              <div className="relative w-28 h-28">
                <div className="absolute inset-0 rounded-full border-2 border-[#fbbf24]/20" />
                <div className="absolute inset-2 rounded-full border-2 border-[#fbbf24]/10" />
                {/* Orbiting dot */}
                <motion.div
                  className="absolute w-4 h-4 rounded-full bg-[#ffcc00] top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  style={{ transformOrigin: "50% 60px" }}
                />
                <motion.div
                  className="absolute w-2.5 h-2.5 rounded-full bg-blue-400 bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2"
                  animate={{ rotate: -360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  style={{ transformOrigin: "50% -46px" }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-3xl">⚡</div>
              </div>

              <div className="text-center">
                <h2 className="text-2xl font-light text-white mb-2 tracking-widest">
                  Finding Opponent
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  >
                    ...
                  </motion.span>
                </h2>
                <p className="text-[#a0a0c0] text-sm font-light">
                  Scanning the arena for challengers
                </p>
              </div>

              {/* Scanning animation - Clean flat yellow color without background */}
              <div className="w-64 h-1.5 rounded-full overflow-hidden mt-6 flex">
                <motion.div
                  className="h-full bg-[#ffcc00] rounded-full"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  style={{ width: "50%" }}
                />
              </div>

              <div className="absolute bottom-10 mt-6 bg-transparent px-6 py-2 rounded-full border border-[#ffcc00]/30 z-10">
                 <span className="text-white text-lg font-light">{profile?.nickname || 'Player'}</span>
              </div>
            </motion.div>
          </AnimatePresence>
        );
      
      default:
        return (
          <div className="flex flex-col items-center justify-center w-full h-full">
            <p className="text-[#a0a0c0] text-2xl font-light">
              [ Oyun Alanı - Current State: <span className="text-[#ffcc00] text-3xl ml-2 animate-pulse font-light">{gameState}</span> ]
            </p>
          </div>
        );
    }
  };

  return (
    <div className="relative w-screen h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0f0f1c]">
      {/* Background removed */}
      
      {/* Top Right Widget */}
      <div className="absolute top-5 right-5 z-50">
        <DynamicWidget />
      </div>

      {/* Main Game Interface Container - Flat Clean Border */}
      <div className="relative z-10 flex flex-col items-center p-8 bg-[#1e1e3c]/60 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-5xl h-[80%] flex-shrink-0 mx-8">
        
        {/* Header / Top Bar Mock */}
        <div className="w-full flex justify-between items-center mb-8 border-b border-white/10 pb-6 px-4">
          <h1 className="text-3xl text-white font-light tracking-widest">
            CRYPTO<span className="text-[#ffcc00]">PREDICT</span>
          </h1>
          <button 
            onClick={cycleState}
            className="bg-[#1e1e3c] hover:bg-[#2a2a4a] text-white border border-[#ffcc00]/40 py-2 px-6 rounded-lg font-light cursor-pointer transition-colors duration-200 text-sm z-50 relative"
          >
            DEBUG: Sonraki State ({gameState})
          </button>
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 w-full bg-black/40 rounded-xl border border-white/5 relative overflow-hidden flex items-center justify-center">
          {renderStateContent()}
        </div>

      </div>
    </div>
  );
};
