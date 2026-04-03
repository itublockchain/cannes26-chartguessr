import { Router } from "express";
import { verifyDynamicToken } from "../services/auth.service.js";

const router = Router();

// Frontend sends the Dynamic JWT, backend verifies it and returns our own JWT
router.post("/verify", async (req, res) => {
  const { dynamicToken } = req.body;
  if (!dynamicToken) {
    res.status(400).json({ error: "dynamicToken required" });
    return;
  }

  try {
    const result = await verifyDynamicToken(dynamicToken);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

export default router;
