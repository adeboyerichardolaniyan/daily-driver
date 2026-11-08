import { ChoiceSelect } from "./ui/choice-select";
import { useState } from "react";
import { Plus, Sparkles, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  collectionSchema,
  contentEntrySchema,
  dailyContent,
  type ContentCollection,
  type ContentEntry,
} from "@/domain/content-collections";
import type { Workspace } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/data/repository";
import { zonedDate } from "@/domain/planning";
export function ContentCollections({
  workspace,
  repository,
}: {
  workspace: Workspace;
  repository: WorkspaceRepository;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  const collection = workspace.contentCollections.find(
    (c) => c.id === selected,
  );
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Content collections{" "}
        <span>{workspace.contentCollections.length || ""}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="collections-dialog">
          <DialogHeader>
            <DialogTitle>Content collections</DialogTitle>
            <DialogDescription>
              Approve entries once. Rotate them daily.
            </DialogDescription>
          </DialogHeader>
          <div className="collection-navigation">
            <ChoiceSelect
              aria-label="Collection"
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a collection</option>
              {workspace.contentCollections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </ChoiceSelect>
            <Button
              variant="outline"
              onClick={() => {
                const id = crypto.randomUUID();
                void repository
                  .append([
                    {
                      type: "content.collection",
                      collection: {
                        id,
                        name: "New collection",
                        kind: "quotes",
                        tone: "Gentle encouragement",
                        theme: "Starting small and making progress",
                        translation: "EasyEnglish (EASY)",
                      },
                    },
                  ])
                  .then(() => setSelected(id))
                  .catch(() => setError("Could not create collection."));
              }}
            >
              <Plus />
              New collection
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
          {collection ? (
            <CollectionEditor
              key={collection.id}
              collection={collection}
              workspace={workspace}
              repository={repository}
              onRemove={() => setSelected(null)}
            />
          ) : (
            <p className="setup-note">
              Create a collection for quotes, Bible passages, reflection
              prompts, or personal reminders.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function CollectionEditor({
  collection,
  workspace,
  repository,
  onRemove,
}: {
  collection: ContentCollection;
  workspace: Workspace;
  repository: WorkspaceRepository;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(() => collectionSchema.parse(collection)),
    [count, setCount] = useState(14),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const request = workspace.contentRequests
    .filter((r) => r.collection.id === collection.id)
    .at(-1);
  const pending =
    request && ["queued", "running", "waiting"].includes(request.status);
  const date = zonedDate(Date.now(), workspace.planningSettings.timeZone);
  const today =
    workspace.contentPicks[`${collection.id}:${date}`] ??
    dailyContent(collection, date, workspace.contentPicks);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }
  const valid = collectionSchema.safeParse(draft).success;
  return (
    <div className="collection-editor">
      <div className="form-stack">
        <label>
          Name
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Content type
            <ChoiceSelect
              aria-label="Content type"
              value={draft.kind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  kind: e.target.value as ContentCollection["kind"],
                })
              }
            >
              <option value="quotes">Original quotes</option>
              <option value="bible">Bible passages & reflections</option>
              <option value="prompts">Reflection prompts</option>
              <option value="reminders">Personal reminders</option>
            </ChoiceSelect>
          </label>
          <label>
            Tone
            <Input
              aria-label="Tone"
              list="collection-tones"
              value={draft.tone}
              onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
            />
            <datalist id="collection-tones">
              <option value="Gentle encouragement" />
              <option value="Practical motivation" />
              <option value="Reflective and calm" />
              <option value="A mix of gentle encouragement and practical motivation" />
            </datalist>
          </label>
        </div>
        {draft.kind === "bible" && (
          <label>
            Bible translation
            <Input
              aria-label="Bible translation"
              list="bible-translations"
              value={draft.translation}
              onChange={(e) =>
                setDraft({ ...draft, translation: e.target.value })
              }
            />
            <datalist id="bible-translations">
              <option value="EasyEnglish (EASY)" />
              <option value="King James Version (KJV)" />
              <option value="New International Version (NIV)" />
              <option value="New Living Translation (NLT)" />
              <option value="English Standard Version (ESV)" />
            </datalist>
          </label>
        )}
        <label>
          Theme
          <Input
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
          />
        </label>
      </div>
      <div className="briefing-buttons">
        <Button
          variant="outline"
          disabled={busy || !valid}
          onClick={() =>
            void work(async () => {
              await repository.append([
                { type: "content.collection", collection: draft },
              ]);
              setMessage("Collection preferences saved.");
            })
          }
        >
          Save preferences
        </Button>
      </div>
      <section
        className="collection-generation-section"
        aria-label="Generate with AI"
      >
        <h3>Generate with AI</h3>
        <div className="collection-generate">
          <label>
            Batch size
            <Input
              type="number"
              min={1}
              max={30}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <Button
            disabled={
              busy ||
              !valid ||
              !!pending ||
              !Number.isInteger(count) ||
              count < 1 ||
              count > 30
            }
            onClick={() =>
              void work(async () => {
                await repository.append([
                  { type: "content.collection", collection: draft },
                  {
                    type: "content.request",
                    requestId: crypto.randomUUID(),
                    collection: draft,
                    count,
                  },
                ]);
              })
            }
          >
            <Sparkles />
            {pending ? "Generation pending" : "Generate drafts"}
          </Button>
        </div>
        <p className="setup-note">
          {draft.kind === "bible"
            ? "Drafts contain references and AI reflections. Add exact scripture manually with its source."
            : "Original AI-written drafts. Review before adding them to rotation."}
        </p>
        {request && <p role="status">{request.message}</p>}
      </section>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {today && (
        <div className="collection-today">
          <small>Today’s selection</small>
          <p>{today.text}</p>
        </div>
      )}
      <div className="collection-entries-heading">
        <div>
          <h3>Entries</h3>
          <span>
            {collection.entries.filter((e) => e.approved).length} approved ·{" "}
            {collection.entries.filter((e) => !e.approved).length} drafts
          </span>
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              await repository.append([
                {
                  type: "content.entry",
                  collectionId: collection.id,
                  entry: {
                    id: crypto.randomUUID(),
                    text: "Your new entry",
                    attribution: "",
                    source: "",
                    translation:
                      draft.kind === "bible" ? draft.translation : "",
                    origin: "personal",
                    approved: false,
                  },
                },
              ]);
            })
          }
        >
          <Plus />
          Add entry
        </Button>
      </div>
      {!collection.entries.length && (
        <div className="collection-empty">
          No entries yet. Generate a batch above or add your own.
        </div>
      )}
      <div className="collection-entries">
        {collection.entries.map((entry) => (
          <EntryEditor
            key={`${entry.id}:${JSON.stringify(entry)}`}
            entry={entry}
            collectionId={collection.id}
            date={date}
            repository={repository}
          />
        ))}
      </div>
      <div className="collection-danger">
        {" "}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              await repository.append([
                {
                  type: "content.removeCollection",
                  collectionId: collection.id,
                },
              ]);
              onRemove();
            })
          }
        >
          <Trash2 />
          Delete collection
        </Button>
      </div>
    </div>
  );
}
function EntryEditor({
  entry,
  collectionId,
  date,
  repository,
}: {
  entry: ContentEntry;
  collectionId: string;
  date: string;
  repository: WorkspaceRepository;
}) {
  const [draft, setDraft] = useState(entry),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      await repository.append([
        { type: "content.entry", collectionId, entry: { ...draft, approved } },
      ]);
    } catch {
      setError("Could not save entry. Check its length and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function act(action: "remove" | "today") {
    setBusy(true);
    setError("");
    try {
      await repository.append([
        action === "remove"
          ? { type: "content.removeEntry", collectionId, entryId: entry.id }
          : { type: "content.pick", collectionId, date, entry },
      ]);
    } catch {
      setError("Could not update entry.");
    } finally {
      setBusy(false);
    }
  }
  const valid = contentEntrySchema.safeParse(draft).success;
  return (
    <article className="collection-entry">
      <span className="entry-status">
        {entry.approved ? "Approved" : "Draft"} ·{" "}
        {draft.origin === "scripture-reflection"
          ? "AI reflection"
          : draft.origin === "ai-original"
            ? "AI original"
            : draft.origin === "quotation"
              ? "Quotation"
              : "Personal"}
      </span>
      <label>
        Entry text
        <textarea
          aria-label="Entry text"
          value={draft.text}
          onChange={(e) => {
            setDraft({ ...draft, text: e.target.value });
            setChecked(false);
          }}
          rows={3}
        />
        <small>{draft.text.length} / 2,000</small>
      </label>
      <div className="form-row">
        <label>
          Attribution / verse reference
          <Input
            value={draft.attribution}
            onChange={(e) => {
              setDraft({ ...draft, attribution: e.target.value });
              setChecked(false);
            }}
          />
        </label>
        <label>
          Text type
          <ChoiceSelect
            aria-label="Text type"
            value={draft.origin}
            onChange={(e) => {
              setDraft({
                ...draft,
                origin: e.target.value as ContentEntry["origin"],
              });
              setChecked(false);
            }}
          >
            <option value="personal">Personal writing</option>
            <option value="ai-original">AI original</option>
            <option value="scripture-reflection">AI Bible reflection</option>
            <option value="quotation">Exact quotation / verse</option>
          </ChoiceSelect>
        </label>
      </div>
      {draft.origin === "quotation" && (
        <>
          <label>
            Source
            <Input
              value={draft.source}
              onChange={(e) => {
                setDraft({ ...draft, source: e.target.value });
                setChecked(false);
              }}
            />
          </label>
          <label>
            Translation (for Bible verses)
            <Input
              value={draft.translation}
              onChange={(e) => {
                setDraft({ ...draft, translation: e.target.value });
                setChecked(false);
              }}
            />
          </label>
          <label className="collection-verify">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked the wording and attribution against the source.
          </label>
        </>
      )}
      <div className="entry-actions">
        <Button
          variant="outline"
          disabled={
            busy ||
            !valid ||
            (draft.origin === "quotation" &&
              (!checked || !draft.source.trim() || !draft.attribution.trim()))
          }
          onClick={() => void save(true)}
        >
          <Check />
          {entry.approved ? "Save approved entry" : "Approve entry"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !valid}
          onClick={() => void save(false)}
        >
          Save as draft
        </Button>
        {entry.approved && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act("today")}
          >
            Use today
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete entry"
          disabled={busy}
          onClick={() => void act("remove")}
        >
          <Trash2 />
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
