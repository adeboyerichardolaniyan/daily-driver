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
    .index("by_owner_sequence", ["owner_id", "sequence"]),
  workspace_heads: defineTable({
    owner_id: v.id("users"),
    sequence: v.number(),
  }).index("by_owner", ["owner_id"]),
  print_jobs: defineTable({
    uuid: v.string(),
    owner_id: v.id("users"),
    snapshot: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("dispatched"),
      v.literal("failed"),
      v.literal("uncertain"),
    ),
    created_at: v.string(),
    worker_id: v.optional(v.string()),
    error: v.union(v.string(), v.null()),
  })
    .index("by_uuid", ["uuid"])
    .index("by_owner", ["owner_id"])
    .index("by_status", ["status"])
    .index("by_worker_status", ["worker_id", "status"]),
  // Retained for compatibility with the previous deployment; no longer used.
  powersync_checkpoints: defineTable({ last_updated: v.float64() }),
});
