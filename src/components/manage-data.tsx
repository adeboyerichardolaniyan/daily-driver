import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ChoiceSelect } from "./ui/choice-select";
import { DeleteDialog } from "./delete-dialog";
import { descendants, type Workspace, type Action } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/data/repository";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { connectedClient } from "@/data/sync";

type Item = {
  key: string;
  category: string;
  title: string;
  description: string;
  remove: () => Promise<unknown>;
};
export function ManageData({
  workspace,
  repository,
}: {
  workspace: Workspace;
  repository: WorkspaceRepository;
}) {
  const [category, setCategory] = useState("Tasks & projects");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const remove =
    (kind: Extract<Action, { type: "object.delete" }>["kind"], id: string) =>
    () =>
      repository.append([{ type: "object.delete", kind, id }]);
  const items: Item[] = [
    ...workspace.tasks.map((task) => ({
      key: task.id,
      category: "Tasks & projects",
      title: task.title,
      description: `Removes this ${task.kind} and ${descendants(workspace.tasks, task.id).size - 1} nested tasks or steps from all synced devices.`,
      remove: () => repository.deleteTask(task, workspace.tasks),
    })),
    ...workspace.proposals.map((p) => ({
      key: p.requestId,
      category: "AI drafts",
      title: p.source.title,
      description:
        "Removes this draft. Tasks already approved from it are kept.",
      remove: remove("proposal", p.requestId),
    })),
    ...workspace.dailyPlans.map((p) => ({
      key: p.id,
      category: "Daily plans",
      title: `${p.date} · ${p.status}`,
      description:
        "Removes the saved plan. Existing tasks and their scheduled times are kept.",
      remove: remove("plan", p.id),
    })),
    ...Object.entries(workspace.issuedBriefings).map(([date, receipt]) => ({
      key: date,
      category: "Saved briefings",
      title: `${date} · ${receipt.title}`,
      description:
        "Removes the saved briefing and its phone view. PDFs and print jobs already sent to the Mac mini are separate.",
      remove: remove("briefing", date),
    })),
    ...workspace.contentCollections.map((c) => ({
      key: c.id,
      category: "Collections",
      title: c.name,
      description: `Removes this collection and its ${c.entries.length} entries. Receipt headings and sections will use their fallback text.`,
      remove: remove("collection", c.id),
    })),
    ...workspace.contentCollections.flatMap((c) =>
      c.entries.map((entry) => ({
        key: entry.id,
        category: "Collection entries",
        title: entry.text,
        description: `Removes this entry from “${c.name}” and future content rotation. Saved receipts keep their original text.`,
        remove: remove("entry", entry.id),
      })),
    ),
    ...workspace.calendars.map((c) => ({
      key: c.id,
      category: "Calendars",
      title: c.name,
      description:
        "Disconnects this subscription and removes its imported events. Your Google or Outlook calendar is unchanged. Requires a connection.",
      remove: () =>
        connectedClient().mutation(api.calendars.remove, {
          id: c.id as Id<"calendar_sources">,
        }),
    })),
    ...workspace.calendars.flatMap((c) =>
      c.events.map((event) => ({
        key: c.id + ":" + event.id,
        category: "Calendar events",
        title: event.title,
        description: `Removes this occurrence from Daily Driver and availability calculations. The event in “${c.name}” on Google or Outlook is unchanged.`,
        remove: remove("calendarEvent", c.id + ":" + event.id),
      })),
    ),
    ...workspace.briefingTemplate.sections.map((section) => ({
      key: section.id,
      category: "Receipt sections",
      title: section.title,
      description:
        "Removes this section from the receipt template. Saved receipts are unchanged.",
      remove: () =>
        repository.append([
          {
            type: "briefing.template",
            template: {
              ...workspace.briefingTemplate,
              sections: workspace.briefingTemplate.sections.filter(
                (s) => s.id !== section.id,
              ),
            },
          },
        ]),
    })),
    ...Object.entries(workspace.weatherSnapshots).map(([key, s]) => ({
      key,
      category: "Weather",
      title: s.location.name + " · cached forecast",
      description:
        "Removes the cached forecast. A configured weather location can fetch a fresh forecast later.",
      remove: remove("weather", key),
    })),
    ...workspace.contentRequests.map((r) => ({
      key: r.requestId,
      category: "Generation history",
      title: r.collection.name + " · " + r.status,
      description:
        "Removes this generation request. Entries already generated are kept.",
      remove: remove("contentRequest", r.requestId),
    })),
  ];
  if (workspace.briefingTemplate.weather)
    items.push({
      key: "weather-location",
      category: "Weather",
      title: workspace.briefingTemplate.weather.name + " · location",
      description:
        "Removes the configured weather location from the receipt template.",
      remove: () =>
        repository.append([
          {
            type: "briefing.template",
            template: { ...workspace.briefingTemplate, weather: undefined },
          },
        ]),
    });
  if (workspace.focus)
    items.push({
      key: workspace.focus.sessionId,
      category: "Focus session",
      title: "Current focus session",
      description:
        "Clears this focus session across devices. The task is kept.",
      remove: remove("focus", workspace.focus.sessionId),
    });
  const categories = [
    "Tasks & projects",
    "AI drafts",
    "Daily plans",
    "Saved briefings",
    "Collections",
    "Collection entries",
    "Calendars",
    "Calendar events",
    "Receipt sections",
    "Weather",
    "Generation history",
    "Focus session",
  ];
  const visible = items.filter(
    (item) =>
      item.category === category &&
      item.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="settings-section" aria-label="Manage data">
      <div className="section-heading">
        <Trash2 />
        <h2>Manage data</h2>
      </div>
      <p>
        Delete objects from your workspace across devices. Sync history is
        retained.
      </p>
      <div className="settings-actions">
        <ChoiceSelect
          aria-label="Object type"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setSearch("");
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </ChoiceSelect>
        <Input
          aria-label="Find an object"
          placeholder="Find an object…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="managed-objects">
        {visible.slice(0, 200).map((item) => (
          <div className="managed-object" key={item.key}>
            <span>{item.title}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${item.title}`}
              onClick={() => setSelected(item)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {!visible.length && <p>No objects here.</p>}
        {visible.length > 200 && (
          <p>Showing 200 objects. Search to narrow the list.</p>
        )}
      </div>
      {selected && (
        <DeleteDialog
          title={selected.title}
          description={selected.description}
          onDelete={selected.remove}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
