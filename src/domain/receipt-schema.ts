import { weatherSnapshotSchema } from "./weather";
import { briefingTemplateSchema } from "./briefing";
import { z } from "zod";
export const receiptSchema = z.object({
  version: z.literal(1),
  weather: weatherSnapshotSchema.extend({ stale: z.boolean() }).optional(),
  overview: z
    .array(z.object({ label: z.string().max(100), value: z.string().max(300) }))
    .max(10)
    .optional(),
  title: z.string().max(2000),
  titleAttribution: z.string().max(500).optional(),
  closingLine: z.string().max(2000).optional(),
  closingAttribution: z.string().max(500).optional(),
  date: z.string().max(100),
  day: z.iso.date().optional(),
  timeZone: z.string().max(100).optional(),
  template: briefingTemplateSchema.optional(),
  briefingUrl: z
    .string()
    .url()
    .refine(
      (url) =>
        new URL(url).protocol === "https:" &&
        !new URL(url).username &&
        !new URL(url).password,
    )
    .optional(),
  content: z
    .array(
      z.object({
        sectionId: z.string(),
        text: z.string().max(2000),
        attribution: z.string().max(500),
      }),
    )
    .max(12)
    .optional(),
  events: z
    .array(z.object({ title: z.string().max(500), time: z.string().max(100) }))
    .max(2000)
    .optional(),
  tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(500),
        minutes: z.number().min(1).max(480),
        doneWhen: z.string().max(2000),
        context: z.string().max(500).optional(),
        scheduledTime: z.string().max(100).optional(),
        url: z
          .string()
          .url()
          .refine(
            (url) =>
              new URL(url).protocol === "https:" &&
              !new URL(url).username &&
              !new URL(url).password,
            "Task links require HTTPS",
          ),
      }),
    )
    .max(100),
});
export type ReceiptSnapshot = z.infer<typeof receiptSchema>;
