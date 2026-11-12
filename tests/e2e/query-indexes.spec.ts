import { test, expect } from "@playwright/test";

test("SQLite uses indexes for pending uploads, replay ordering, and the next clock", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New task", exact: true }).waitFor();
  const plans = await page.evaluate(async () => {
    const modulePath = "/src/data/database.ts";
    const { db } = await import(modulePath);
    return Promise.all(
      [
        "SELECT id, actor_id, clock, created_at, payload FROM event_log WHERE uploaded = 0 ORDER BY clock, actor_id LIMIT 20",
        "SELECT * FROM event_log ORDER BY clock, actor_id",
        "SELECT COALESCE(MAX(clock), 0) AS clock FROM event_log",
        "SELECT COUNT(*) AS pending FROM event_log WHERE uploaded = 0",
      ].map((sql) => db.getAll("EXPLAIN QUERY PLAN " + sql)),
    );
  });
  for (const rows of plans) {
    const plan = rows.map((row: { detail: string }) => row.detail).join("\n");
    expect(plan).toMatch(/USING (COVERING )?INDEX/i);
    expect(plan).not.toContain("TEMP B-TREE");
  }
});
