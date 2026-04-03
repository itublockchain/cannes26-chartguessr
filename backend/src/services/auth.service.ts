import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import type { JwtPayload } from "../types/index.js";

const DYNAMIC_API_BASE = "https://app.dynamic.xyz/api/v0";

interface DynamicJwtPayload {
  sub: string;           // Dynamic user ID
  environment_id: string;
  verified_credentials?: Array<{
    address?: string;
    chain?: string;
    wallet_name?: string;
    format?: string;
  }>;
  [key: string]: unknown;
}

/**
 * Verify a Dynamic-issued JWT by calling Dynamic's validation API,
 * then decode the payload to extract user info.
 */
export async function verifyDynamicToken(
  dynamicToken: string
): Promise<{ token: string; user: { id: string; walletAddress: string } }> {
  // 1. Validate with Dynamic API
  const res = await fetch(
    `${DYNAMIC_API_BASE}/environments/${env.dynamicEnvironmentId}/externalJwt/check`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dynamicToken}`,
      },
      body: JSON.stringify({ encodedJwt: dynamicToken }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dynamic verification failed (${res.status}): ${body}`);
  }

  const result = await res.json();
  if (!result.valid) {
    throw new Error(`Invalid Dynamic JWT: ${(result.errors || []).join(", ")}`);
  }

  // 2. Decode payload (already verified by Dynamic)
  const decoded = jwt.decode(dynamicToken) as DynamicJwtPayload | null;
  if (!decoded?.sub) {
    throw new Error("Could not decode Dynamic JWT");
  }

  // 3. Extract wallet address from verified_credentials
  const walletCred = decoded.verified_credentials?.find(
    (c) => c.address && c.format === "blockchain"
  ) ?? decoded.verified_credentials?.find((c) => c.address);

  const walletAddress = walletCred?.address;
  if (!walletAddress) {
    throw new Error("No wallet address in Dynamic JWT");
  }

  // 4. Upsert user in DB
  const user = await prisma.user.upsert({
    where: { walletAddress: walletAddress.toLowerCase() },
    update: { dynamicUserId: decoded.sub },
    create: {
      walletAddress: walletAddress.toLowerCase(),
      dynamicUserId: decoded.sub,
    },
  });

  // 5. Issue our own JWT for subsequent requests
  const payload: JwtPayload = { userId: user.id, walletAddress: user.walletAddress };
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: "24h" });

  return { token, user: { id: user.id, walletAddress: user.walletAddress } };
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
