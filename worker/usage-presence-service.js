const SESSION_GAP_MS = 5 * 60 * 1000;
const MAX_INCREMENT_SECONDS = 90;

function database(env) {
  if (!env?.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_usage_timestamp');
  return date.toISOString();
}

function utcDay(value) { return String(value).slice(0, 10); }

export function safeDeltaSeconds(previousIso, nowIso) {
  const delta = Math.floor((Date.parse(nowIso) - Date.parse(previousIso)) / 1000);
  if (!Number.isFinite(delta) || delta <= 0 || delta > SESSION_GAP_MS / 1000) return 0;
  return Math.min(MAX_INCREMENT_SECONDS, delta);
}

function activeSegments(previousIso, _nowIso, totalSeconds) {
  if (totalSeconds <= 0) return [];
  const out = [];
  let cursorMs = Date.parse(previousIso);
  let remaining = totalSeconds;
  while (remaining > 0) {
    const cursor = new Date(cursorMs);
    const nextMidnight = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1);
    const untilMidnight = Math.max(1, Math.floor((nextMidnight - cursorMs) / 1000));
    const seconds = Math.min(remaining, untilMidnight);
    const endMs = cursorMs + seconds * 1000;
    out.push({
      usageDate: utcDay(new Date(cursorMs).toISOString()),
      seconds,
      firstSeenAt: new Date(cursorMs).toISOString(),
      lastSeenAt: new Date(endMs).toISOString(),
    });
    cursorMs = endMs;
    remaining -= seconds;
  }
  return out;
}

async function presenceFor(db, userId) {
  return db.prepare(`SELECT user_id,first_seen_at,last_seen_at,current_session_id,last_heartbeat_id,updated_at
    FROM user_presence WHERE user_id=? LIMIT 1`).bind(userId).first();
}

function guardedDailyContinuation(db, userId, segment, claimId) {
  return db.prepare(`INSERT INTO user_usage_daily(
      user_id,usage_date,session_count,active_seconds,first_seen_at,last_seen_at
    )
    SELECT ?,?,1,?,?,?
    WHERE EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND last_heartbeat_id=?)
    ON CONFLICT(user_id,usage_date) DO UPDATE SET
      active_seconds=user_usage_daily.active_seconds+excluded.active_seconds,
      first_seen_at=CASE WHEN user_usage_daily.first_seen_at<=excluded.first_seen_at THEN user_usage_daily.first_seen_at ELSE excluded.first_seen_at END,
      last_seen_at=CASE WHEN user_usage_daily.last_seen_at>=excluded.last_seen_at THEN user_usage_daily.last_seen_at ELSE excluded.last_seen_at END`)
    .bind(userId, segment.usageDate, segment.seconds, segment.firstSeenAt, segment.lastSeenAt, userId, claimId);
}

function guardedDailySessionStart(db, userId, nowIso, claimId) {
  return db.prepare(`INSERT INTO user_usage_daily(
      user_id,usage_date,session_count,active_seconds,first_seen_at,last_seen_at
    )
    SELECT ?,?,1,0,?,?
    WHERE EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND last_heartbeat_id=?)
    ON CONFLICT(user_id,usage_date) DO UPDATE SET
      session_count=user_usage_daily.session_count+1,
      first_seen_at=CASE WHEN user_usage_daily.first_seen_at<=excluded.first_seen_at THEN user_usage_daily.first_seen_at ELSE excluded.first_seen_at END,
      last_seen_at=CASE WHEN user_usage_daily.last_seen_at>=excluded.last_seen_at THEN user_usage_daily.last_seen_at ELSE excluded.last_seen_at END`)
    .bind(userId, utcDay(nowIso), nowIso, nowIso, userId, claimId);
}

