import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSupabaseClient, createMemorySessionStorage} from '../patch-source/cloudflare-license-authority/core/lib/supabase-client.js';

for (const failure of [503, 429, 'offline']) {
  test(`refresh ${failure} preserves credentials, does not replay, and allows retry`, async () => {
    let calls = 0;
    let recovered = false;
    const client = createSupabaseClient({API_BASE_URL:'https://app.test',CLIENT_RUNTIME_KEY:'runtime'}, {
      sessionStorage:createMemorySessionStorage(),
      fetchImpl:async url => {
        calls++;
        if (!String(url).includes('refresh_token')) return new Response('{}', {status:401});
        if (recovered) return Response.json({access_token:'new',refresh_token:'new-refresh'});
        if (failure === 'offline') throw new TypeError('offline');
        return Response.json({message:'temporarily unavailable'}, {status:failure});
      }
    });
    const session = {access_token:'expired',refresh_token:'valid-refresh'};
    client.setSession(session);
    await assert.rejects(client.rest('mothers'));
    assert.equal(calls, 2);
    assert.deepEqual(client.getSession(),session);
    recovered = true;
    await client.refreshSession();
    assert.equal(client.getSession().access_token,'new');
  });
}

test('R16 generic loser 401 waits for delayed winner response instead of clearing shared session', async () => {
  const shared = createMemorySessionStorage();
  const initial = {access_token:'expired-access',refresh_token:'refresh-old'};
  shared.setItem('debora-lactacao-session', JSON.stringify(initial));

  let resolveWinnerResponse;
  let winnerCommittedResolve;
  const winnerCommitted = new Promise(resolve => { winnerCommittedResolve = resolve; });
  let loserRefreshStartedResolve;
  const loserRefreshStarted = new Promise(resolve => { loserRefreshStartedResolve = resolve; });

  const winner = createSupabaseClient({API_BASE_URL:'https://app.test',CLIENT_RUNTIME_KEY:'runtime'}, {
    sessionStorage:shared,
    fetchImpl:async url => {
      assert.match(String(url), /refresh_token/);
      winnerCommittedResolve();
      return new Promise(resolve => { resolveWinnerResponse = resolve; });
    }
  });
  const loser = createSupabaseClient({API_BASE_URL:'https://app.test',CLIENT_RUNTIME_KEY:'runtime'}, {
    sessionStorage:shared,
    fetchImpl:async url => {
      assert.match(String(url), /refresh_token/);
      loserRefreshStartedResolve();
      return Response.json({message:'Sessão expirada. Entre novamente.'}, {status:401});
    }
  });

  const winnerPromise = winner.refreshSession();
  await winnerCommitted;
  const loserPromise = loser.refreshSession();
  await loserRefreshStarted;
  await new Promise(resolve => setTimeout(resolve, 30));

  resolveWinnerResponse(Response.json({
    access_token:'access-new',
    refresh_token:'refresh-new',
    token_type:'bearer',
    expires_in:3600,
  }));

  const [winnerSession, loserSession] = await Promise.all([winnerPromise, loserPromise]);
  assert.equal(winnerSession.refresh_token, 'refresh-new');
  assert.equal(loserSession.refresh_token, 'refresh-new');
  assert.equal(winner.getSession().refresh_token, 'refresh-new');
  assert.equal(loser.getSession().refresh_token, 'refresh-new');
});

test('bootstrap cannot replace renewed local session with stale commercial copy', () => {
  const fresh = JSON.stringify({access_token:'fresh',refresh_token:'rotated'});
  const stale = JSON.stringify({access_token:'old',refresh_token:'revoked'});
  const localStorage = createMemorySessionStorage({'debora-lactacao-session':fresh});
  const sessionStorage = createMemorySessionStorage({'commercial.saas.session.v1':stale});
  const source=readFileSync(new URL('../src/bootstrap.js',import.meta.url),'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function validStoredSession'),source.indexOf("if ('serviceWorker' in navigator)")), {
    localStorage,sessionStorage,APP_CONTEXT:{entryMode:'app'},LEGACY_CLINICAL_SESSION_KEY:'debora-lactacao-session',
    CANONICAL_SESSION_KEY:'amamentacao-session',COMMERCIAL_SESSION_KEY:'commercial.saas.session.v1'
  });
  assert.equal(localStorage.getItem('debora-lactacao-session'),fresh);
  assert.equal(sessionStorage.getItem('commercial.saas.session.v1'),fresh);
});

test('logout clears aliases and a late refresh cannot restore the session',async()=>{
  const oldLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const oldTab=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  const local=createMemorySessionStorage(), tab=createMemorySessionStorage();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:local});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:tab});
  let resolveRefresh;
  try {
    const client=createSupabaseClient({API_BASE_URL:'https://app.test',CLIENT_RUNTIME_KEY:'runtime'},{sessionStorage:local,
      fetchImpl:()=>new Promise(resolve=>{resolveRefresh=resolve;})});
    client.setSession({access_token:'old',refresh_token:'old-refresh'});
    const refresh=client.refreshSession();
    client.setSession(null);
    resolveRefresh(Response.json({access_token:'new',refresh_token:'new-refresh'}));
    await assert.rejects(refresh,/sessão mudou/);
    for(const store of [local,tab]) for(const key of ['debora-lactacao-session','amamentacao-session','commercial.saas.session.v1','debora-runtime-access-token']) {
      assert.equal(store.getItem(key),null);
    }
    assert.equal(globalThis.__deboraAccessToken,null);
  } finally {
    if(oldLocal) Object.defineProperty(globalThis,'localStorage',oldLocal); else delete globalThis.localStorage;
    if(oldTab) Object.defineProperty(globalThis,'sessionStorage',oldTab); else delete globalThis.sessionStorage;
  }
});
