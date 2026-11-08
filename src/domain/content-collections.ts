import { z } from "zod";
export const collectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["quotes", "bible", "prompts", "reminders"]),
  tone: z.string().trim().min(1).max(200),
  theme: z.string().max(1000),
  translation: z.string().max(100),
});
export const contentEntrySchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
  attribution: z.string().max(300),
  source: z.string().max(1000),
  translation: z.string().max(100),
  origin: z.enum([
    "personal",
    "ai-original",
    "scripture-reflection",
    "quotation",
  ]),
  approved: z.boolean(),
});
export type ContentEntry = z.infer<typeof contentEntrySchema>;
export type ContentCollection = z.infer<typeof collectionSchema> & {
  entries: ContentEntry[];
};
export const contentRequestSchema = z.object({
  type: z.literal("content.request"),
  requestId: z.string().uuid(),
  collection: collectionSchema,
  count: z.number().int().min(1).max(30),
});
export const contentResultSchema = z.object({
  type: z.literal("content.result"),
  requestId: z.string().uuid(),
  status: z.enum(["running", "waiting", "ready", "failed"]),
  entries: z.array(contentEntrySchema).max(30),
  message: z.string().max(500),
});
export type ContentRequest = z.infer<typeof contentRequestSchema> & {
  status: "queued" | "running" | "waiting" | "ready" | "failed";
  message: string;
};
export const contentActions = [
  z.object({
    type: z.literal("content.collection"),
    collection: collectionSchema,
  }),
  z.object({
    type: z.literal("content.removeCollection"),
    collectionId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("content.entry"),
    collectionId: z.string().uuid(),
    entry: contentEntrySchema,
  }),
  z.object({
    type: z.literal("content.removeEntry"),
    collectionId: z.string().uuid(),
    entryId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("content.pick"),
    collectionId: z.string().uuid(),
    date: z.iso.date(),
    entry: contentEntrySchema,
  }),
  contentRequestSchema,
  contentResultSchema,
] as const;
// Stable shuffled order shared by every device. Each approved item appears once per cycle.
function hash(value: string) {
  let n = 2166136261;
  for (const char of value) {
    n ^= char.charCodeAt(0);
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
}
export function dailyContent(
  collection: ContentCollection,
  date: string,
  picks: Record<string, ContentEntry> = {},
): ContentEntry | null {
  const entries = collection.entries
    .filter((e) => e.approved)
    .sort(
      (a, b) =>
        hash(collection.id + a.id) - hash(collection.id + b.id) ||
        a.id.localeCompare(b.id),
    );
  if (!entries.length) return null;
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const anchor = Object.keys(picks)
    .filter(
      (key) =>
        key.startsWith(`${collection.id}:`) &&
        key.slice(collection.id.length + 1) <= date &&
        entries.some((entry) => entry.id === picks[key].id),
    )
    .sort()
    .at(-1);
  if (anchor) {
    const anchorDay = Math.floor(
      Date.parse(`${anchor.slice(collection.id.length + 1)}T00:00:00Z`) /
        86400000,
    );
    const index = entries.findIndex((entry) => entry.id === picks[anchor].id);
    return entries[(index + day - anchorDay) % entries.length];
  }
  return entries[((day % entries.length) + entries.length) % entries.length];
}