export async function recordUsageHeartbeat(env, userId, now = new Date()) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('usage_user_required');
  const db = database(env);
  const nowIso = iso(now);
  const current = await presenceFor(db, id);

  if (!current) {
    const claimId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO user_presence(user_id,first_seen_at,last_seen_at,current_session_id,last_heartbeat_id,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING`)
        .bind(id, nowIso, nowIso, sessionId, claimId, nowIso),
      db.prepare(`INSERT INTO user_sessions(id,user_id,started_at,last_seen_at,ended_at,duration_seconds,created_at)
        SELECT ?,?,?,?,NULL,0,?
        WHERE EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND last_heartbeat_id=?)`)
        .bind(sessionId, id, nowIso, nowIso, nowIso, id, claimId),
      guardedDailySessionStart(db, id, nowIso, claimId),
    ]);
    const final = await presenceFor(db, id);
    const won = final?.last_heartbeat_id === claimId;
    return { online: true, sessionId: final?.current_session_id || sessionId, lastSeenAt: final?.last_seen_at || nowIso, addedSeconds: 0, newSession: won };
  }

  const previousIso = iso(current.last_seen_at);
  const diffMs = Date.parse(nowIso) - Date.parse(previousIso);
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return { online: Boolean(current.current_session_id), sessionId: current.current_session_id || null, lastSeenAt: previousIso, addedSeconds: 0, newSession: false };
  }

  const claimId = crypto.randomUUID();
  if (current.current_session_id && diffMs <= SESSION_GAP_MS) {
    const delta = safeDeltaSeconds(previousIso, nowIso);
    const statements = [
      db.prepare(`UPDATE user_presence SET last_seen_at=?,last_heartbeat_id=?,updated_at=?
        WHERE user_id=? AND last_seen_at=? AND current_session_id IS ?`)
        .bind(nowIso, claimId, nowIso, id, previousIso, current.current_session_id),
      db.prepare(`UPDATE user_sessions SET
          duration_seconds=duration_seconds+?,
          last_seen_at=CASE WHEN last_seen_at<? THEN ? ELSE last_seen_at END
        WHERE id=? AND user_id=?
          AND EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND last_heartbeat_id=?)`)
        .bind(delta, nowIso, nowIso, current.current_session_id, id, id, claimId),
    ];
    for (const segment of activeSegments(previousIso, nowIso, delta)) {
      statements.push(guardedDailyContinuation(db, id, segment, claimId));
    }
    await db.batch(statements);
    const final = await presenceFor(db, id);
    const won = final?.last_heartbeat_id === claimId;
    return { online: true, sessionId: final?.current_session_id || current.current_session_id, lastSeenAt: final?.last_seen_at || previousIso, addedSeconds: won ? delta : 0, newSession: false };
  }

  const sessionId = crypto.randomUUID();
  const statements = [
    db.prepare(`UPDATE user_presence SET last_seen_at=?,current_session_id=?,last_heartbeat_id=?,updated_at=?
      WHERE user_id=? AND last_seen_at=? AND current_session_id IS ?`)
      .bind(nowIso, sessionId, claimId, nowIso, id, previousIso, current.current_session_id ?? null),
  ];
  if (current.current_session_id) {
    statements.push(db.prepare(`UPDATE user_sessions SET ended_at=COALESCE(ended_at,last_seen_at)
      WHERE id=? AND user_id=?
        AND EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND last_heartbeat_id=?)`)
      .bind(current.current_session_id, id, id, claimId));
  }
  statements.push(
    db.prepare(`INSERT INTO user_sessions(id,user_id,started_at,last_seen_at,ended_at,duration_seconds,created_at)
      SELECT ?,?,?,?,NULL,0,?
      WHERE EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND last_heartbeat_id=?)`)
      .bind(sessionId, id, nowIso, nowIso, nowIso, id, claimId),
    guardedDailySessionStart(db, id, nowIso, claimId),
  );
  await db.batch(statements);
  const final = await presenceFor(db, id);
  const won = final?.last_heartbeat_id === claimId;
  return { online: true, sessionId: final?.current_session_id || sessionId, lastSeenAt: final?.last_seen_at || nowIso, addedSeconds: 0, newSession: won };
}

export async function closeUsageSession(env, userId, now = new Date()) {
  const id = String(userId || '').trim();
  if (!id) return { closed: false };
  const db = database(env);
  const current = await presenceFor(db, id);
  if (!current?.current_session_id) return { closed: false };
  const nowIso = iso(now);
  const results = await db.batch([
    db.prepare(`UPDATE user_presence SET current_session_id=NULL,updated_at=?
      WHERE user_id=? AND current_session_id=?`).bind(nowIso, id, current.current_session_id),
    db.prepare(`UPDATE user_sessions SET ended_at=COALESCE(ended_at,?),
      last_seen_at=CASE WHEN last_seen_at>? THEN last_seen_at ELSE ? END
      WHERE id=? AND user_id=?
        AND EXISTS (SELECT 1 FROM user_presence WHERE user_id=? AND current_session_id IS NULL)`)
      .bind(nowIso, nowIso, nowIso, current.current_session_id, id, id),
  ]);
  return { closed: Number(results?.[0]?.meta?.changes || 0) > 0 };
}

export async function cleanupExpiredUsageSessions(env, { beforeIso, limit = 200 } = {}) {
  const db = database(env);
  const before = iso(beforeIso || new Date(0));
  const bounded = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
  const result = await db.prepare(`DELETE FROM user_sessions WHERE id IN (
    SELECT id FROM user_sessions
    WHERE COALESCE(ended_at,last_seen_at) < ?
    ORDER BY COALESCE(ended_at,last_seen_at) ASC,id ASC
    LIMIT ?
  )`).bind(before, bounded).run();
  return { deleted: Number(result?.meta?.changes || 0) };
}
