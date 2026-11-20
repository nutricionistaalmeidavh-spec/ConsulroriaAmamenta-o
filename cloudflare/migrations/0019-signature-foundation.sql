-- Signature foundation: additive only; does not change consents or clinical_documents.
-- Deploy with existing D1 migrations before enabling a signature workflow.
CREATE TABLE IF NOT EXISTS signature_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  mother_id TEXT NOT NULL,
  consent_type TEXT NOT NULL CHECK(consent_type IN ('data_processing','whatsapp','clinical_media','public_media','teleconsultation')),
  document_title TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  source_consent_id TEXT,
  source_sha256 TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','delivery_failed','signing_mother','mother_signed','signing_consultant','expired','cancelled','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  sent_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS signature_requests_owner_mother_idx ON signature_requests(owner_id,mother_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS signature_requests_unique_open_idx
  ON signature_requests(owner_id,mother_id,consent_type)
  WHERE status IN ('draft','sending','sent','delivery_failed');

CREATE TABLE IF NOT EXISTS signature_participants (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id),
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('mother','consultant')),
  sign_order INTEGER NOT NULL CHECK(sign_order IN (1,2)),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signed','declined','cancelled')),
  signed_at TEXT,
  UNIQUE(request_id,role)
);
CREATE INDEX IF NOT EXISTS signature_participants_owner_idx ON signature_participants(owner_id,request_id);

CREATE TABLE IF NOT EXISTS signature_documents (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id),
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  frozen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,version)
);
CREATE TABLE IF NOT EXISTS signature_tokens (
  request_id TEXT PRIMARY KEY REFERENCES signature_requests(id),
  owner_id TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS signature_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id),
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('consultant','mother','system')),
  event_at TEXT NOT NULL,
  event_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS signature_events_request_idx ON signature_events(request_id,event_at);
CREATE TABLE IF NOT EXISTS signature_evidence (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES signature_requests(id),
  participant_id TEXT REFERENCES signature_participants(id),
  owner_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  r2_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signature_evidence_request_idx ON signature_evidence(request_id);
