import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
test('active frontend has no retired configuration, bridge or legacy bootstrap fallback',()=>{
  for(const f of [...files('src'),...files('public')].filter(f=>/\.(js|html|json)$/.test(f))) {
    assert.doesNotMatch(read(f),/zxowxdfhtksevhnjmeyu|sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|supabaseUrl|supabasePublishableKey|LEGACY_SUPABASE_ORIGIN|cloudflare-fetch-bridge/,f);
  }
  assert.equal(existsSync('src/cloudflare-fetch-bridge.js'),false);
  for(const f of ['index.html','app/index.html']) assert.doesNotMatch(read(f),/cloudflare-fetch-bridge/);
  assert.doesNotMatch(read('src/bootstrap.js'),/loadLegacyRuntime|loadBaseArchive|AUTH_ORIGIN|window.fetch\s*=/);
  assert.doesNotMatch(read('public/sw.js'),/supabase\.co/);
});

test('built assets do not reintroduce retired origins or bridge', {skip: !existsSync('dist/assets')},()=>{
  for(const f of [...files('dist/assets'), 'dist/index.html', 'dist/app/index.html', 'dist/clinical-source/config.js', 'dist/comercial/auth-recovery.js']) {
    assert.doesNotMatch(read(f), /zxowxdfhtksevhnjmeyu|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|LEGACY_SUPABASE_ORIGIN|cloudflare-fetch-bridge|supabaseUrl|supabasePublishableKey/, f);
  }
});
