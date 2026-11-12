"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { projectWorkspace, type WorkspaceEvent } from "../src/domain/workspace";
import type { PaginationResult } from "convex/server";

// The event log remains append-only. Each page is its own transaction, so full
// replay never needs an oversized query and never drops old tasks or approvals.
export const read = internalAction({
  args: { owner: v.id("users") },
  returns: v.object({ sequence: v.number(), state: v.string() }),
  handler: async (
    ctx,
    { owner },
  ): Promise<{ sequence: number; state: string }> => {
    const sequence: number = await ctx.runQuery(
      internal.workspaceHistory.revision,
      { owner },
    );
    const events: WorkspaceEvent[] = [];
    let cursor: string | null = null;
    while (true) {
      const page: PaginationResult<WorkspaceEvent> = await ctx.runQuery(
        internal.workspaceHistory.page,
        {
          owner,
          sequence,
          paginationOpts: { cursor, numItems: 100, maximumBytesRead: 500_000 },
        },
      );
      events.push(...page.page);
      if (page.isDone) {
        const state = projectWorkspace(events);
        // Return the projection, not another oversized copy of its history.
        state.events = [];
        return { sequence, state: JSON.stringify(state) };
      }
      if (cursor === page.continueCursor)
        throw new Error("Workspace history could not advance. Please retry.");
      cursor = page.continueCursor;
    }
  },
});
