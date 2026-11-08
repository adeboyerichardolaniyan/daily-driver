import { describe, it, expect } from "vitest";
import { createReceipt, renderReceipt } from "../src/domain/receipt";
import { taskDefaults } from "../src/domain/workspace";
const task = {
  id: "00000000-0000-4000-8000-000000000001",
  ...taskDefaults('<script>alert("x")</script>'),
};
describe("receipt snapshot", () => {
  it("uses stable credential-free URLs and excludes completed work", () => {
    const snapshot = createReceipt(
      [
        task,
        {
          ...task,
          id: "00000000-0000-4000-8000-000000000002",
          completed: true,
        },
      ],
      "https://daily.example/?token=secret",
    );
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].url).toBe(
      `https://daily.example/?task=${task.id}`,
    );
  });
  it("rejects non-phone-accessible origins", () => {
    expect(() => createReceipt([task], "http://localhost:1420")).toThrow();
  });
  it("escapes supplied text and embeds a QR image rather than external resources", async () => {
    const html = await renderReceipt(
      createReceipt([task], "https://daily.example"),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("data:image/png;base64,");
  });
});

import { createBriefing } from "../src/domain/receipt";
import { defaultBriefingTemplate } from "../src/domain/briefing";
import { projectWorkspace } from "../src/domain/workspace";
it("renders ordered template sections, escapes custom text, and can hide task QR codes", async () => {
  const workspace = projectWorkspace([]);
  workspace.tasks = [task];
  const template = defaultBriefingTemplate();
  template.showQr = false;
  template.sections = [
    {
      id: "custom",
      kind: "text",
      title: "First section",
      text: "<img src=x onerror=alert(1)>",
    },
    { id: "tasks", kind: "tasks", title: "Second section", text: "" },
  ];
  const snapshot = createBriefing(workspace, template, "https://daily.example");
  const html = await renderReceipt(snapshot);
  expect(html.indexOf("First section")).toBeLessThan(
    html.indexOf("Second section"),
  );
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(snapshot.tasks).toHaveLength(1);
});
it("supports calendar-only briefings and persists templates through workspace replay", async () => {
  const template = defaultBriefingTemplate();
  template.sections = [
    { id: "calendar", kind: "calendar", title: "Appointments", text: "" },
  ];
  const workspace = projectWorkspace([
    {
      id: crypto.randomUUID(),
      actor_id: "local",
      clock: 1,
      created_at: new Date().toISOString(),
      payload: JSON.stringify({ type: "briefing.template", template }),
    },
  ]);
  expect(workspace.briefingTemplate).toEqual(template);
  workspace.calendars = [
    {
      id: "personal",
      name: "Personal",
      events: [
        {
          id: "event",
          title: "Design review",
          start: Date.now(),
          end: Date.now() + 60000,
          allDay: false,
          busy: true,
        },
      ],
      refreshedAt: Date.now(),
      error: null,
      rangeStart: 0,
      rangeEnd: Date.now() + 86400000,
    },
  ];
  const snapshot = createBriefing(workspace, template, "https://daily.example");
  expect(snapshot.tasks).toEqual([]);
  expect(await renderReceipt(snapshot)).toContain("Design review");
});
it("captures timezone-aware task context and calendar ranges in the editorial receipt", async () => {
  const workspace = projectWorkspace([]);
  workspace.planningSettings.timeZone = "America/New_York";
  const parent = {
    id: crypto.randomUUID(),
    ...taskDefaults("Portfolio", { kind: "project" }),
  };
  workspace.tasks = [
    parent,
    {
      ...task,
      parentId: parent.id,
      scheduledDate: "2026-11-07",
      plannedStart: Date.parse("2026-11-07T14:00:00Z"),
    },
  ];
  workspace.calendars = [
    {
      id: "work",
      name: "Work",
      refreshedAt: 0,
      error: null,
      rangeStart: 0,
      rangeEnd: Date.now() + 86400000,
      events: [
        {
          id: "call",
          title: "Feedback",
          start: Date.parse("2026-11-07T16:00:00Z"),
          end: Date.parse("2026-11-07T16:30:00Z"),
          busy: true,
          allDay: false,
        },
      ],
    },
  ];
  const snapshot = createBriefing(
    workspace,
    defaultBriefingTemplate(),
    "https://daily.example",
    Date.parse("2026-11-07T12:00:00Z"),
  );
  expect(snapshot.tasks[0]).toMatchObject({
    context: "Portfolio",
    scheduledTime: "9:00 AM",
  });
  expect(snapshot.events?.[0].time).toBe("11:00 AM–11:30 AM");
  const html = await renderReceipt(snapshot);
  expect(html).toContain("No. 311");
  expect(html).toContain('class="notes-grid"');
  expect(html).toContain('class="day-summary"');
  expect(html.match(/<img /g)).toHaveLength(1);
});
it("resolves heading and closing collections, preserves attribution, and falls back safely", async () => {
  const workspace = projectWorkspace([]),
    id = crypto.randomUUID();
  workspace.contentCollections = [
    {
      id,
      name: "Greetings",
      kind: "quotes",
      tone: "Gentle",
      theme: "",
      translation: "",
      entries: [
        {
          id: crypto.randomUUID(),
          text: "A fresh start, one small step.",
          attribution: "AI-written original",
          source: "",
          translation: "",
          origin: "ai-original",
          approved: true,
        },
      ],
    },
  ];
  const template = {
    ...defaultBriefingTemplate(),
    titleCollectionId: id,
    footerCollectionId: id,
  };
  const snapshot = createBriefing(workspace, template, "https://daily.example");
  expect(snapshot.title).toBe("A fresh start, one small step.");
  expect(snapshot.closingLine).toBe(snapshot.title);
  expect(snapshot.titleAttribution).toBe("AI-written original");
  const html = await renderReceipt(snapshot);
  expect(html).toContain("<h1>A fresh start, one small step.</h1>");
  expect(html).toContain("<footer><p>A fresh start, one small step.</p>");
  workspace.contentCollections = [];
  const fallback = createBriefing(workspace, template, "https://daily.example");
  expect(fallback.title).toBe(template.title);
  expect(fallback.closingLine).toBe(template.footer);
  expect(fallback.titleAttribution).toBe("");
});
