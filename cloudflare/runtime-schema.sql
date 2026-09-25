PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS supabase_records_owner_record_idx
  ON supabase_records(table_name, owner_id, record_key);
CREATE INDEX IF NOT EXISTS supabase_records_owner_json_id_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_mother_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.mother_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_baby_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.baby_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_appointment_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.appointment_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_encounter_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.encounter_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_package_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.package_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_request_key_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.request_key'));

CREATE TABLE IF NOT EXISTS clinical_idempotency_keys (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE(owner_id, operation, idempotency_key),
  FOREIGN KEY (owner_id) REFERENCES auth_users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS clinical_idempotency_expiry_idx
  ON clinical_idempotency_keys(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id TEXT PRIMARY KEY,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_refresh_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_refresh_sessions_user_idx ON auth_refresh_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS runtime_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_pending_signups (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('pro_monthly','pro_annual')),
  signup_nonce_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','activated','cancelled','expired')),
  payment_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT
);
CREATE INDEX IF NOT EXISTS billing_pending_signups_status_idx ON billing_pending_signups(status,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_plan_catalog (
  plan_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month','year','one_time')),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  installment_max INTEGER NOT NULL DEFAULT 1 CHECK (installment_max >= 1),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO billing_plan_catalog(plan_code,display_name,billing_interval,price_cents,currency,installment_max,active)
VALUES
  ('pro_monthly','Plano Pro mensal','month',9990,'BRL',1,1),
  ('pro_annual','Plano Pro anual','year',99990,'BRL',12,1)
ON CONFLICT(plan_code) DO UPDATE SET
  display_name=excluded.display_name,
  billing_interval=excluded.billing_interval,
  price_cents=excluded.price_cents,
  currency=excluded.currency,
  installment_max=excluded.installment_max,
  active=excluded.active,
  updated_at=CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL COLLATE NOCASE,
  partner_type TEXT NOT NULL DEFAULT 'partner' CHECK (partner_type IN ('partner','influencer','campaign')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  commission_type TEXT NOT NULL DEFAULT 'none' CHECK (commission_type IN ('none','percent','fixed')),
  commission_value REAL NOT NULL DEFAULT 0 CHECK (commission_value >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','fixed')),
  discount_value REAL NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(trim(name)) BETWEEN 2 AND 160),
  CHECK (length(trim(code)) BETWEEN 2 AND 64),
  CHECK (commission_type <> 'percent' OR commission_value <= 100),
  CHECK (discount_type <> 'percent' OR discount_value <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS partners_code_unique ON partners(upper(trim(code)));
CREATE INDEX IF NOT EXISTS partners_active_idx ON partners(active,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_checkout_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  plan_code TEXT NOT NULL REFERENCES billing_plan_catalog(plan_code),
  provider TEXT NOT NULL CHECK (provider IN ('asaas','asaas_sandbox')),
  status TEXT NOT NULL DEFAULT 'pending_provider'
    CHECK (status IN ('pending_provider','checkout_created','paid','past_due','cancelled','failed','expired')),
  external_checkout_id TEXT,
  checkout_url TEXT,
  request_secret_hash TEXT,
  partner_id TEXT REFERENCES partners(id) ON DELETE SET NULL,
  partner_code_snapshot TEXT,
  attribution_source TEXT CHECK (attribution_source IS NULL OR attribution_source IN ('manual_code','ref_link')),
  subtotal_cents INTEGER,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (subtotal_cents IS NULL OR subtotal_cents > 0),
  CHECK (discount_cents >= 0),
  CHECK (total_cents IS NULL OR total_cents > 0),
  CHECK (commission_cents >= 0)
);
CREATE INDEX IF NOT EXISTS billing_checkout_owner_idx ON billing_checkout_requests(owner_id,provider,created_at DESC);
CREATE INDEX IF NOT EXISTS billing_checkout_external_idx ON billing_checkout_requests(provider,external_checkout_id);
CREATE INDEX IF NOT EXISTS billing_checkout_partner_idx ON billing_checkout_requests(partner_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_active_owner_unique
  ON billing_checkout_requests(owner_id,provider)
  WHERE status IN ('pending_provider','checkout_created');

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('asaas','asaas_sandbox')),
  external_customer_id TEXT,
  external_subscription_id TEXT,
  origin_checkout_request_id TEXT REFERENCES billing_checkout_requests(id) ON DELETE SET NULL,
  plan_code TEXT NOT NULL REFERENCES billing_plan_catalog(plan_code),
  status TEXT NOT NULL CHECK (status IN ('active','trialing','past_due','cancelled','expired')),
  current_period_end TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id,provider)
);
CREATE INDEX IF NOT EXISTS subscriptions_external_idx ON subscriptions(provider,external_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('asaas','asaas_sandbox')),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed')),
  payment_id TEXT,
  checkout_request_id TEXT REFERENCES billing_checkout_requests(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE(provider,external_event_id)
);
CREATE INDEX IF NOT EXISTS billing_webhook_payment_idx ON billing_webhook_events(provider,payment_id);

CREATE TABLE IF NOT EXISTS partner_attributions (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  checkout_request_id TEXT NOT NULL UNIQUE REFERENCES billing_checkout_requests(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  plan_code TEXT NOT NULL REFERENCES billing_plan_catalog(plan_code),
  partner_code_snapshot TEXT NOT NULL,
  attribution_source TEXT NOT NULL DEFAULT 'manual_code' CHECK (attribution_source IN ('manual_code','ref_link')),
  commission_type_snapshot TEXT NOT NULL DEFAULT 'none' CHECK (commission_type_snapshot IN ('none','percent','fixed')),
  commission_value_snapshot REAL NOT NULL DEFAULT 0,
  discount_type_snapshot TEXT NOT NULL DEFAULT 'none' CHECK (discount_type_snapshot IN ('none','percent','fixed')),
  discount_value_snapshot REAL NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents > 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  commission_cents INTEGER NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','checkout_created','paid','cancelled','refunded','chargeback')),
  commission_status TEXT NOT NULL DEFAULT 'none' CHECK (commission_status IN ('none','pending','approved','cancelled','reversed')),
  provider_status TEXT,
  paid_at TEXT,
  commission_approved_at TEXT,
  commission_approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS partner_attributions_partner_idx ON partner_attributions(partner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS partner_attributions_owner_idx ON partner_attributions(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS partner_attributions_commission_idx ON partner_attributions(commission_status,created_at DESC);

-- Preserve historical commercial billing copied during the Supabase -> D1 migration.
INSERT OR IGNORE INTO billing_plan_catalog(plan_code,display_name,billing_interval,price_cents,currency,installment_max,active,created_at,updated_at)
SELECT
  json_extract(record_json,'$.plan_code'),
  COALESCE(json_extract(record_json,'$.display_name'),json_extract(record_json,'$.plan_code')),
  CASE COALESCE(json_extract(record_json,'$.billing_interval'),'month')
    WHEN 'annual' THEN 'year' WHEN 'year' THEN 'year' WHEN 'one_time' THEN 'one_time' ELSE 'month' END,
  CAST(COALESCE(json_extract(record_json,'$.price_cents'),1) AS INTEGER),
  COALESCE(json_extract(record_json,'$.currency'),'BRL'),
  CAST(COALESCE(json_extract(record_json,'$.installment_max'),1) AS INTEGER),
  CASE WHEN COALESCE(json_extract(record_json,'$.active'),1) IN (1,'true',true) THEN 1 ELSE 0 END,
  COALESCE(json_extract(record_json,'$.created_at'),CURRENT_TIMESTAMP),
  COALESCE(json_extract(record_json,'$.updated_at'),CURRENT_TIMESTAMP)
FROM supabase_records
WHERE table_name='billing_plan_catalog' AND json_extract(record_json,'$.plan_code') IS NOT NULL;

INSERT OR IGNORE INTO billing_checkout_requests(
  id,owner_id,plan_code,provider,status,external_checkout_id,checkout_url,metadata_json,created_at,updated_at
)
SELECT
  json_extract(record_json,'$.id'),
  json_extract(record_json,'$.owner_id'),
  json_extract(record_json,'$.plan_code'),
  CASE WHEN json_extract(record_json,'$.provider')='asaas_sandbox' THEN 'asaas_sandbox' ELSE 'asaas' END,
  CASE WHEN json_extract(record_json,'$.status') IN ('pending_provider','checkout_created','paid','past_due','cancelled','failed','expired')
    THEN json_extract(record_json,'$.status') ELSE 'failed' END,
  json_extract(record_json,'$.external_checkout_id'),
  json_extract(record_json,'$.checkout_url'),
  COALESCE(json_extract(record_json,'$.metadata'),'{}'),
  COALESCE(json_extract(record_json,'$.created_at'),CURRENT_TIMESTAMP),
  COALESCE(json_extract(record_json,'$.updated_at'),CURRENT_TIMESTAMP)
FROM supabase_records
WHERE table_name='billing_checkout_requests'
  AND json_extract(record_json,'$.id') IS NOT NULL
  AND json_extract(record_json,'$.owner_id') IS NOT NULL
  AND json_extract(record_json,'$.plan_code') IN ('pro_monthly','pro_annual');

INSERT OR IGNORE INTO subscriptions(
  id,owner_id,provider,external_customer_id,external_subscription_id,origin_checkout_request_id,plan_code,status,current_period_end,metadata_json,created_at,updated_at
)
SELECT
  COALESCE(json_extract(record_json,'$.id'),json_extract(record_json,'$.owner_id') || ':' || COALESCE(json_extract(record_json,'$.provider'),'asaas')),
  json_extract(record_json,'$.owner_id'),
  CASE WHEN json_extract(record_json,'$.provider')='asaas_sandbox' THEN 'asaas_sandbox' ELSE 'asaas' END,
  json_extract(record_json,'$.external_customer_id'),
  json_extract(record_json,'$.external_subscription_id'),
  NULL,
  json_extract(record_json,'$.plan_code'),
  CASE WHEN json_extract(record_json,'$.status') IN ('active','trialing','past_due','cancelled','expired')
    THEN json_extract(record_json,'$.status') ELSE 'cancelled' END,
  json_extract(record_json,'$.current_period_end'),
  COALESCE(json_extract(record_json,'$.metadata'),'{}'),
  COALESCE(json_extract(record_json,'$.created_at'),CURRENT_TIMESTAMP),
  COALESCE(json_extract(record_json,'$.updated_at'),CURRENT_TIMESTAMP)
FROM supabase_records
WHERE table_name='subscriptions'
  AND json_extract(record_json,'$.owner_id') IS NOT NULL
  AND json_extract(record_json,'$.plan_code') IN ('pro_monthly','pro_annual');

INSERT INTO runtime_state(state_key,state_value,updated_at)
VALUES ('clinical_backend','cloudflare-d1-r2',CURRENT_TIMESTAMP)
ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_state(state_key,state_value,updated_at)
VALUES ('billing_backend','cloudflare-d1',CURRENT_TIMESTAMP)
ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP;
-- Additive only. Apply separately after review; never re-run a data import.
CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(user_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_session_id TEXT,
  last_heartbeat_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_usage_daily (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx
  ON user_presence(last_seen_at DESC, user_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_started_idx
  ON user_sessions(user_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_sessions_started_idx
  ON user_sessions(started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_usage_daily_date_idx
  ON user_usage_daily(usage_date DESC, user_id);
CREATE INDEX IF NOT EXISTS auth_users_created_at_observability_idx
  ON auth_users(created_at DESC, user_id);
CREATE INDEX IF NOT EXISTS auth_users_last_sign_in_observability_idx
  ON auth_users(last_sign_in_at DESC, user_id);
CREATE INDEX IF NOT EXISTS billing_checkout_observability_idx
  ON billing_checkout_requests(provider, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS subscriptions_observability_idx
  ON subscriptions(provider, status, plan_code, updated_at DESC, owner_id);
