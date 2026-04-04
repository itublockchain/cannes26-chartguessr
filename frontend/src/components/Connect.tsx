import React from 'react';
import { DynamicWidget } from '@dynamic-labs/sdk-react-core';

export const Connect: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen">
      <h1 className="text-5xl font-bold text-white text-glow mb-6">CryptoPredict Arena</h1>
      <p className="text-xl text-[#f8f8ff] mb-12 drop-shadow-md">Connect your wallet to enter the game</p>
      <div className="transform scale-125">
        <DynamicWidget />
      </div>
    </div>
  );
};
