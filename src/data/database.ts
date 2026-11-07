import { isTauri } from "@tauri-apps/api/core";
import { PowerSyncDatabase } from "@powersync/web";
import { schema } from "./schema";

export const db = new PowerSyncDatabase({
  schema,
  database: {
    dbFilename: "daily-driver-v1.sqlite",
    ...(isTauri() ? { useWebWorker: false, enableMultiTabs: false } : {}),
  },
});
