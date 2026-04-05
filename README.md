<p align="center">
    <img src="frontend/public/chartguesser-logo.svg" alt="ChartGuessr Banner" width="800" height="200" />
    <h1 align="center">ChartGuessr</h1>
</p>

## The Problem
Many Web3 gaming and prediction platforms suffer from clunky user experiences, slow on-chain confirmation times requiring multiple wallet sign-offs, and uninspired user interfaces. Most crypto prediction markets are static, waiting passive experiences rather than active, competitive, and "savage" matchmaking battles.

## The Solution
**ChartGuessr** is a real-time, high-stakes 1v1 prediction game where players stake USDC, get matched with an opponent instantly using Redis-backed queues, and compete in forecasting crypto price actions. 

We merge **Web3 trustless escrow** with a **premium Web2 gaming aesthetic**, resulting in a lighting-fast experience entirely devoid of continuous wallet popups during gameplay.

## How It Works
```mermaid
sequenceDiagram
    participant Player1
    participant Gateway as Game Gateway (Express)
    participant Redis as Matchmaking Queue
    participant Arc as Arc Smart Contract Escrow
    
    Player1->>Gateway: Join Queue (Submit Dynamic JWT & Stake)
    Gateway->>Redis: Add to Sorted Set (ZADD)
    Redis-->>Gateway: MaQtch Found (Player1 vs Player2)
    Gateway->>Arc: createMatch(matchId, players, fee)
    Arc-->>Gateway: Event: MatchCreated
    Gateway->>Player1: Server-Sent Event (SSE): 'match_created'
    Note over Player1,Arc: Both players draw & submit predictions.<br/>Winner automatically receives the payouts.
```

1. **Connect & Auth:** User connects their wallet using **Dynamic SDK**. The wallet signature generates a session JWT.
2. **Instant Matchmaking:** Player submits a matchmaking request. The backend uses a highly efficient Redis Ordered Set (`zpopmin`) to match identical entry fees instantly.
3. **Escrow Locked:** The backend initiates an on-chain Escrow. Smart contracts lock the USDC stakes.
4. **Real-Time Battle:** Players enter the Arena, fetching live price charts via **Chainlink Data Streams SDK** and executing drawing inputs synced via Server-Sent Events (SSE).
5. **Resolution:** The match is resolved on-chain, and funds are automatically dispersed.

## Key Features
**⚔️ Instant 1v1 Matchmaking** — Powered by Redis Sorted Sets, matching players lightning fast with absolute precision based on their entry fees and join times.

**📡 Server-Sent Events (SSE)** — Zero-latency updates. Bypassing heavy WebSockets, we use lightweight, persistent SSE for push notifications on game states, queue pops, and results.

**💸 Trustless Web3 Escrow** — The house holds nothing. Stakes are secured dynamically in smart contracts. Once the match finishes, your winnings are directly transferred back to your wallet.

**🛡️ Dynamic Wallet SDK** — True seamless onboarding. No seed phrases, fully integrated web3 authentication flow seamlessly mapped to a traditional JWT session.

**📈 Liquid Data Feeds** — Integrated directly with Chainlink Data Streams for sub-second, highly un-manipulatable real-time asset pricing during the draw phase.

**💎 Premium Aesthetic** — A full "glassmorphic", dark-mode React interface for buttery smooth entrance animations and aggressive "VS" screens.



## Architecture
```mermaid
graph TD
    subgraph Client
        A[React & Vite UI]
        C[Dynamic Labs SDK]
    end

    subgraph BackendAPI ["Node / Express Gateway"]
        E[Matchmaking Service]
        F[SSE Broadcaster]
        G[Chain Listener Viem]
        L[CRE Scoring API]
    end

    subgraph CRE ["CRE (Custom Runtime Environment)"]
        M[RMSE Scoring Engine]
    end

    subgraph Infrastructure
        H[Redis Queue]
        I[Prisma & PostgreSQL]
        J[Chainlink Data Streams]
        K[Arc Blockchain]
    end

    A -->|Fetch/REST| BackendAPI
    A -->|SSE Connection| F
    C -->|JWT Handshake| BackendAPI
    E <-->|ZADD / ZPOPMIN| H
    BackendAPI <-->|Prisma ORM| I
    BackendAPI -->|Listen / Write| K
    BackendAPI <-->|Real-time Prices| J
    L <-->|Validate & Score| M
    M -->|Final Settlement| K
```

## Tech Stack
| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite, TailwindCSS v4 |
| **Backend** | Express.js, TypeScript, Node.js (v20+) |
| **Database & Cache** | Prisma ORM, PostgreSQL (Neon), Redis |
| **Web3 & Auth** | Dynamic Wallet SDK, Viem |
| **Blockchain Data** | Chainlink Data Streams |
| **Realtime comm.** | Server-Sent Events (SSE) |

