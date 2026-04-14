-- D1 schema for Mia analytics. Run via `wrangler d1 migrations apply`.

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  inbound TEXT NOT NULL,
  outbound TEXT NOT NULL,
  link_sent INTEGER NOT NULL DEFAULT 0,
  violations TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS turns_contact_idx ON turns (contact_id);
CREATE INDEX IF NOT EXISTS turns_at_idx ON turns (at);

CREATE TABLE IF NOT EXISTS evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  case_name TEXT NOT NULL,
  passed INTEGER NOT NULL,
  reason TEXT,
  draft TEXT,
  at TEXT NOT NULL
);
