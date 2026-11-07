import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PowerSyncContext } from "@powersync/react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import "./workspace.css";
import App from "./App";
import { db } from "./data/database";
import { startSync } from "./data/sync";

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
const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="boot-screen">
    <div className="brand-mark">d</div>
    <p>Opening Daily Driver…</p>
  </div>,
);
async function boot() {
  await db.init();
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <PowerSyncContext.Provider value={db}>
          <App />
        </PowerSyncContext.Provider>
      </ErrorBoundary>
    </StrictMode>,
  );
  startSync();
}
void boot().catch((error) =>
  root.render(
    <div className="boot-screen">
      <h1>We couldn’t open your workspace.</h1>
      <p>{error instanceof Error ? error.message : "Please try again."}</p>
      <p>No local data has been removed.</p>
      <button onClick={() => location.reload()}>Try again</button>
    </div>,
  ),
);
