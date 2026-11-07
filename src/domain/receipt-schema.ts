import { z } from "zod";
export const receiptSchema = z.object({
  version: z.literal(1),
  title: z.string().max(200),
  date: z.string().max(100),
  tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(500),
        minutes: z.number().min(1).max(480),
        doneWhen: z.string().max(2000),
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
    .min(1)
    .max(100),
});
export type ReceiptSnapshot = z.infer<typeof receiptSchema>;
