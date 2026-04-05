# CryptoPredict Backend

Express.js backend with TypeScript for matchmaking, real-time game state, and on-chain settlement.

## Quick Start

```bash
# Install dependencies (from root)
yarn install

# Create .env file and configure variables
touch .env

# Run migrations
yarn workspace backend db:migrate
yarn workspace backend db:generate

# Start development server
yarn workspace backend dev
```

The server will start on `http://localhost:3001`.

## Available Scripts

- `dev` - Start development server with hot reload
- `build` - Compile TypeScript
- `start` - Run production build
- `db:migrate` - Run Prisma migrations
- `db:generate` - Generate Prisma client

## Environment Variables

Create a `.env` file and configure:

- `JWT_SECRET` - Secret for signing JWTs
- `DATABASE_URL` - PostgreSQL connection string
- `OPERATOR_PRIVATE_KEY` - Backend wallet private key for on-chain transactions
- `ESCROW_CONTRACT_ADDRESS` - Deployed escrow contract address
- `NEXT_PUBLIC_DYNAMIC_ENV_ID` - Dynamic.xyz environment ID
- `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- `PORT` - Server port (default: `3001`)

## Endpoints

### Health Check
```
GET /health
```

Returns server status.

Response:
```json
{
  "status": "ok"
}
```

## Architecture

### Middleware Stack

1. **cors** - Cross-origin resource sharing
2. **express.json()** - JSON body parsing
3. **authMiddleware** - JWT verification (`Authorization: Bearer <token>`)
4. **creAuthMiddleware** - CRE scoring secret verification (for `/cre/score`)

### Graceful Shutdown

The server handles `SIGTERM` to stop matchmaking, close price feed, and disconnect from the database.

### Adding Routes

1. Create route file in `src/routes/`:

```typescript
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/example", authMiddleware, async (req, res) => {
  res.json({ userId: req.user!.userId });
});

export default router;
```

2. Register in `src/index.ts`:

```typescript
import exampleRoutes from "./routes/example.routes.js";
app.use("/example", exampleRoutes);
```

## Development Workflow

### Hot Reload

The `tsx watch` command monitors all files in `backend/src/`. Changes trigger automatic server restart.

## Production Deployment

```bash
# Build server
yarn workspace backend build

# Start server
yarn workspace backend start
```

## Troubleshooting

### Import errors
- Ensure packages are installed: `yarn install`

### Port already in use
- Change `PORT` in `.env`
- Or kill process: `lsof -ti:3001 | xargs kill`

### Type errors
- Check Prisma client is generated: `yarn workspace backend db:generate`
