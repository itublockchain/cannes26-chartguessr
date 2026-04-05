import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { prisma } from "../config/prisma.js";
import * as gatewayTransfer from "../services/gateway-transfer.service.js";

const router = Router();

router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        matchesAsP1: { orderBy: { createdAt: "desc" }, take: 20 },
        matchesAsP2: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const allMatches = [...user.matchesAsP1, ...user.matchesAsP2].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    const wins = allMatches.filter((m) => m.winnerId === user.id).length;
    const losses = allMatches.filter(
      (m) => m.state === "RESOLVED" && m.winnerId !== user.id
    ).length;
    const draws = allMatches.filter((m) => m.state === "DRAW").length;

    res.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        characterId: user.characterId,
        delegateActive: user.delegateActive,
      },
      stats: { wins, losses, draws, totalGames: wins + losses + draws },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/profile", authMiddleware, async (req, res) => {
  const { username, characterId } = req.body;
  if (!username && !characterId) {
    res.status(400).json({ error: "username or characterId required" });
    return;
  }

  const data: Record<string, string> = {};
  if (username !== undefined) data.username = username;
  if (characterId !== undefined) data.characterId = characterId;

  try {
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data,
    });
    res.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        characterId: user.characterId,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Game balance: Gateway balance minus locked entry fees for active matches
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Get Gateway unified balance
    const { total: gatewayBalance } = await gatewayTransfer.getGatewayBalance(user.walletAddress);

    // Sum entry fees for active (non-resolved/cancelled) matches
    const activeMatches = await prisma.match.findMany({
      where: {
        OR: [{ player1Id: user.id }, { player2Id: user.id }],
        state: { in: ["CREATED", "AWAITING_PLAYERS", "PARTIAL", "LOCKED", "PLAYING", "CALCULATING"] },
      },
      select: { entryFee: true },
    });

    const lockedAmount = activeMatches.reduce(
      (sum, m) => sum + parseFloat(m.entryFee.toString()) / 1e6,
      0
    );

    const available = Math.max(0, gatewayBalance - lockedAmount);

    res.json({
      gatewayBalance: gatewayBalance.toFixed(2),
      lockedAmount: lockedAmount.toFixed(2),
      available: available.toFixed(2),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mark that the user has added operator as Gateway delegate
router.post("/delegate-confirmed", authMiddleware, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { delegateActive: true },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
