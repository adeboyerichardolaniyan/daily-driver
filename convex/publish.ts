import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actionSchema, type Action } from "../src/domain/workspace";
export async function publish(
  ctx: MutationCtx,
  owner: Id<"users">,
  action: Action,
) {
  actionSchema.parse(action);
  const last = await ctx.db
    .query("workspace_events")
    .withIndex("by_owner_id_and_clock", (q) => q.eq("owner_id", owner))
    .order("desc")
    .first();
  const head = await ctx.db
    .query("workspace_heads")
    .withIndex("by_owner", (q) => q.eq("owner_id", owner))
    .unique();
  const sequence = (head?.sequence ?? 0) + 1;
  await ctx.db.insert("workspace_events", {
    uuid: crypto.randomUUID(),
    owner_id: owner,
    actor_id: "planning-server",
    clock: (last?.clock ?? 0) + 1,
    created_at: new Date().toISOString(),
    payload: JSON.stringify(action),
    sequence,
  });
  if (head) await ctx.db.patch(head._id, { sequence });
  else await ctx.db.insert("workspace_heads", { owner_id: owner, sequence });
}
