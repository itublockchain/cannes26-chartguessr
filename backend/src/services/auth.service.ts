import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import type { JwtPayload } from "../types/index.js";

const JWKS_URL = `https://app.dynamic.xyz/api/v0/sdk/${env.dynamicEnvironmentId}/.well-known/jwks`;
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

interface DynamicJwtPayload {
  sub: string;
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
 * Verify a Dynamic-issued JWT using their JWKS public keys,
 * then extract user info from the payload.
 */
export async function verifyDynamicToken(
  dynamicToken: string
): Promise<{ token: string; user: { id: string; walletAddress: string } }> {
  // 1. Verify JWT signature with Dynamic's JWKS
  const { payload } = await jwtVerify(dynamicToken, jwks);
  const decoded = payload as unknown as DynamicJwtPayload;

  if (!decoded.sub) {
    throw new Error("Could not decode Dynamic JWT");
  }

  // 2. Extract wallet address from verified_credentials
  const walletCred =
    decoded.verified_credentials?.find(
      (c) => c.address && c.format === "blockchain"
    ) ?? decoded.verified_credentials?.find((c) => c.address);

  const walletAddress = walletCred?.address;
  if (!walletAddress) {
    throw new Error("No wallet address in Dynamic JWT");
  }

  // 3. Upsert user in DB
  const user = await prisma.user.upsert({
    where: { walletAddress: walletAddress.toLowerCase() },
    update: { dynamicUserId: decoded.sub },
    create: {
      walletAddress: walletAddress.toLowerCase(),
      dynamicUserId: decoded.sub,
    },
  });

  // 4. Issue our own JWT for subsequent requests
  const jwtPayload: JwtPayload = {
    userId: user.id,
    walletAddress: user.walletAddress,
  };
  const token = jwt.sign(jwtPayload, env.jwtSecret, { expiresIn: "24h" });

  return { token, user: { id: user.id, walletAddress: user.walletAddress } };
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
