import { expect, it } from "vitest";
import {
  dailyContent,
  type ContentCollection,
  type ContentEntry,
} from "../src/domain/content-collections";
import {
  projectWorkspace,
  type Action,
  type WorkspaceEvent,
  taskDefaults,
} from "../src/domain/workspace";
import { defaultBriefingTemplate } from "../src/domain/briefing";
import { createBriefing, renderReceipt } from "../src/domain/receipt";
const id = crypto.randomUUID();
const entry = (text: string): ContentEntry => ({
  id: crypto.randomUUID(),
  text,
  attribution: "",
  source: "",
  translation: "",
  origin: "personal",
  approved: true,
});
const collection: ContentCollection = {
  id,
  name: "Encouragement",
  kind: "quotes",
  tone: "Gentle",
  theme: "Progress",
  translation: "",
  entries: [entry("One"), entry("Two"), entry("Three")],
};
const events = (actions: Action[]): WorkspaceEvent[] =>
  actions.map((a, i) => ({
    id: crypto.randomUUID(),
    actor_id: "local",
    clock: i + 1,
    created_at: "2026-11-07T15:00:00Z",
    payload: JSON.stringify(a),
  }));
it("rotates each approved entry once per cycle and ignores drafts", () => {
  const c = {
    ...collection,
    entries: [...collection.entries, { ...entry("Draft"), approved: false }],
  };
  const picks = [7, 8, 9].map((d) => dailyContent(c, `2026-11-0${d}`)?.id);
  expect(new Set(picks).size).toBe(3);
  expect(dailyContent(c, "2026-11-10")?.id).toBe(picks[0]);
  expect(
    dailyContent({ ...c, entries: [...c.entries].reverse() }, "2026-11-07")?.id,
  ).toBe(picks[0]);
});
it("keeps today's selection stable through edits and permits an explicit replacement", () => {
  const actions: Action[] = [
    { type: "content.collection", collection },
    ...collection.entries.map((e) => ({
      type: "content.entry" as const,
      collectionId: id,
      entry: e,
    })),
  ];
  const initial = projectWorkspace(events(actions));
  expect(initial.contentPicks[`${id}:2026-11-07`].text).toBe("One");
  const revised = projectWorkspace(
    events([
      ...actions,
      {
        type: "content.entry",
        collectionId: id,
        entry: { ...collection.entries[0], text: "Changed" },
      },
    ]),
  );
  expect(revised.contentPicks[`${id}:2026-11-07`].text).toBe("One");
  const selected = projectWorkspace(
    events([
      ...actions,
      {
        type: "content.pick",
        collectionId: id,
        date: "2026-11-07",
        entry: collection.entries[1],
      },
    ]),
  );
  expect(selected.contentPicks[`${id}:2026-11-07`].text).toBe("Two");
});
it("AI results are drafts, deleted collections stay deleted, and preferences remain independent", () => {
  const requestId = crypto.randomUUID();
  const state = projectWorkspace(
    events([
      { type: "content.collection", collection },
      { type: "content.request", requestId, collection, count: 3 },
      {
        type: "content.result",
        requestId,
        status: "ready",
        entries: collection.entries,
        message: "Ready",
      },
    ]),
  );
  expect(state.contentCollections[0].entries.every((e) => !e.approved)).toBe(
    true,
  );
  const removed = projectWorkspace(
    events([
      { type: "content.collection", collection },
      { type: "content.request", requestId, collection, count: 3 },
      { type: "content.removeCollection", collectionId: id },
      {
        type: "content.result",
        requestId,
        status: "ready",
        entries: collection.entries,
        message: "Ready",
      },
    ]),
  );
  expect(removed.contentCollections).toEqual([]);
});
it("renders exactly one briefing QR for multiple tasks and freezes issued content", async () => {
  const state = projectWorkspace([]);
  state.contentCollections = [collection];
  state.tasks = [1, 2].map((n) => ({
    id: crypto.randomUUID(),
    ...taskDefaults(`Task ${n}`),
  }));
  const template = defaultBriefingTemplate();
  template.sections.push({
    id: "rotation",
    kind: "collection",
    collectionId: id,
    title: "Encouragement",
    text: "",
  });
  const snapshot = createBriefing(
    state,
    template,
    "https://daily.example",
    Date.parse("2026-11-07T15:00:00Z"),
  );
  const html = await renderReceipt(snapshot);
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(snapshot.briefingUrl).toBe(
    "https://daily.example/?briefing=2026-11-07",
  );
  const issued = projectWorkspace(
    events([
      { type: "briefing.issue", date: "2026-11-07", snapshot },
      {
        type: "briefing.issue",
        date: "2026-11-07",
        snapshot: { ...snapshot, title: "Changed" },
      },
    ]),
  );
  expect(issued.issuedBriefings["2026-11-07"].title).toBe(snapshot.title);
});
it("continues the cycle after a manually selected entry without immediately repeating it", () => {
  const picks = { [`${id}:2026-11-07`]: collection.entries[0] };
  const sequence = ["2026-11-07", "2026-11-08", "2026-11-09"].map(
    (date) => dailyContent(collection, date, picks)?.id,
  );
  expect(new Set(sequence).size).toBe(3);
  expect(dailyContent(collection, "2026-11-10", picks)?.id).toBe(
    collection.entries[0].id,
  );
});
