import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { initializePrintJournal } from "../scripts/print-journal";

it("upgrades an existing worker journal without losing attempts and indexes recovery queries", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE attempts (id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, reported INTEGER NOT NULL DEFAULT 0)",
    );
    db.exec(
      "INSERT INTO attempts VALUES ('existing', 'dispatched', 'Printed', 1)",
    );
    initializePrintJournal(db);
    initializePrintJournal(db);
    expect(
      db.prepare("SELECT * FROM attempts WHERE id = 'existing'").get(),
    ).toMatchObject({ status: "dispatched", reported: 1 });
    for (const query of [
      "SELECT id, status, detail FROM attempts WHERE reported = 0 LIMIT 100",
      "UPDATE attempts SET status = 'uncertain' WHERE status = 'processing'",
    ]) {
      const rows = db.prepare("EXPLAIN QUERY PLAN " + query).all();
      expect(rows.map((row) => row.detail).join(" ")).toMatch(
        /USING (COVERING )?INDEX/,
      );
    }
  } finally {
    db.close();
  }
});
