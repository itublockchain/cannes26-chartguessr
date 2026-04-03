import express from "express";

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = 4000;

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Health endpoint - Dummy since no WebSocket state
app.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`
🚀  Backend ready (express only)
    REST Health: http://localhost:${PORT}/health
  `);
});
