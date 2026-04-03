import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { prisma } from "../config/prisma.js";

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

export default router;
