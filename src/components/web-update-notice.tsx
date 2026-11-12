import { useSyncExternalStore } from "react";
import { Button } from "./ui/button";
import { webUpdates } from "@/lib/web-updates";

export function WebUpdateNotice() {
  const ready = useSyncExternalStore(webUpdates.subscribe, webUpdates.snapshot);
  if (!ready) return null;
  return (
    <div className="notice-banner web-update-notice" role="status">
      <div>
        <strong>An update is ready</strong>
        <p>Save any edits, then refresh to get the latest version.</p>
      </div>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Refresh app
      </Button>
    </div>
  );
}
