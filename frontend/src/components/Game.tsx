import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../App';
import gsap from 'gsap';

export interface GameProps {
  profile: UserProfile | null;
}

export const Game: React.FC<GameProps> = ({ profile }) => {
  const MOCK_STATES = ['IDLE', 'WAITING_LOBBY', 'DRAW_PREDICTION', 'REVEAL_RESULTS'];
  const [gameState, setGameState] = useState<string>(MOCK_STATES[0]);
  const [displayState, setDisplayState] = useState<string>(MOCK_STATES[0]);
  const [transitioning, setTransitioning] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingStateRef = useRef(MOCK_STATES[0]);

  useEffect(() => {
    if (gameState === displayState) return;

    pendingStateRef.current = gameState;

    if (transitioning) return;

    const el = contentRef.current;
    if (!el) return;

    queueMicrotask(() => setTransitioning(true));

    gsap.to(el, {
      opacity: 0,
      y: 20,
      duration: 0.3,
      ease: 'power2.inOut',
      onComplete: () => {
        setDisplayState(pendingStateRef.current);
        gsap.fromTo(
          el,
          { opacity: 0, y: -15 },
          {
            opacity: 1,
            y: 0,
            duration: 0.35,
            ease: 'power2.inOut',
            delay: 0.05,
            onComplete: () => {
              gsap.set(el, { clearProps: 'all' });
              setTransitioning(false);
            },
          }
        );
      },
    });
  }, [gameState, displayState, transitioning]);

  const cycleState = () => {
    const currentIndex = MOCK_STATES.indexOf(gameState);
    setGameState(MOCK_STATES[(currentIndex + 1) % MOCK_STATES.length]);
  };

  const renderStateContent = () => {
    switch (displayState) {
      case 'IDLE':
        return (
          <div className="flex flex-col items-center justify-center w-full h-full">
            <div className="mb-9 flex items-center justify-center">
              <div className="origin-center animate-blob-morph">
                <img src="/finding.svg" alt="blob" className="w-[155px] h-auto block drop-shadow-[0_0_20px_rgba(105,165,255,0.2)]" />
              </div>
            </div>
            <div className="text-[32px] font-bold tracking-[-0.01em] text-white/95 mb-2.5 text-center">Finding Opponent...</div>
            <div className="text-base text-white/35 tracking-[0.01em] mb-[34px] text-center">Scanning the arena for challengers</div>
            <div className="w-[min(360px,55%)] flex flex-col items-center">
              <div className="w-full h-[3px] rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-gradient-to-r from-[#2255cc] to-[#639ce6] animate-load-progress"></div>
              </div>
            </div>
          </div>
        );

      case 'WAITING_LOBBY':
        return (
          <div className="flex flex-col items-center justify-center w-full h-full">
            {/* Check icon */}
            <div className="mb-6 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-[#44b62f]/15 flex items-center justify-center animate-pulse">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#44b62f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            {/* Heading & subtitle */}
            <div className="text-[32px] font-bold tracking-[-0.01em] text-white/95 mb-2.5 text-center">Opponent Found!</div>
            <div className="text-base text-white/35 tracking-[0.01em] mb-10 text-center">Get ready for the battle</div>

            {/* VS section */}
            <div className="flex items-center gap-10 mb-10">
              {/* Player */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-[80px] h-[80px] rounded-full overflow-hidden border-2 border-[#639ce6]/40">
                  <img
                    src={`https://api.dicebear.com/8.x/adventurer/svg?seed=${profile?.avatar || 'Felix'}`}
                    alt="Player"
                    className="w-full h-full"
                  />
                </div>
                <span className="text-sm text-white/70 font-medium">{profile?.nickname || 'Player'}</span>
              </div>

              {/* VS */}
              <div className="text-2xl font-bold text-[#639ce6] tracking-wider">VS</div>

              {/* Opponent */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-[80px] h-[80px] rounded-full overflow-hidden border-2 border-[#ff6b6b]/40">
                  <img
                    src="https://api.dicebear.com/8.x/adventurer/svg?seed=Challenger"
                    alt="Opponent"
                    className="w-full h-full"
                  />
                </div>
                <span className="text-sm text-white/70 font-medium">Challenger</span>
              </div>
            </div>

            {/* Countdown bar */}
            <div className="w-[min(360px,55%)] flex flex-col items-center gap-3">
              <div className="w-full h-[3px] rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-gradient-to-r from-[#2255cc] to-[#639ce6] animate-countdown-fill"></div>
              </div>
              <span className="text-sm text-white/25">Match starts soon...</span>
            </div>
          </div>
        );

      case 'REVEAL_RESULTS':
        return (
          <div className="flex flex-col items-center justify-center w-full h-full">
            {/* Heading */}
            <div className="text-[32px] font-bold tracking-[-0.01em] text-white/95 mb-2.5 text-center">Victory!</div>
            <div className="text-base text-white/35 tracking-[0.01em] mb-10 text-center">Congratulations, Champion!</div>

            {/* Players section — winner big, loser small */}
            <div className="flex items-center gap-10 mb-12">
              {/* Loser (Opponent) — small, left */}
              <div className="flex flex-col items-center gap-2 opacity-40">
                <div className="w-[60px] h-[60px] rounded-full overflow-hidden border border-white/10">
                  <img
                    src="https://api.dicebear.com/8.x/adventurer/svg?seed=Challenger"
                    alt="Opponent"
                    className="w-full h-full grayscale"
                  />
                </div>
                <span className="text-xs text-white/50">Challenger</span>
                <span className="text-[10px] tracking-wider text-white/20 uppercase">Lost</span>
              </div>

              {/* Winner (Player) — big, center, crowned */}
              <div className="flex flex-col items-center gap-3 -mt-6">
                {/* Crown / Trophy above avatar */}
                <div className="animate-pulse">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="#ffcc00" stroke="none">
                    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
                    <rect x="5" y="17" width="14" height="3" rx="1" />
                  </svg>
                </div>
                <div className="w-[120px] h-[120px] rounded-full overflow-hidden border-[3px] border-[#ffcc00] shadow-[0_0_30px_rgba(255,204,0,0.35),0_0_60px_rgba(255,204,0,0.15)]">
                  <img
                    src={`https://api.dicebear.com/8.x/adventurer/svg?seed=${profile?.avatar || 'Felix'}`}
                    alt="Player"
                    className="w-full h-full"
                  />
                </div>
                <span className="text-lg font-bold text-white/90">{profile?.nickname || 'Player'}</span>
                <span className="text-xs font-bold tracking-[0.15em] px-4 py-1.5 rounded-full bg-[#ffcc00] text-[#0f0f1c] uppercase">Winner</span>
              </div>

              {/* Placeholder right side for symmetry */}
              <div className="w-[60px]" />
            </div>

            {/* Play Again button */}
            <button
              onClick={() => setGameState('IDLE')}
              className="px-10 py-3 rounded-full bg-gradient-to-r from-[#2255cc] to-[#639ce6] text-white text-sm font-bold tracking-wider uppercase cursor-pointer transition-transform duration-100 hover:-translate-y-0.5 active:translate-y-0.5"
            >
              Play Again
            </button>
          </div>
        );

      default:
        return (
          <div className="flex flex-col items-center justify-center w-full h-full border border-dashed border-white/20 rounded-xl m-12">
            <p className="text-[#a0a0c0] text-xl font-light">
              [ <span className="text-[#639ce6]">ACTIVE STATE: </span>
              <span className="text-white text-2xl font-bold ml-2">{displayState}</span> ]
            </p>
            <p className="text-white/40 text-sm mt-4">
              The glass card structure persists! Content changes here based on state.
            </p>
          </div>
        );
    }
  };

  return (
    <>
      <div className="absolute inset-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-11 py-8 shrink-0">
          <div className="flex items-center text-[22px] font-bold tracking-[0.06em]">
            <span className="text-white/95">CRYPTO</span>
            <span className="text-[#639ce6]">PREDICT</span>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Debug cycle button to switch states */}
            <button
              className="h-[38px] px-4 flex items-center rounded-full bg-white/5 border border-white/10 text-xs text-white/40 whitespace-nowrap cursor-pointer transition-colors duration-200 hover:bg-white/10"
              onClick={cycleState}
            >
              DEBUG: State Geç ({gameState})
            </button>
          </div>
        </div>

        {/* Body Content - Changes based on state */}
        <div className="flex-1 flex flex-col items-center justify-center w-full">
          <div ref={contentRef} className="w-full h-full">
            {renderStateContent()}
          </div>
        </div>

        {/* Footer content */}
        <div className="flex items-center justify-center px-11 pb-9 shrink-0">
          <div className="h-[38px] px-6 flex items-center rounded-full bg-white/5 border border-[rgba(99,156,230,0.28)] text-sm font-medium text-[#639ce6] whitespace-nowrap">
            {profile?.nickname || 'Player'}
          </div>
        </div>
      </div>
    </>
  );
};
