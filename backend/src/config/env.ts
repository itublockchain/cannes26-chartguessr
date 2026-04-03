import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const env = {
  port: parseInt(process.env.PORT || "3001"),
  jwtSecret: required("JWT_SECRET"),

  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  arcRpcUrl: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
  arcChainId: parseInt(process.env.ARC_CHAIN_ID || "5042002"),

  operatorPrivateKey: required("OPERATOR_PRIVATE_KEY"),
  escrowContractAddress: required("ESCROW_CONTRACT_ADDRESS"),
  usdcAddress: process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000",

  dynamicEnvironmentId: required("NEXT_PUBLIC_DYNAMIC_ENV_ID"),

  chainlinkDsApiKey: process.env.CHAINLINK_DS_API_KEY || "",
  chainlinkDsUserSecret: process.env.CHAINLINK_DS_USER_SECRET || "",
  chainlinkDsWsUrl: process.env.CHAINLINK_DS_WS_URL || "wss://ws.testnet-dataengine.chain.link",
  chainlinkDsRestUrl: process.env.CHAINLINK_DS_REST_URL || "https://api.testnet-dataengine.chain.link",
  btcUsdFeedId: process.env.BTC_USD_FEED_ID || "",

  creScoringSecret: process.env.CRE_SCORING_SECRET || "",
} as const;
