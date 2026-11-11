import { DeleteDialog } from "./delete-dialog";
import { ChoiceSelect } from "./ui/choice-select";
import { BriefingScheduleSettings } from "./briefing-schedule";
import { WeatherSettings } from "./weather-settings";
import { weatherKey, weatherDescription } from "@/domain/weather";
import { ContentCollections } from "./content-collections";
import { zonedDate } from "@/domain/planning";
import { useEffect, useState } from "react";
import {
  Printer,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Workspace } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/data/repository";
import {
  createBriefing,
  renderReceipt,
  type ReceiptSnapshot,
} from "@/domain/receipt";
import {
  briefingTemplateSchema,
  type BriefingTemplate,
  type BriefingSection,
} from "@/domain/briefing";
import {
  deletePrintJob,
  getPrintJobs,
  queueSnapshot,
  type PrintJob,
} from "@/data/printing";
import { useClock } from "@/lib/clock";

const names = {
  tasks: "Today’s steps",
  calendar: "Calendar events",
  text: "Custom text",
  notes: "Writing space",
  collection: "Rotating content",
  weather: "Weather",
  overview: "Day overview",
};
export function Briefings({
  workspace,
  repository,
}: {
  workspace: Workspace;
  repository: WorkspaceRepository;
}) {
  const [draft, setDraft] = useState<BriefingTemplate | null>(null);
  const template = draft ?? workspace.briefingTemplate;
  const [deletingJob, setDeletingJob] = useState<PrintJob | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<BriefingSection["kind"]>("text");
  const now = useClock();
  const day = zonedDate(now, workspace.planningSettings.timeZone);
  const [linkedDay, setLinkedDay] = useState(() =>
    new URLSearchParams(location.search).get("briefing"),
  );
  const issued = workspace.issuedBriefings[day];
  const publicUrl =
    workspace.briefingSchedule.appUrl !== "https://example.invalid"
      ? workspace.briefingSchedule.appUrl
      : import.meta.env.VITE_PUBLIC_APP_URL || "";
  let snapshot: ReceiptSnapshot | undefined;
  let previewError = "";
  try {
    snapshot = createBriefing(
      workspace,
      template,
      publicUrl || "https://example.invalid",
      now,
    );
  } catch (e) {
    previewError =
      e instanceof Error ? e.message : "Could not preview this template.";
  }
  const serialized = snapshot ? JSON.stringify(snapshot) : "";
  async function saveDaily(snapshot: ReceiptSnapshot) {
    const action = { type: "briefing.issue" as const, date: day, snapshot };
    if (JSON.stringify(action).length > 50000)
      throw new Error(
        "This briefing is too long to sync. Shorten the receipt before saving.",
      );
    await repository.append([action]);
  }
  function edit(patch: Partial<BriefingTemplate>) {
    setDraft({ ...template, ...patch });
    setMessage("");
  }
  function sectionEdit(id: string, patch: Partial<BriefingSection>) {
    edit({
      sections: template.sections.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });
  }
  function move(index: number, offset: number) {
    const sections = [...template.sections];
    [sections[index], sections[index + offset]] = [
      sections[index + offset],
      sections[index],
    ];
    edit({ sections });
  }
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  if (linkedDay)
    return (
      <SavedBriefing
        date={linkedDay}
        workspace={workspace}
        repository={repository}
        onBack={() => setLinkedDay(null)}
      />
    );
  return (
    <div className="briefing-editor-layout">
      <div className="briefing-editor">
        <header className="briefing-editor-header">
          <div className="section-heading">
            <h2>Daily briefing</h2>
            <span className="briefing-format">80 mm receipt</span>
          </div>
          <div className="briefing-collection-tools">
            <ContentCollections workspace={workspace} repository={repository} />
            {issued && (
              <Button variant="outline" onClick={() => setLinkedDay(day)}>
                <FileText aria-hidden="true" />
                Open saved briefing
              </Button>
            )}
          </div>
        </header>
        <section
          className="briefing-settings-group"
          aria-labelledby="template-heading"
        >
          <header className="briefing-group-heading">
            <div>
              <h3 id="template-heading">Receipt template</h3>
              <p>Choose what appears on your receipt.</p>
            </div>
            <span>{draft ? "Unsaved changes" : "Saved"}</span>
          </header>
          <section
            className="briefing-weather-panel"
            aria-labelledby="weather-heading"
          >
            <div className="section-heading">
              <h4 id="weather-heading">Weather</h4>
              <span>
                {template.sections.some((s) => s.kind === "weather")
                  ? "On receipt"
                  : "Not on receipt"}
              </span>
            </div>
            <p>
              {template.weather
                ? "Your forecast updates automatically."
                : "Choose a city to include its forecast on your receipt."}
            </p>
            <WeatherSettings
              location={template.weather}
              timeZone={workspace.planningSettings.timeZone}
              cached={
                template.weather
                  ? workspace.weatherSnapshots[
                      weatherKey(
                        template.weather,
                        workspace.planningSettings.timeZone,
                      )
                    ]
                  : undefined
              }
              repository={repository}
              onChange={(weather) =>
                edit({
                  weather,
                  sections:
                    weather &&
                    !template.sections.some((s) => s.kind === "weather") &&
                    template.sections.length < 12
                      ? [
                          {
                            id: crypto.randomUUID(),
                            kind: "weather",
                            title: "Weather",
                            text: "",
                          },
                          ...template.sections,
                        ]
                      : template.sections,
                })
              }
            />
            {template.weather &&
              !template.sections.some((s) => s.kind === "weather") && (
                <Button
                  variant="outline"
                  disabled={template.sections.length >= 12}
                  onClick={() =>
                    edit({
                      sections: [
                        {
                          id: crypto.randomUUID(),
                          kind: "weather",
                          title: "Weather",
                          text: "",
                        },
                        ...template.sections,
                      ],
                    })
                  }
                >
                  Include weather on receipt
                </Button>
              )}
            {template.sections.length >= 12 &&
              !template.sections.some((s) => s.kind === "weather") && (
                <small>Remove a section to make room for weather.</small>
              )}
          </section>
          <div className="form-stack">
            <ReceiptLine
              label="Heading"
              text={template.title}
              collectionId={template.titleCollectionId}
              workspace={workspace}
              onText={(title) => edit({ title })}
              onCollection={(titleCollectionId) => edit({ titleCollectionId })}
            />
            <div className="briefing-options">
              <label>
                <input
                  type="checkbox"
                  checked={template.showQr}
                  onChange={(e) => edit({ showQr: e.target.checked })}
                />{" "}
                Receipt QR code
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={template.showDoneWhen}
                  onChange={(e) => edit({ showDoneWhen: e.target.checked })}
                />{" "}
                Completion hints
              </label>
            </div>
          </div>
          <div className="briefing-sections" aria-label="Receipt sections">
            {template.sections.map((section, index) => (
              <article key={section.id} className="briefing-section">
                <div className="briefing-section-toolbar">
                  <span>
                    {String(index + 1).padStart(2, "0")} · {names[section.kind]}
                  </span>
                  <div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${section.title || names[section.kind]} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${section.title || names[section.kind]} down`}
                      disabled={index === template.sections.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${section.title || names[section.kind]}`}
                      onClick={() =>
                        edit({
                          sections: template.sections.filter(
                            (s) => s.id !== section.id,
                          ),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <label className="briefing-section-label">
                  Section heading
                  <Input
                    value={section.title}
                    onChange={(e) =>
                      sectionEdit(section.id, { title: e.target.value })
                    }
                  />
                </label>
                {section.kind === "weather" && (
                  <small>Uses the city and units in Weather above.</small>
                )}
                {section.kind === "overview" && (
                  <p className="setup-note">
                    Work hours, task estimates, calendar capacity, and reserved
                    time.
                  </p>
                )}
                {section.kind === "collection" && (
                  <label className="briefing-section-label">
                    Collection
                    <ChoiceSelect
                      aria-label="Collection"
                      value={section.collectionId ?? ""}
                      onChange={(e) =>
                        sectionEdit(section.id, {
                          collectionId: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">Choose a collection</option>
                      {workspace.contentCollections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ·{" "}
                          {c.entries.filter((e) => e.approved).length} approved
                        </option>
                      ))}
                    </ChoiceSelect>
                  </label>
                )}
                {section.kind === "text" && (
                  <label className="briefing-section-label">
                    Text
                    <textarea
                      aria-label="Text"
                      aria-describedby={`section-count-${section.id}`}
                      aria-invalid={section.text.length > 4000}
                      value={section.text}
                      onChange={(e) =>
                        sectionEdit(section.id, { text: e.target.value })
                      }
                      rows={4}
                    />
                    <small id={`section-count-${section.id}`}>
                      {section.text.length.toLocaleString()} / 4,000 characters
                    </small>
                  </label>
                )}
              </article>
            ))}
          </div>
          <div className="briefing-add">
            <ChoiceSelect
              aria-label="Section type"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as BriefingSection["kind"])
              }
            >
              {Object.entries(names).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </ChoiceSelect>
            <Button
              variant="outline"
              disabled={template.sections.length >= 12}
              onClick={() =>
                edit({
                  sections: [
                    ...template.sections,
                    {
                      id: crypto.randomUUID(),
                      kind,
                      title: names[kind],
                      text: "",
                    },
                  ],
                })
              }
            >
              <Plus /> Add section
            </Button>
          </div>
          <div className="form-stack">
            <ReceiptLine
              label="Closing line"
              text={template.footer}
              collectionId={template.footerCollectionId}
              workspace={workspace}
              onText={(footer) => edit({ footer })}
              onCollection={(footerCollectionId) =>
                edit({ footerCollectionId })
              }
            />
          </div>
          <div className="briefing-buttons">
            <Button
              disabled={
                busy ||
                !draft ||
                !briefingTemplateSchema.safeParse(template).success
              }
              onClick={() =>
                void perform(async () => {
                  const saved = template;
                  await repository.append([
                    { type: "briefing.template", template: saved },
                  ]);
                  setDraft((current) => (current === saved ? null : current));
                  setMessage("Template saved.");
                })
              }
            >
              Save template
            </Button>
            {draft && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setMessage("");
                }}
              >
                Discard changes
              </Button>
            )}
          </div>
          {message === "Template saved." && <p role="status">{message}</p>}
        </section>
        <section
          className="briefing-settings-group"
          aria-labelledby="today-briefing-heading"
        >
          <header className="briefing-group-heading">
            <div>
              <h3 id="today-briefing-heading">Today’s briefing</h3>
              <p>
                Save a fixed copy of today’s receipt, or send it to your
                printer.
              </p>
            </div>
          </header>
          <div className="briefing-buttons">
            {" "}
            <Button
              variant="outline"
              disabled={busy || !snapshot || !!issued}
              onClick={() =>
                void perform(async () => {
                  if (snapshot) await saveDaily(snapshot);
                  setMessage(
                    "Today’s briefing saved. Reprints keep this version.",
                  );
                })
              }
            >
              Save today’s briefing
            </Button>
            <Button
              variant="outline"
              disabled={busy || !snapshot || !publicUrl}
              onClick={() =>
                void perform(async () => {
                  const receipt =
                    issued ?? createBriefing(workspace, template, publicUrl);
                  if (!issued) await saveDaily(receipt);
                  await queueSnapshot({
                    ...receipt,
                    briefingUrl: new URL(
                      `/?briefing=${day}`,
                      new URL(publicUrl).origin,
                    ).toString(),
                  });
                  setMessage("Briefing queued for the Mac mini.");
                  setJobs(await getPrintJobs());
                })
              }
            >
              <Printer />{" "}
              {issued ? "Reprint saved briefing" : "Send to Mac mini"}
            </Button>
          </div>
          {issued && (
            <p className="setup-note">
              Today’s saved briefing is fixed for reprints. This preview shows
              your current template; edits apply to future briefings.
            </p>
          )}
          {!publicUrl && (
            <p className="setup-note">
              Add your app URL under Daily delivery → Phone link to enable QR
              links and printing.
            </p>
          )}
          {message && message !== "Template saved." && (
            <p role="status">{message}</p>
          )}
          {(error || previewError) && (
            <p role="alert" className="error-text">
              {error || previewError}
            </p>
          )}
        </section>
        <BriefingScheduleSettings
          workspace={workspace}
          repository={repository}
        />
        {deletingJob && (
          <DeleteDialog
            title="print job"
            description={
              deletingJob.status === "queued"
                ? "Cancels this queued delivery and removes it from activity."
                : "Removes this delivery from activity. Files already saved on the Mac mini and physical receipts are kept."
            }
            onClose={() => setDeletingJob(null)}
            onDelete={async () => {
              await deletePrintJob(deletingJob.id);
              setJobs(await getPrintJobs());
            }}
          />
        )}
        <div className="print-history briefing-settings-group">
          <div className="section-heading">
            <h3>Delivery activity</h3>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="Refresh print activity"
              onClick={() =>
                void perform(async () => setJobs(await getPrintJobs()))
              }
            >
              <RefreshCw />
            </Button>
          </div>
          {jobs.length ? (
            jobs.map((job) => (
              <div key={job.id} className="print-job">
                <span>{new Date(job.created_at).toLocaleString()}</span>
                <strong>
                  {job.status === "rendered" ? "PDF saved" : job.status}
                </strong>
                {job.error && <p>{job.error}</p>}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete print job"
                  disabled={job.status === "processing"}
                  title={
                    job.status === "processing"
                      ? "Wait for this job to finish"
                      : "Delete print job"
                  }
                  onClick={() => setDeletingJob(job)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          ) : (
            <p>Check the status of receipts sent to the Mac mini.</p>
          )}
        </div>
      </div>
      <div className="receipt-stage briefing-preview">
        <div className="briefing-preview-label">LIVE PREVIEW</div>
        <ReceiptPreview serialized={serialized} />
        <small>
          Today’s tasks and calendar · {workspace.planningSettings.timeZone}
        </small>
      </div>
    </div>
  );
}
function ReceiptPreview({ serialized }: { serialized: string }) {
  const [result, setResult] = useState({ source: "", html: "", error: "" });
  // Synchronize the iframe with the async QR renderer; ignore obsolete renders.
  useEffect(() => {
    let active = true;
    if (serialized)
      void renderReceipt(JSON.parse(serialized))
        .then((html) => {
          if (active) setResult({ source: serialized, html, error: "" });
        })
        .catch(() => {
          if (active)
            setResult({
              source: serialized,
              html: "",
              error: "Could not render this receipt.",
            });
        });
    return () => {
      active = false;
    };
  }, [serialized]);
  if (!serialized) return <p>Update the template to preview it.</p>;
  if (result.source !== serialized)
    return <p role="status">Updating preview…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return <iframe title="Receipt preview" sandbox="" srcDoc={result.html} />;
}

function SavedBriefing({
  date,
  workspace,
  repository,
  onBack,
}: {
  date: string;
  workspace: Workspace;
  repository: WorkspaceRepository;
  onBack: () => void;
}) {
  const saved = workspace.issuedBriefings[date];
  const [error, setError] = useState("");
  return (
    <div className="saved-briefing">
      <Button variant="ghost" onClick={onBack}>
        Back to editor
      </Button>
      <h2>{saved?.title ?? "Daily briefing"}</h2>
      {saved?.titleAttribution && <small>{saved.titleAttribution}</small>}
      <p>{saved?.date ?? date}</p>
      {saved ? (
        <>
          {saved.weather &&
            saved.template?.sections.some((s) => s.kind === "weather") && (
              <section>
                <h3>Weather · {saved.weather.location.name}</h3>
                <p>
                  {Math.round(saved.weather.temperature)}°
                  {saved.weather.location.unit === "celsius" ? "C" : "F"} ·{" "}
                  {weatherDescription(saved.weather.code)}
                </p>
                <small>
                  {saved.weather.stale ? "Cached · " : ""}Open-Meteo
                </small>
              </section>
            )}
          {saved.template?.sections.some((s) => s.kind === "overview") && (
            <dl>
              {saved.overview?.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="saved-briefing-tasks">
            {saved.tasks.map((item) => {
              const task = workspace.tasks.find((t) => t.id === item.id);
              return (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={task?.completed ?? false}
                    disabled={!task || task.archived}
                    onChange={(e) => {
                      setError("");
                      void repository
                        .edit(item.id, { completed: e.target.checked })
                        .catch(() => setError("Could not update task."));
                    }}
                  />
                  <span>
                    {item.title}
                    <small>{item.doneWhen}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {saved.events?.map((event, i) => (
            <p key={i}>
              <strong>{event.time}</strong> · {event.title}
            </p>
          ))}
          {saved.content?.map((item) => (
            <blockquote key={item.sectionId}>
              <p>{item.text}</p>
              <small>{item.attribution}</small>
            </blockquote>
          ))}
          {saved.template?.sections
            .filter((s) => s.kind === "text")
            .map((s) => (
              <section key={s.id}>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </section>
            ))}
          <footer className="saved-briefing-closing">
            <p>{saved.closingLine ?? saved.template?.footer}</p>
            {saved.closingAttribution && (
              <small>{saved.closingAttribution}</small>
            )}
          </footer>
        </>
      ) : (
        <p>
          This briefing isn’t available on this device yet. Sign in with the
          same account and let it sync.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function ReceiptLine({
  label,
  text,
  collectionId,
  workspace,
  onText,
  onCollection,
}: {
  label: string;
  text: string;
  collectionId?: string;
  workspace: Workspace;
  onText: (value: string) => void;
  onCollection: (id: string | undefined) => void;
}) {
  const collection = workspace.contentCollections.find(
    (c) => c.id === collectionId,
  );
  return (
    <div className="receipt-line-field">
      <div className="receipt-line-heading">
        <span>{label}</span>
        <ChoiceSelect
          aria-label={`${label} source`}
          value={collectionId ?? ""}
          onChange={(e) => onCollection(e.target.value || undefined)}
        >
          <option value="">Custom text</option>
          {collectionId && !collection && (
            <option value={collectionId}>Collection unavailable</option>
          )}
          {workspace.contentCollections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </ChoiceSelect>
      </div>
      <Input
        aria-label={collectionId ? `${label} fallback` : label}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      {collectionId && (
        <small>
          {collection
            ? "Rotates daily. This text is the fallback when no approved entry is available."
            : "This collection was removed. Using your fallback text."}
        </small>
      )}
    </div>
  );
}
