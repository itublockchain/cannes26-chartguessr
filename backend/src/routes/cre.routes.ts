import { Router } from "express";
import { creAuthMiddleware } from "../middleware/cre-auth.middleware.js";
import { calculateScore } from "../services/scoring.service.js";

const router = Router();

// Called by CRE workflow (or by backend fallback) to get the match score
router.post("/score", creAuthMiddleware, async (req, res) => {
  const { matchId, startPrice, endPrice } = req.body;
  if (!matchId || startPrice === undefined || endPrice === undefined) {
    res.status(400).json({ error: "matchId, startPrice, endPrice required" });
    return;
  }

  try {
    const result = await calculateScore(matchId, startPrice, endPrice);
    res.json(result);
  } catch (err: any) {
    console.error("[cre] Score calculation error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
