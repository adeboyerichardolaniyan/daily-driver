import { column, Schema, Table } from "@powersync/web";
export const schema = new Schema({
  workspace_events: new Table({
    actor_id: column.text,
    clock: column.integer,
    created_at: column.text,
    payload: column.text,
  }),
  event_log: new Table(
    {
      actor_id: column.text,
      clock: column.integer,
      created_at: column.text,
      payload: column.text,
      uploaded: column.integer,
    },
    { localOnly: true, indexes: { pending: ["uploaded", "clock"] } },
  ),
  local_settings: new Table({ value: column.text }, { localOnly: true }),
});
