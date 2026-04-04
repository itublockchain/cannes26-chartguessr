import React from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { Wallet } from '@phosphor-icons/react';

const ChartLine: React.FC = () => {
  // Rising chart path: starts bottom-left, organic upward movement to top-right
  // Perfectly symmetric U-curve
  const path =
    'M0,20 C150,20 350,280 500,280 C650,280 850,20 1000,20';

  return (
    <div className="absolute bottom-0 right-0 w-full h-[55%] pointer-events-none overflow-hidden">
      <svg
        viewBox="0 0 1000 310"
        preserveAspectRatio="none"
        className="absolute bottom-0 right-0 w-full h-full"
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
          </linearGradient>
          <clipPath id="reveal">
            <rect x="0" y="0" width="1000" height="310">
              <animate
                attributeName="width"
                from="0"
                to="1000"
                dur="8s"
                fill="freeze"
                calcMode="spline"
                keySplines="0.25 0.1 0.25 1"
                keyTimes="0;1"
              />
            </rect>
          </clipPath>
        </defs>

        {/* Gradient fill under the line */}
        <path
          d={`${path} L1000,310 L0,310 Z`}
          fill="url(#chartFill)"
          clipPath="url(#reveal)"
        />

        {/* The chart line */}
        <path
          d={path}
          fill="none"
          stroke="hsl(var(--accent))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath="url(#reveal)"
        />

      </svg>
    </div>
  );
};

export const Connect: React.FC = () => {
  const { setShowAuthFlow } = useDynamicContext();

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center overflow-hidden">
      {/* Animated chart background */}
      <ChartLine />

      <div className="relative z-10 flex flex-col items-center w-full max-w-[440px] px-6">

        {/* Heading */}
        <h1 className="text-center text-foreground font-black leading-none tracking-tight mb-4"
            style={{ fontSize: 'clamp(52px, 7vw, 68px)' }}>
          PREDICT.<br />DRAW.<br />WIN.
        </h1>

        {/* Subtitle */}
        <p className="text-center text-muted-foreground text-lg leading-relaxed mb-10">
          Draw your BTC price prediction, challenge<br />
          opponents and win USDC on-chain.
        </p>

        {/* Connect card */}
        <div className="w-full max-w-[380px] rounded-2xl bg-card border border-border px-6 py-7 shadow-sm">
          <p className="text-center text-muted-foreground text-base font-medium mb-5">
            Connect wallet to play
          </p>

          <button
            onClick={() => setShowAuthFlow(true)}
            className="w-full h-[54px] rounded-full bg-accent text-accent-foreground text-base font-bold cursor-pointer flex items-center justify-center gap-2.5 transition-all duration-150 hover:bg-accent/90 active:scale-[0.98]"
          >
            <Wallet size={18} weight="bold" />
            Connect Wallet
          </button>

          <p className="text-center text-muted-foreground text-xs mt-5">
            By connecting you agree to the terms of service.
          </p>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-8 mt-12 text-center">
          <div>
            <div className="text-foreground/70 text-base font-bold">1 USDC</div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mt-0.5">Entry</div>
          </div>
          <div className="w-px h-6 bg-border" />
          <div>
            <div className="text-foreground/70 text-base font-bold">60s</div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mt-0.5">Round</div>
          </div>
          <div className="w-px h-6 bg-border" />
          <div>
            <div className="text-foreground/70 text-base font-bold">BTC/USD</div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mt-0.5">Live</div>
          </div>
        </div>
      </div>
    </div>
  );
};