## Project Structure
```
cannes26-predict/
├── backend/                # Node.js Express Gateway
│   ├── src/
│   │   ├── config/         # Prisma, Redis, Env setups
│   │   ├── middleware/     # Auth & Route Middlewares
│   │   ├── routes/         # REST API endpoints
│   │   ├── services/       # Core business logic (Match, Chain, SSE)
│   │   └── index.ts        # App Entrypoint
│   └── package.json        
├── frontend/               # React Vite Application
│   ├── src/
│   │   ├── components/     # UI features (Arena, Dashboard)
│   │   ├── hooks/          # Custom hooks (SSE listeners)
│   │   └── App.tsx         # Routing & Main Layout
│   └── package.json        
└── package.json            # Monorepo root / Yarn Workspaces
```

## Prerequisites
- [Yarn](https://yarnpkg.com/) v1.22+
- Node.js v20+
- [Docker](https://www.docker.com/) & Docker Compose
- PostgreSQL database (or via Docker)
- Redis instance (or via Docker)

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/your-org/cannes26-predict.git
cd cannes26-predict

# Install workspace dependencies
yarn install
```

### 2. Infrastructure (Docker)
Start the required PostgreSQL and Redis services using Docker Compose:
```bash
docker-compose up -d
```
This will spin up:
- **PostgreSQL** on `localhost:5432`
- **Redis** on `localhost:6379`

### 3. Configure the Backend
```bash
cd backend
cp .env.example .env
```

Fill in your `.env`:
```env
# Database & Cache
DATABASE_URL=postgresql://user:pass@host/db
REDIS_URL=redis://localhost:6379

# JWT & Auth
JWT_SECRET=super_secret_jwt_key
DYNAMIC_ENVIRONMENT_ID=your_dynamic_id

# Web3 / Blockchain
ARC_RPC_URL=https://rpc-testnet.arc.com
ESCROW_CONTRACT_ADDRESS=0xYourContract
OPERATOR_PRIVATE_KEY=0xYourPrivateKey
```

Run Database Migrations:
```bash
yarn db:migrate
```

### 4. Configure the Frontend
```bash
cd ../frontend
cp .env.example .env.local
```

Fill in your `.env.local`:
```env
VITE_DYNAMIC_ENVIRONMENT_ID=your_dynamic_id
VITE_GAME_SSE_URL=http://localhost:8080/sse/connect
VITE_API_URL=http://localhost:8080
```

### 5. Start Development Servers
From the root directory, simply run:
```bash
yarn dev
```
This single command spins up:
- **Backend API:** `http://localhost:8080` (or configured PORT)
- **Frontend Vite Server:** `http://localhost:3000`

## Roadmap
- [x] Premium Dashboard UI
- [x] Redis-based fast matchmaking logic
- [x] Smart Contract Viem Listeners implementation
- [x] JWT & Dynamic SDK integrations (Backend scaffolding)
- [ ] Connect Frontend REST API calls with the User Interfaces
- [ ] Finalize the Frontend canvas drawing serialization
- [ ] Implement robust SSE Heartbeats (Ping/Pong)
- [ ] Multi-chain dynamic wallet support

### Technical Specs
- **Sub-500ms Matchmaking:** Powered by Redis Sorted Sets (ZADD/ZPOPMIN).
- **Lightweight State Sync:** Server-Sent Events (SSE) for 0-latency game notifications.
- **On-chain Finality:** Match results settled directly on Arc Testnet.

## CRE Evaluation (RMSE)
The game utilizes a **Custom Runtime Environment (CRE)** to evaluate player performance with zero bias. The scoring logic follows these steps:

1. **Normalization:** The player's prediction drawing and the actual price curve from Chainlink are normalized to a shared time-space (1-second intervals).            
2. **RMSE Calculation:** We calculate the **Root Mean Square Error (RMSE)** between the player's prediction and the real-world price data.                               
   $$RMSE = \sqrt{\frac{1}{n} \sum_{i=1}^{n} (P_i - A_i)^2}$$              
3. **Validation:** Drawings must cover at least 90% of the game duration; otherwise, the submission is disqualified.            
4. **Final Settlement:** The player with the lowest RMSE score (highest accuracy) is declared the winner on-chain.           

## Team
- [Feyyaz Numan Cavlak](https://x.com/feyyazcigim)   
- [Ali Eren Kara](https://github.com/Allie198)   
- [Batıkan Kutluer](https://x.com/0xkutluer)   
- [Mehmet Eren Kırkaş ](https://x.com/merenkirkas)    

Built by ITU Blockchain at ETHGlobal Cannes 2026
