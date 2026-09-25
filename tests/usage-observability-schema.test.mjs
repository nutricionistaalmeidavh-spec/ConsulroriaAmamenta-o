import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('cloudflare/migrations/0008-usage-observability.sql', 'utf8');
const runtime = readFileSync('cloudflare/runtime-schema.sql', 'utf8');

for (const [name, source] of [['migration', migration], ['runtime schema', runtime]]) {
  test(`usage schema is present in ${name}`, () => {
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_presence/i);
    assert.match(source, /last_heartbeat_id TEXT/i);
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_sessions/i);
    assert.match(source, /duration_seconds INTEGER NOT NULL DEFAULT 0/i);
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_usage_daily/i);
    assert.match(source, /PRIMARY KEY\s*\(user_id,\s*usage_date\)/i);
  });
}

for (const index of [
  'user_presence_last_seen_idx',
  'user_sessions_user_started_idx',
  'user_sessions_started_idx',
  'user_usage_daily_date_idx',
  'auth_users_created_at_observability_idx',
  'auth_users_last_sign_in_observability_idx',
  'billing_checkout_observability_idx',
  'subscriptions_observability_idx',
]) {
  test(`runtime schema declares ${index}`, () => assert.match(runtime, new RegExp(index)));
}
