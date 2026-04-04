# CryptoPredict - Web Frontend

React 19 application with Web3 integration for the prediction game on Arc Testnet.

## Tech Stack

- **Framework**: React 19 + Vite 8
- **Styling**: TailwindCSS 3
- **Web3**: Dynamic.xyz SDK + viem 2
- **Blockchain**: Arc Testnet (ChainID 5042002)
- **Routing**: React Router 7
- **Animations**: GSAP 3
- **Package Manager**: Yarn

## Getting Started

### 1. Install Dependencies

```bash
yarn install
```

### 2. Environment Setup

Create a `.env` file:

```env
VITE_DYNAMIC_ENVIRONMENT_ID=your_dynamic_environment_id
VITE_GAME_SSE_URL=http://localhost:3001/sse/connect
```

Get your Dynamic.xyz Environment ID from: https://app.dynamic.xyz/

### 3. Run Development Server

```bash
yarn workspace frontend dev
```

Open http://localhost:3000 in your browser.

### 4. Build for Production

```bash
yarn workspace frontend build
yarn workspace frontend preview
```

## Available Scripts

- `dev` - Start development server
- `build` - Type-check + production build
- `lint` - Run ESLint
- `preview` - Preview production build

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── Connect.tsx            # Wallet connection screen
│   │   ├── ProfileCreation.tsx    # Nickname + avatar selection
│   │   ├── Dashboard.tsx          # Home screen
│   │   ├── Game.tsx               # Game arena
│   │   ├── AnimatedBackground.tsx # Morphing blob background
│   │   └── PageTransition.tsx     # Route transitions
│   ├── hooks/
│   │   └── useGameStateSSE.ts     # SSE connection
│   ├── types/
│   │   └── gameState.ts
│   ├── App.tsx                    # Root component + route guards
│   ├── main.tsx                   # Entry point + Dynamic provider
│   └── index.css
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Key Features

### Web3 Integration
- Dynamic.xyz wallet connection (Ethereum + Solana connectors)
- Arc Testnet (ChainID 5042002)
- viem for blockchain interaction
- USDC approve + enterMatch transaction flow

### UI Components
- Wallet connection screen
- Profile creation with DiceBear avatar selection
- Game dashboard and arena
- Animated blob background (GSAP)
- Page transitions (GSAP)

### Routing
- Route guards based on wallet connection and profile state
- Automatic redirects between connect → profile → dashboard → game

## Configuration

### Dynamic.xyz Configuration
Located in `src/main.tsx`. Configured for Ethereum and Solana wallet connectors in connect-only mode.

```tsx
<DynamicContextProvider
  settings={{
    environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID,
    walletConnectors: [EthereumWalletConnectors, SolanaWalletConnectors],
    initialAuthenticationMode: 'connect-only',
  }}
>
```

### Screen Size
Minimum supported width: 800px. Smaller screens show a blocking overlay. Card scaling is handled in `App.tsx` with a 0.5–1.0 range based on viewport.

## Next Steps

1. Get a Dynamic.xyz Environment ID and add to `.env`
2. Start the backend server for SSE connection
3. Connect wallet and create profile to start playing

## Documentation

- [React Documentation](https://react.dev)
- [Dynamic.xyz Documentation](https://docs.dynamic.xyz)
- [Viem Documentation](https://viem.sh)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)
