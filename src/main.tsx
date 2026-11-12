import "./lib/validation";
import { StrictMode, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PowerSyncContext } from "@powersync/react";
import "@fontsource-variable/inter/standard.css";
import "@fontsource-variable/geist-mono";
import "./index.css";
import "./workspace.css";
import "./typography.css";
import App from "./App";
import { initializeEventStore } from "./data/event-store";
import { db } from "./data/database";
import { WorkspaceAuth } from "./data/auth";
import { startWebUpdates } from "./lib/web-updates";

const stopWebUpdates = startWebUpdates();
if (import.meta.hot) import.meta.hot.dispose(stopWebUpdates);

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="boot-screen">
        <h1>Your workspace needs a moment.</h1>
        <p>{this.state.error}</p>
        <p>Your stored data has not been cleared.</p>
        <button onClick={() => location.reload()}>Try again</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
// Vite re-evaluates this entry during Fast Refresh. Keep a single React owner
// for the container, even when an earlier asynchronous boot is still pending.
const root: Root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
let active = true;
if (import.meta.hot) {
  import.meta.hot.data.root = root;
  import.meta.hot.dispose(() => {
    active = false;
  });
}
root.render(
  <div className="boot-screen">
    <div className="brand-mark">d</div>
    <p>Opening Daily Driver…</p>
  </div>,
);
async function boot() {
  await db.init();
  await initializeEventStore(db);
  if (!active) return;
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <PowerSyncContext.Provider value={db}>
          <WorkspaceAuth>
            <App />
          </WorkspaceAuth>
        </PowerSyncContext.Provider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
void boot().catch((error) => {
  if (!active) return;
  root.render(
    <div className="boot-screen">
      <h1>We couldn’t open your workspace.</h1>
      <p>{error instanceof Error ? error.message : "Please try again."}</p>
      <p>No local data has been removed.</p>
      <button onClick={() => location.reload()}>Try again</button>
    </div>,
  );
});
