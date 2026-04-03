import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import * as matchService from "../services/match.service.js";
import * as gameService from "../services/game.service.js";
import type { DrawingPoint } from "../types/index.js";

const router = Router();

const ENTRY_FEE = "1000000"; // 1 USDC (6 decimals)

router.post("/queue/join", authMiddleware, async (req, res) => {
  const { characterId } = req.body;
  if (!characterId) {
    res.status(400).json({ error: "characterId required" });
    return;
  }

  try {
    const position = await matchService.joinQueue(
      req.user!.userId,
      req.user!.walletAddress,
      characterId,
      ENTRY_FEE
    );
    res.json({ position, entryFee: ENTRY_FEE });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/queue/leave", authMiddleware, async (req, res) => {
  try {
    const success = await matchService.leaveQueue(req.user!.userId);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/draw/submit", authMiddleware, async (req, res) => {
  const { matchId, pathData } = req.body;
  if (!matchId || !Array.isArray(pathData)) {
    res.status(400).json({ error: "matchId and pathData required" });
    return;
  }

  try {
    await gameService.submitDrawing(matchId, req.user!.userId, pathData as DrawingPoint[]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
