import { z } from "zod";

export const draftStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000),
  doneWhen: z.string().trim().min(1).max(500),
  minutes: z.number().int().min(1).max(30),
});
export const draftSchema = z.object({
  steps: z.array(draftStepSchema).min(1).max(12),
});
export const planStepSchema = draftStepSchema.extend({ id: z.string().uuid() });
export const sourceSchema = z.object({
  taskId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000),
  doneWhen: z.string().max(2000),
  context: z.string().max(10000).optional(),
  existingSteps: z.array(z.string().max(500)).max(50),
});
export const aiRequestSchema = z.object({
  type: z.literal("ai.request"),
  requestId: z.string().uuid(),
  mode: z.enum(["breakdown", "easier"]),
  source: sourceSchema,
});
export const aiActions = [
  aiRequestSchema,
  z.object({
    type: z.literal("ai.waiting"),
    requestId: z.string().uuid(),
    error: z.string().max(500),
  }),
  z.object({ type: z.literal("ai.running"), requestId: z.string().uuid() }),
  z.object({
    type: z.literal("ai.ready"),
    requestId: z.string().uuid(),
    steps: z.array(planStepSchema).min(1).max(12),
  }),
  z.object({
    type: z.literal("ai.failed"),
    requestId: z.string().uuid(),
    error: z.string().max(500),
  }),
  z.object({ type: z.literal("ai.cancel"), requestId: z.string().uuid() }),
  z.object({
    type: z.literal("ai.edit"),
    requestId: z.string().uuid(),
    stepId: z.string().uuid(),
    fields: draftStepSchema.partial(),
  }),
  z.object({
    type: z.literal("ai.add"),
    requestId: z.string().uuid(),
    step: planStepSchema,
  }),
  z.object({
    type: z.literal("ai.remove"),
    requestId: z.string().uuid(),
    stepId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("ai.approve"),
    requestId: z.string().uuid(),
    today: z.boolean(),
  }),
] as const;
export type PlanStep = z.infer<typeof planStepSchema>;
export type AISource = z.infer<typeof sourceSchema>;
export type AIRequest = z.infer<typeof aiRequestSchema>;
export type Proposal = Omit<AIRequest, "type"> & {
  status: "queued" | "running" | "ready" | "failed" | "canceled" | "approved";
  steps: PlanStep[];
  error?: string;
};
