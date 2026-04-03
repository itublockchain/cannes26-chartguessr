import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export function creAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing CRE auth" });
    return;
  }

  const token = header.slice(7);
  if (token !== env.creScoringSecret) {
    res.status(403).json({ error: "Invalid CRE secret" });
    return;
  }

  next();
}
