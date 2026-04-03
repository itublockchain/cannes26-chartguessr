import { Router } from "express";
import { verifyToken } from "../services/auth.service.js";
import * as sseService from "../services/sse.service.js";

const router = Router();

router.get("/connect", (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(401).json({ error: "token query param required" });
    return;
  }

  try {
    const user = verifyToken(token);
    sseService.addClient(user.userId, user.walletAddress, res);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

export default router;
