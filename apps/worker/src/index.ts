import cron from "node-cron";
import { loadConfig } from "@center/core";
import { reportTimeToCron, runWithLock } from "./shared";

async function main() {
  const config = loadConfig();
  const cronExp = reportTimeToCron(config.reportTime);

  await runWithLock("startup");

  cron.schedule(
    cronExp,
    async () => {
      await runWithLock("daily-schedule");
    },
    {
      timezone: config.timezone
    }
  );

  console.log(`[worker] scheduled daily sync at ${config.reportTime} (${config.timezone}), cron=${cronExp}`);
}

main().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exit(1);
});
