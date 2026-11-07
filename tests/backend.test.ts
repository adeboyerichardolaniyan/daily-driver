import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const owner = "00000000-0000-4000-8000-000000000010";
const outsider = "00000000-0000-4000-8000-000000000011";
const eventId = "00000000-0000-4000-8000-000000000012";
const jobId = "00000000-0000-4000-8000-000000000013";
const pg = new PGlite();
const event = {
  id: eventId,
  actor_id: "laptop",
  clock: 1,
  created_at: "2026-11-07T00:00:00Z",
  payload: '{"type":"test"}',
};
async function asUser(id: string) {
  await pg.exec("RESET ROLE");
  await pg.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await pg.exec("SET ROLE authenticated");
}
beforeAll(async () => {
  await pg.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`,
  );
  await pg.exec(
    await readFile("supabase/migrations/202611070001_foundation.sql", "utf8"),
  );
  await pg.query("INSERT INTO auth.users(id) VALUES ($1), ($2)", [
    owner,
    outsider,
  ]);
  await pg.query("INSERT INTO public.app_members(user_id) VALUES ($1)", [
    owner,
  ]);
  await asUser(owner);
}, 30000);
afterAll(async () => {
  await pg.close();
});
describe("backend event ownership and retries", () => {
  it("accepts a retry only once", async () => {
    await pg.query("SELECT public.append_workspace_events($1::jsonb)", [
      JSON.stringify([event]),
    ]);
    await pg.query("SELECT public.append_workspace_events($1::jsonb)", [
      JSON.stringify([event]),
    ]);
    expect(
      (await pg.query("SELECT * FROM public.workspace_events")).rows,
    ).toHaveLength(1);
  });
  it("rejects a changed event with the same id without overwriting history", async () => {
    await expect(
      pg.query("SELECT public.append_workspace_events($1::jsonb)", [
        JSON.stringify([{ ...event, payload: '{"changed":true}' }]),
      ]),
    ).rejects.toThrow("collision");
    expect(
      (
        await pg.query<{ payload: string }>(
          "SELECT payload FROM public.workspace_events",
        )
      ).rows[0].payload,
    ).toBe(event.payload);
  });
  it("does not let another account read events or append work", async () => {
    await asUser(outsider);
    expect(
      (await pg.query("SELECT * FROM public.workspace_events")).rows,
    ).toHaveLength(0);
    await expect(
      pg.query("SELECT public.append_workspace_events($1::jsonb)", [
        JSON.stringify([event]),
      ]),
    ).rejects.toThrow("denied");
    await asUser(owner);
  });
  it("forbids mutable updates and deletion by the app account", async () => {
    await expect(
      pg.exec("DELETE FROM public.workspace_events"),
    ).rejects.toThrow("permission denied");
    await expect(
      pg.exec("UPDATE public.workspace_events SET payload = '{}' "),
    ).rejects.toThrow("permission denied");
  });
});
describe("print queue transitions", () => {
  it("claims once and never automatically reclaims uncertain dispatch", async () => {
    await pg.query(
      "INSERT INTO public.print_jobs(id,owner_id,snapshot) VALUES ($1,$2,$3)",
      [jobId, owner, "{}"],
    );
    const claim = await pg.query<{ id: string }>(
      "SELECT * FROM public.claim_print_job('mini')",
    );
    expect(claim.rows[0].id).toBe(jobId);
    expect(
      (await pg.query("SELECT * FROM public.claim_print_job('mini')")).rows,
    ).toHaveLength(0);
    await expect(
      pg.query("SELECT public.finish_print_job($1,'other','dispatched',null)", [
        jobId,
      ]),
    ).rejects.toThrow("not assigned");
    await pg.query(
      "SELECT public.finish_print_job($1,'mini','uncertain','Connection lost')",
      [jobId],
    );
    expect(
      (await pg.query("SELECT * FROM public.claim_print_job('mini')")).rows,
    ).toHaveLength(0);
  });
  it("prevents another account from inspecting or claiming jobs", async () => {
    await asUser(outsider);
    expect(
      (await pg.query("SELECT * FROM public.print_jobs")).rows,
    ).toHaveLength(0);
    await expect(
      pg.query("SELECT * FROM public.claim_print_job('outsider')"),
    ).rejects.toThrow("denied");
    await asUser(owner);
  });
});
