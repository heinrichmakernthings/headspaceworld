-- Headspace database (Cloudflare D1)
-- Everything you create in the app (tasks, notes, board cards, projects, habits, journal, settings)
CREATE TABLE IF NOT EXISTS items (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS items_updated ON items (updated_at);

-- Apple Health numbers sent by Health Auto Export
CREATE TABLE IF NOT EXISTS health_points (
  metric TEXT NOT NULL,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT,
  PRIMARY KEY (metric, ts)
);
CREATE INDEX IF NOT EXISTS health_day ON health_points (day);

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  name TEXT,
  start TEXT,
  day TEXT,
  minutes REAL,
  energy REAL
);
CREATE INDEX IF NOT EXISTS workouts_day ON workouts (day);

-- Small settings and tokens (Google refresh token, last health sync time)
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
