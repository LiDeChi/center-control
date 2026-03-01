import { runSyncPipeline } from "@center/core";

let running = false;

export async function runWithLock(reason: string) {
  if (running) {
    console.log(`[worker] skip ${reason}, previous sync still running`);
    return null;
  }

  running = true;
  console.log(`[worker] sync started (${reason}) at ${new Date().toISOString()}`);
  try {
    const result = await runSyncPipeline();
    console.log(
      `[worker] sync completed (${reason}): projects=${result.projectCount}, tracked=${result.trackedCount}, external=${result.externalCount}, relations=${result.relationCount}, report=${result.reportDate}`
    );
    return result;
  } catch (error) {
    console.error(`[worker] sync failed (${reason})`, error);
    throw error;
  } finally {
    running = false;
  }
}

export function reportTimeToCron(reportTime: string) {
  const [hourRaw, minuteRaw] = reportTime.split(":");
  const hour = Number.parseInt(hourRaw || "9", 10);
  const minute = Number.parseInt(minuteRaw || "0", 10);
  return `${minute} ${hour} * * *`;
}
