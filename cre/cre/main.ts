import { CronCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk";
import { computeScore, type MatchData, type ScoreResult } from "./scoring";

export type Config = {
  schedule: string;
  backendUrl: string;
  creScoringSecret: string;
};

/**
 * Cron-triggered handler that fetches pending matches from the backend,
 * computes scores using the on-chain-equivalent scoring logic, and
 * returns settlement data for the DON to submit on-chain.
 */
export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const { backendUrl, creScoringSecret } = runtime.config;

  runtime.log(`Fetching pending matches from ${backendUrl}/cre/score`);

  // TODO: When CRE SDK supports async HTTP fetch + EVM write,
  // replace this with:
  //   1. HTTP fetch match data from backend
  //   2. computeScore(matchData) for each match
  //   3. EVM write settleMatch(matchId, winner, startPrice, endPrice)
  //
  // For now, the workflow logs its config and returns a health check.
  runtime.log(`CRE scoring workflow alive. Backend: ${backendUrl}`);

  return JSON.stringify({ status: "ok", backendUrl });
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();

  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

// Re-export scoring for direct use / testing
export { computeScore, type MatchData, type ScoreResult } from "./scoring";
