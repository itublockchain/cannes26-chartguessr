import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import * as chainService from "./services/chain.service.js";
import * as datastreamsService from "./services/datastreams.service.js";
import * as matchService from "./services/match.service.js";
import * as sseService from "./services/sse.service.js";
import * as gatewayTransferService from "./services/gateway-transfer.service.js";
import * as wsService from "./services/ws.service.js";
import authRoutes from "./routes/auth.routes.js";
import matchRoutes from "./routes/match.routes.js";
import creRoutes from "./routes/cre.routes.js";
import sseRoutes from "./routes/sse.routes.js";
import userRoutes from "./routes/user.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/auth", authRoutes);
app.use("/match", matchRoutes);
app.use("/cre", creRoutes);
app.use("/sse", sseRoutes);
app.use("/user", userRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public config for frontend
app.get("/config", (_req, res) => {
  res.json({
    operatorAddress: chainService.getOperatorAddress(),
    escrowAddress: env.escrowContractAddress,
    usdcAddress: env.usdcAddress,
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    arcChainId: env.arcChainId,
    entryFee: "1000000", // 1 USDC
  });
});

async function start() {
  // Connect to DB
  await prisma.$connect();
  console.log("[db] Connected");

  // Init blockchain event listeners
  chainService.init();

  // Init gateway transfer service
  gatewayTransferService.init();

  // Init price feed
  datastreamsService.init();

  // Start matchmaking poller
  matchService.startMatchmaking();

  // Cancel active matches when a player disconnects
  sseService.onDisconnect((userId, walletAddress) => {
    matchService.onPlayerDisconnect(userId, walletAddress).catch((err) => {
      console.error("[disconnect] Failed to handle disconnect:", err);
    });
  });

  const server = createServer(app);

  // Attach WebSocket server for chart data relay
  wsService.init(server);

  server.listen(env.port, () => {
    console.log(`[server] Listening on port ${env.port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  matchService.stopMatchmaking();
  datastreamsService.shutdown();
  await prisma.$disconnect();
  process.exit(0);
});
