PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0,
  shadow_banned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(tg_id) ON DELETE CASCADE,
  ton_address TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  proof_json TEXT
);

CREATE TABLE IF NOT EXISTS game_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(tg_id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  energy INTEGER NOT NULL DEFAULT 20,
  max_energy INTEGER NOT NULL DEFAULT 20,
  tap_power INTEGER NOT NULL DEFAULT 1,
  energy_updated_at INTEGER NOT NULL,
  last_tap_at INTEGER NOT NULL DEFAULT 0,
  tap_window_start INTEGER NOT NULL DEFAULT 0,
  tap_window_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  delta_coins INTEGER NOT NULL,
  delta_energy INTEGER NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, endpoint, idem_key)
);

CREATE TABLE IF NOT EXISTS abuse_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_user_created ON abuse_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS reward_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  budget_nano INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL REFERENCES reward_periods(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  amount_nano INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reward_claims_period ON reward_claims(period_id, status);

