# CryptoPredict CRE Workflow (TypeScript)

A TypeScript Chainlink CRE workflow for autonomous match settlement in the prediction game.

## Features

- **On-Chain Settlement**: Autonomous match resolution via Chainlink DON consensus
- **Price Feed Integration**: BTC/USD prices from Chainlink Data Streams

## Installation

```bash
bun install
```

## Usage

### Running Simulation

```bash
export CRE_ETH_PRIVATE_KEY=0000000000000000000000000000000000000000000000000000000000000001

cre workflow simulate cre/cre --target=staging-settings
```

## Current Status

**Template only.** Settlement currently runs as a backend fallback (operator settles). This workflow replaces that when deployed to Chainlink DON.

| Mode | How It Works |
|------|-------------|
| Backend Fallback (current) | Operator detects `MatchLocked`, waits 60s, calls `settleMatch` |
| CRE Workflow (target) | DON detects `MatchLocked`, fetches prices, settles via consensus |

## Target Workflow

| Step | Action |
|------|--------|
| 1 | Trigger on `MatchLocked` contract event (EVM Log Trigger) |
| 2 | Wait 60 seconds for drawing phase |
| 3 | Fetch BTC/USD prices from Chainlink Data Streams |
| 4 | Call backend `/cre/score` to calculate winner |
| 5 | Submit `settleMatch(matchId, winner, startPrice, endPrice)` on-chain |

## CRE Configuration

Enable CRE on the escrow contract:

```bash
cast send $ESCROW_ADDRESS "setCREForwarder(address)" $CRE_FORWARDER_ADDRESS \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $OWNER_PRIVATE_KEY
```

Once set, only the CRE forwarder can call `settleMatch`.

## Development

```bash
# Type checking
bun run typecheck
```
