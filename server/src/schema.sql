-- Mileage Tracker schema. Safe to run repeatedly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One shared counter for every synced row change; devices pull "everything after N".
CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  vehicle       TEXT NOT NULL DEFAULT '',   -- e.g. "Ford Focus AB12 CDE"
  token_version INTEGER NOT NULL DEFAULT 0, -- bump to invalidate all sessions
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user pence-per-mile rate periods. end_date NULL = still current.
-- Added after the first release; safe on existing databases.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS rate_periods (
  id             UUID PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT NOT NULL DEFAULT '',
  pence_per_mile NUMERIC(8,2) NOT NULL CHECK (pence_per_mile >= 0),
  start_date     DATE NOT NULL,
  end_date       DATE,
  deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  client_updated_at TIMESTAMPTZ NOT NULL,      -- last edit time on the device (conflict resolution)
  server_seq     BIGINT NOT NULL DEFAULT nextval('sync_seq'), -- drives incremental pulls
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS rate_periods_user_seq ON rate_periods(user_id, server_seq);

-- Daily mileage entries.
CREATE TABLE IF NOT EXISTS trips (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_date     DATE NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  start_odometer NUMERIC(10,1),
  end_odometer   NUMERIC(10,1),
  miles         NUMERIC(10,1) NOT NULL CHECK (miles >= 0),
  rate_override_pence NUMERIC(8,2),   -- optional custom rate for just this entry
  deleted       BOOLEAN NOT NULL DEFAULT FALSE,
  client_updated_at TIMESTAMPTZ NOT NULL,
  server_seq    BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS trips_user_seq ON trips(user_id, server_seq);
CREATE INDEX IF NOT EXISTS trips_user_date ON trips(user_id, trip_date);

-- Fuel bought for the vehicle, so the money paid out can be compared with the mileage claimed.
CREATE TABLE IF NOT EXISTS fuel_purchases (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_date DATE NOT NULL,
  amount_pence  INTEGER NOT NULL CHECK (amount_pence >= 0),
  litres        NUMERIC(8,2),
  odometer      NUMERIC(10,1),
  description   TEXT NOT NULL DEFAULT '',            -- e.g. "Tesco Extra, Cardiff"
  receipt_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ids of rows in receipt_files
  deleted       BOOLEAN NOT NULL DEFAULT FALSE,
  client_updated_at TIMESTAMPTZ NOT NULL,
  server_seq    BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS fuel_user_seq ON fuel_purchases(user_id, server_seq);

-- Receipt photos and PDFs. Kept in the database so they're included in every backup.
CREATE TABLE IF NOT EXISTS receipt_files (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backups (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  target      TEXT NOT NULL,          -- 'local' or 's3'
  location    TEXT NOT NULL,          -- path or s3://bucket/key
  size_bytes  BIGINT,
  status      TEXT NOT NULL,          -- 'ok' | 'failed'
  error       TEXT,
  created_by  TEXT,                   -- username or 'schedule'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-wide settings. 'data_epoch' changes after a restore so devices know to re-download everything.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('data_epoch', gen_random_uuid()::text) ON CONFLICT (key) DO NOTHING;
