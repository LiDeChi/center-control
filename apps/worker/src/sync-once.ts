import { runWithLock } from "./shared";

runWithLock("manual-cli")
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
