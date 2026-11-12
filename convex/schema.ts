import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  ...authTables,
  app_members: defineTable({ user_id: v.id("users") }).index("by_user", [
    "user_id",
  ]),
  workspace_events: defineTable({
    uuid: v.string(),
    owner_id: v.id("users"),
    actor_id: v.string(),
    clock: v.number(),
    created_at: v.string(),
    payload: v.string(),
    sequence: v.optional(v.number()),
  })
    .index("by_uuid", ["uuid"])
    .index("by_owner", ["owner_id"])
    .index("by_owner_id_and_clock", ["owner_id", "clock"])
    .index("by_owner_sequence", ["owner_id", "sequence"]),
  workspace_heads: defineTable({
    owner_id: v.id("users"),
    sequence: v.number(),
  }).index("by_owner", ["owner_id"]),
  ai_jobs: defineTable({
    request_id: v.string(),
    owner_id: v.id("users"),
    request: v.string(),
    attempt: v.optional(v.number()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting"),
      v.literal("finished"),
      v.literal("canceled"),
    ),
  })
    .index("by_request_id", ["request_id"])
    .index("by_status", ["status"]),
  content_jobs: defineTable({
    request_id: v.string(),
    owner_id: v.id("users"),
    request: v.string(),
    attempt: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting"),
      v.literal("finished"),
    ),
  })
    .index("by_request_id", ["request_id"])
    .index("by_status", ["status"]),
  calendar_sources: defineTable({
    owner_id: v.id("users"),
    name: v.string(),
    url: v.string(),
    snapshot: v.string(),
    nextRefresh: v.number(),
    version: v.number(),
  })
    .index("by_owner", ["owner_id"])
    .index("by_refresh", ["nextRefresh"]),
  planning_preferences: defineTable({
    owner_id: v.id("users"),
    settings: v.string(),
  }).index("by_owner", ["owner_id"]),
  planning_jobs: defineTable({
    owner_id: v.id("users"),
    plan_id: v.string(),
    date: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting"),
      v.literal("finished"),
    ),
    basis: v.string(),
    attempt: v.number(),
  })
    .index("by_plan", ["plan_id"])
    .index("by_status", ["status"])
    .index("by_owner_date", ["owner_id", "date"]),
  briefing_schedules: defineTable({
    owner_id: v.id("users"),
    timeZone: v.optional(v.string()),
    settings: v.string(),
    version: v.number(),
    nextRun: v.number(),
    lastDay: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_owner", ["owner_id"])
    .index("by_nextRun", ["nextRun"]),
  briefing_runs: defineTable({
    owner_id: v.id("users"),
    day: v.string(),
    job_id: v.string(),
  }).index("by_owner_day", ["owner_id", "day"]),
  print_jobs: defineTable({
    deleted: v.optional(v.boolean()),
    retry_id: v.optional(v.string()),
    output: v.optional(v.union(v.literal("pdf"), v.literal("printer"))),
    uuid: v.string(),
    owner_id: v.id("users"),
    snapshot: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("dispatched"),
      v.literal("rendered"),
      v.literal("failed"),
      v.literal("uncertain"),
    ),
    created_at: v.string(),
    worker_id: v.optional(v.string()),
    error: v.union(v.string(), v.null()),
  })
    .index("by_uuid", ["uuid"])
    .index("by_owner", ["owner_id"])
    .index("by_owner_and_deleted", ["owner_id", "deleted"])
    .index("by_status", ["status"])
    .index("by_worker_status", ["worker_id", "status"])
    .index("by_status_output", ["status", "output"])
    .index("by_owner_id_and_worker_id_and_status", [
      "owner_id",
      "worker_id",
      "status",
    ])
    .index("by_owner_id_and_status_and_output", [
      "owner_id",
      "status",
      "output",
    ]),
  // Retained for compatibility with the previous deployment; no longer used.
  powersync_checkpoints: defineTable({ last_updated: v.float64() }),
});
