import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import * as chainService from "./services/chain.service.js";
import * as datastreamsService from "./services/datastreams.service.js";
import * as matchService from "./services/match.service.js";
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

async function start() {
  // Connect to DB
  await prisma.$connect();
  console.log("[db] Connected");

  // Init blockchain event listeners
  chainService.init();

  // Init price feed
  datastreamsService.init();

  // Start matchmaking poller
  matchService.startMatchmaking();

  app.listen(env.port, () => {
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
