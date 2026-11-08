import { ManageData } from "./manage-data";
import type { Workspace } from "@/domain/workspace";
import { AppUpdates } from "./app-updates";
import { PlanningSettings } from "./planning-settings";
import type {
  PlanningSettings as Preferences,
  CalendarSnapshot,
} from "@/domain/planning";
import { useState, type FormEvent } from "react";
import { Cloud, Database, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { syncConfigured } from "@/data/sync";
import { useSignIn } from "@/data/auth";
import type { WorkspaceRepository } from "@/data/repository";

export function Connections({
  workspace,
  account,
  planningSettings,
  calendars,
  repository,
  run,
}: {
  workspace: Workspace;
  account: string | null;
  planningSettings: Preferences;
  calendars: CalendarSnapshot[];
  repository: WorkspaceRepository;
  run: (work: () => Promise<unknown>) => void;
}) {
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<string>("");
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    run(async () => {
      try {
        await signIn(email, password);
        setPassword("");
      } finally {
        setBusy(false);
      }
    });
  }
  async function exportData() {
    const events = await repository.exportEvents();
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), events },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-driver-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="settings-stack">
      <AppUpdates />
      <ManageData workspace={workspace} repository={repository} />
      <section className="settings-section">
        <div className="section-icon">
          <Database />
        </div>
        <h2>Local storage</h2>
        <p>Tasks and focus sessions are available offline.</p>
        <div className="settings-actions">
          <Button variant="outline" onClick={() => run(exportData)}>
            <Download />
            Export task history
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              run(async () => {
                const granted = await navigator.storage?.persist?.();
                setStorage(
                  granted
                    ? "Persistent storage is enabled."
                    : "Your browser manages storage automatically. Keep a backup of important work.",
                );
              })
            }
          >
            Protect local storage
          </Button>
        </div>
        {storage && <p role="status">{storage}</p>}
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <Cloud />
          <h2>Connect your devices</h2>
          <span className="subtle-badge">
            {account ? "Account connected" : "Local only"}
          </span>
        </div>
        {account ? (
          <>
            <p>
              Signed in as {account}. Open this app and sign in with the same
              account on your other devices.
            </p>
          </>
        ) : syncConfigured ? (
          <form className="form-stack connection-form" onSubmit={login}>
            <p>Sign in to sync across your devices.</p>
            <label>
              Email
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button disabled={busy}>
              {busy ? "Connecting…" : "Connect workspace"}
            </Button>
          </form>
        ) : (
          <>
            <p>Sync isn’t configured. Your work is saved on this device.</p>
            <p className="setup-note">
              Setup instructions: <code>docs/stage-one.md</code>
            </p>
          </>
        )}
      </section>
      <PlanningSettings
        settings={planningSettings}
        sources={calendars}
        repository={repository}
        account={account}
      />
      <section className="settings-section">
        <div className="section-heading">
          <Printer />
          <h2>Mac mini printing</h2>
        </div>
        <p>Connect the printer to your Mac mini and start the print worker.</p>
        <p className="setup-note">
          Worker command: <code>npm run print:worker</code>
        </p>
      </section>
    </div>
  );
}
