const LEGACY_SORT = '1970-01-01T00:00:00.000Z';

function database(env) {
  if (!env?.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(value) {
  return b64urlEncode(JSON.stringify(value));
}
export function decodeCursor(value) {
  try {
    const parsed = JSON.parse(b64urlDecode(value));
    if (!parsed || typeof parsed.sort !== 'string' || typeof parsed.id !== 'string' || !parsed.sort || !parsed.id) throw new Error();
    return { sort: parsed.sort, id: parsed.id };
  } catch { throw new Error('invalid_cursor'); }
}
export function pageLimit(value, fallback=50) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : fallback;
}

function dayAt(now, daysBack) {
  const d = new Date(now);
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate()-daysBack);
  return d.toISOString().slice(0,10);
}
function startIso(now, daysBack) { return `${dayAt(now,daysBack)}T00:00:00.000Z`; }
function onlineCutoff(now) { return new Date(new Date(now).getTime()-2*60*1000).toISOString(); }
function n(row,key){ return Number(row?.[key] || 0); }

export async function observabilitySummary(env, now=new Date()) {
  const db=database(env);
  const today=dayAt(now,0), d7=dayAt(now,6), d30=dayAt(now,29);
  const accounts=await db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN substr(created_at,1,10)=? THEN 1 ELSE 0 END) created_today,
      SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) created_7d,
      SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) created_30d
    FROM auth_users`).bind(today,startIso(now,6),startIso(now,29)).first();
  const presence=await db.prepare(`SELECT
      SUM(CASE WHEN current_session_id IS NOT NULL AND last_seen_at>=? THEN 1 ELSE 0 END) online_now
    FROM user_presence`).bind(onlineCutoff(now)).first();
  const activity=await db.prepare(`SELECT
      COUNT(DISTINCT CASE WHEN usage_date=? THEN user_id END) active_today,
      COUNT(DISTINCT CASE WHEN usage_date>=? THEN user_id END) active_7d,
      COUNT(DISTINCT CASE WHEN usage_date>=? THEN user_id END) active_30d,
      SUM(CASE WHEN usage_date=? THEN session_count ELSE 0 END) sessions_today,
      SUM(CASE WHEN usage_date=? THEN active_seconds ELSE 0 END) seconds_today,
      SUM(CASE WHEN usage_date>=? THEN active_seconds ELSE 0 END) seconds_7d,
      SUM(CASE WHEN usage_date>=? THEN active_seconds ELSE 0 END) seconds_30d
    FROM user_usage_daily WHERE usage_date>=?`)
    .bind(today,d7,d30,today,today,d7,d30,d30).first();
  const plans=await db.prepare(`SELECT
      COUNT(DISTINCT CASE WHEN plan_code='pro_monthly' AND status IN ('active','trialing') THEN owner_id END) pro_monthly,
      COUNT(DISTINCT CASE WHEN plan_code='pro_annual' AND status IN ('active','trialing') THEN owner_id END) pro_annual
    FROM subscriptions WHERE provider='asaas'`).bind().first();
  const billing=await db.prepare(`SELECT COUNT(*) checkouts_created,
      SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) paid,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) expired,
      SUM(CASE WHEN status='paid' THEN COALESCE(total_cents,0) ELSE 0 END) realized_revenue_cents
    FROM billing_checkout_requests WHERE provider='asaas'`).bind().first();
  const subs=await db.prepare(`SELECT
      SUM(CASE WHEN status IN ('active','trialing') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status='past_due' THEN 1 ELSE 0 END) past_due,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) expired
    FROM subscriptions WHERE provider='asaas'`).bind().first();
  const proMonthly=n(plans,'pro_monthly'), proAnnual=n(plans,'pro_annual'), total=n(accounts,'total');
  return {
    accounts:{total,createdToday:n(accounts,'created_today'),created7d:n(accounts,'created_7d'),created30d:n(accounts,'created_30d')},
    presence:{onlineNow:n(presence,'online_now'),activeToday:n(activity,'active_today'),active7d:n(activity,'active_7d'),active30d:n(activity,'active_30d')},
    usage:{sessionsToday:n(activity,'sessions_today'),activeSecondsToday:n(activity,'seconds_today'),activeSeconds7d:n(activity,'seconds_7d'),activeSeconds30d:n(activity,'seconds_30d')},
    plans:{freemium:Math.max(0,total-proMonthly-proAnnual),proMonthly,proAnnual},
    billing:{checkoutsCreated:n(billing,'checkouts_created'),paid:n(billing,'paid'),failed:n(billing,'failed'),expired:n(billing,'expired'),realizedRevenueCents:n(billing,'realized_revenue_cents')},
    subscriptions:{active:n(subs,'active'),pastDue:n(subs,'past_due'),cancelled:n(subs,'cancelled'),expired:n(subs,'expired')},
  };
}

export async function listObservedUsers(env, query={}, now=new Date()) {
  const db=database(env), limit=pageLimit(query.limit,50);
  const today=dayAt(now,0), d7=dayAt(now,6), d30=dayAt(now,29);
  const where=[], params=[today,today,d7,d30,d30];
  if (query.cursor) {
    const cursor=decodeCursor(query.cursor);
    where.push(`(COALESCE(u.created_at,'${LEGACY_SORT}') < ? OR (COALESCE(u.created_at,'${LEGACY_SORT}') = ? AND u.user_id < ?))`);
    params.push(cursor.sort,cursor.sort,cursor.id);
  }
  const search=String(query.search||'').trim().toLowerCase();
  if(search){where.push("lower(COALESCE(u.email,'')) LIKE ?");params.push(`%${search}%`)}
  const plan=String(query.plan||'').trim();
  if(plan){where.push("COALESCE(CASE WHEN s.status IN ('active','trialing','past_due') THEN s.plan_code END,'freemium')=?");params.push(plan)}
  const status=String(query.status||'').trim();
  if(status){where.push("COALESCE(s.status,'freemium')=?");params.push(status)}
  if(String(query.online||'')==='true'){where.push('p.current_session_id IS NOT NULL AND p.last_seen_at>=?');params.push(onlineCutoff(now))}
  if(String(query.online||'')==='false'){where.push('(p.current_session_id IS NULL OR p.last_seen_at IS NULL OR p.last_seen_at<?)');params.push(onlineCutoff(now))}
  if(query.createdFrom){where.push('u.created_at>=?');params.push(String(query.createdFrom))}
  if(query.createdTo){where.push('u.created_at<=?');params.push(String(query.createdTo))}
  if(query.lastSeenFrom){where.push('p.last_seen_at>=?');params.push(String(query.lastSeenFrom))}
  if(query.lastSeenTo){where.push('p.last_seen_at<=?');params.push(String(query.lastSeenTo))}
  params.push(limit+1);
  const sql=`WITH usage AS (
      SELECT user_id,
        SUM(CASE WHEN usage_date=? THEN session_count ELSE 0 END) sessions_today,
        SUM(CASE WHEN usage_date=? THEN active_seconds ELSE 0 END) active_today,
        SUM(CASE WHEN usage_date>=? THEN active_seconds ELSE 0 END) active_7d,
        SUM(CASE WHEN usage_date>=? THEN active_seconds ELSE 0 END) active_30d
      FROM user_usage_daily WHERE usage_date>=? GROUP BY user_id
    )
    SELECT u.user_id,u.email,u.created_at,u.last_sign_in_at,p.last_seen_at,p.current_session_id,
      s.plan_code,s.status subscription_status,s.current_period_end,
      COALESCE(usage.sessions_today,0) sessions_today,COALESCE(usage.active_today,0) active_today,
      COALESCE(usage.active_7d,0) active_7d,COALESCE(usage.active_30d,0) active_30d
    FROM auth_users u
    LEFT JOIN user_presence p ON p.user_id=u.user_id
    LEFT JOIN subscriptions s ON s.owner_id=u.user_id AND s.provider='asaas'
    LEFT JOIN usage ON usage.user_id=u.user_id
    ${where.length?`WHERE ${where.join(' AND ')}`:''}
    ORDER BY COALESCE(u.created_at,'${LEGACY_SORT}') DESC,u.user_id DESC LIMIT ?`;
  const rows=(await db.prepare(sql).bind(...params).all()).results||[];
  const hasMore=rows.length>limit, visible=rows.slice(0,limit), cutoff=onlineCutoff(now);
  const items=visible.map(row=>({
    userId:row.user_id,email:row.email||null,createdAt:row.created_at||null,lastSignInAt:row.last_sign_in_at||null,lastSeenAt:row.last_seen_at||null,
    online:Boolean(row.current_session_id&&row.last_seen_at&&row.last_seen_at>=cutoff),
    planCode:['active','trialing','past_due'].includes(String(row.subscription_status||''))?row.plan_code:'freemium',
    subscriptionStatus:row.subscription_status||null,currentPeriodEnd:row.current_period_end||null,
    sessionsToday:Number(row.sessions_today||0),activeSecondsToday:Number(row.active_today||0),activeSeconds7d:Number(row.active_7d||0),activeSeconds30d:Number(row.active_30d||0),
  }));
  const last=visible.at(-1);
  return {items,hasMore,nextCursor:hasMore&&last?encodeCursor({sort:last.created_at||LEGACY_SORT,id:last.user_id}):null};
}

function salesBoundary(query, where, params) {
  if(query.mergeCreatedAt){
    const rank=Number(query.mergeSourceRank), id=String(query.mergeId||'');
    if(!Number.isInteger(rank)||rank<0||rank>1||!id) throw new Error('invalid_cursor');
    where.push('(c.created_at < ? OR (c.created_at = ? AND (1 < ? OR (1 = ? AND c.id < ?))))');
    params.push(String(query.mergeCreatedAt),String(query.mergeCreatedAt),rank,rank,id);
    return;
  }
  if(query.cursor){const c=decodeCursor(query.cursor);where.push('(c.created_at < ? OR (c.created_at=? AND c.id<?))');params.push(c.sort,c.sort,c.id)}
}

export async function listObservedSales(env, query={}) {
  const db=database(env), limit=pageLimit(query.limit,50), where=["c.provider='asaas'"], params=[];
  salesBoundary(query,where,params);
  if(query.plan){where.push('c.plan_code=?');params.push(String(query.plan))}
  if(query.status){where.push('c.status=?');params.push(String(query.status))}
  if(query.createdFrom){where.push('c.created_at>=?');params.push(String(query.createdFrom))}
  if(query.createdTo){where.push('c.created_at<=?');params.push(String(query.createdTo))}
  params.push(limit+1);
  const rows=(await db.prepare(`SELECT c.id,c.owner_id,COALESCE(u.email,p.email) email,c.plan_code,c.status,c.provider,
      c.subtotal_cents,c.discount_cents,c.total_cents,c.external_checkout_id,c.created_at,c.updated_at
    FROM billing_checkout_requests c
    LEFT JOIN auth_users u ON u.user_id=c.owner_id
    LEFT JOIN billing_pending_signups p ON p.user_id=c.owner_id
    WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`).bind(...params).all()).results||[];
  const hasMore=rows.length>limit, visible=rows.slice(0,limit);
  const items=visible.map(row=>({checkoutId:row.id,ownerId:row.owner_id,email:row.email||null,planCode:row.plan_code,status:row.status,provider:row.provider,source:'asaas',sourceRank:1,subtotalCents:Number(row.subtotal_cents||0),discountCents:Number(row.discount_cents||0),totalCents:Number(row.total_cents||0),externalCheckoutId:row.external_checkout_id||null,createdAt:row.created_at,updatedAt:row.updated_at}));
  const last=visible.at(-1);
  return {items,hasMore,nextCursor:hasMore&&last?encodeCursor({sort:last.created_at,id:last.id}):null};
}

export async function listUserSessions(env, userId, query={}) {
  const db=database(env), id=String(userId||'').trim();
  if(!id||id.length>160) throw new Error('invalid_user_id');
  const limit=pageLimit(query.limit,25), where=['user_id=?'], params=[id];
  if(query.cursor){const c=decodeCursor(query.cursor);where.push('(started_at < ? OR (started_at=? AND id<?))');params.push(c.sort,c.sort,c.id)}
  params.push(limit+1);
  const rows=(await db.prepare(`SELECT id,user_id,started_at,last_seen_at,ended_at,duration_seconds
    FROM user_sessions WHERE ${where.join(' AND ')} ORDER BY started_at DESC,id DESC LIMIT ?`).bind(...params).all()).results||[];
  const hasMore=rows.length>limit, visible=rows.slice(0,limit);
  const items=visible.map(row=>({id:row.id,userId:row.user_id,startedAt:row.started_at,lastSeenAt:row.last_seen_at,endedAt:row.ended_at||null,durationSeconds:Number(row.duration_seconds||0)}));
  const last=visible.at(-1);
  return {items,hasMore,nextCursor:hasMore&&last?encodeCursor({sort:last.started_at,id:last.id}):null};
}
