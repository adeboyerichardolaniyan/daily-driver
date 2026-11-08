import { weatherLocationSchema } from "./weather";
import { z } from "zod";
export const briefingSectionSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum([
    "tasks",
    "calendar",
    "text",
    "notes",
    "collection",
    "weather",
    "overview",
  ]),
  title: z.string().max(100),
  text: z.string().max(4000),
  collectionId: z.string().uuid().optional(),
});
export const briefingTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  footer: z.string().max(300),
  titleCollectionId: z.string().uuid().optional(),
  footerCollectionId: z.string().uuid().optional(),
  weather: weatherLocationSchema.optional(),
  showQr: z.boolean(),
  showDoneWhen: z.boolean(),
  sections: z
    .array(briefingSectionSchema)
    .max(12)
    .refine(
      (items) => new Set(items.map((i) => i.id)).size === items.length,
      "Section IDs must be unique",
    ),
});
export type BriefingTemplate = z.infer<typeof briefingTemplateSchema>;
export type BriefingSection = z.infer<typeof briefingSectionSchema>;
export const defaultBriefingTemplate = (): BriefingTemplate => ({
  title: "One step at a time.",
  footer: "You only need to start here.",
  showQr: true,
  showDoneWhen: true,
  sections: [
    { id: "tasks", kind: "tasks", title: "On your list today", text: "" },
    { id: "calendar", kind: "calendar", title: "On your calendar", text: "" },
    { id: "notes", kind: "notes", title: "Notes", text: "" },
  ],
});
