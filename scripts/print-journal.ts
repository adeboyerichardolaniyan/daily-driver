import type { DatabaseSync } from "node:sqlite";

export function initializePrintJournal(journal: DatabaseSync) {
  journal.exec(
    "CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, reported INTEGER NOT NULL DEFAULT 0)",
  );
  journal.exec(
    "CREATE INDEX IF NOT EXISTS attempts_by_reported ON attempts(reported)",
  );
  journal.exec(
    "CREATE INDEX IF NOT EXISTS attempts_by_status ON attempts(status)",
  );
}
