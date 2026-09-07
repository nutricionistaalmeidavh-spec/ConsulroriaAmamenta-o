import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('public/comercial/index.html', 'utf8');
const recovery = fs.readFileSync('public/comercial/auth-recovery.js', 'utf8');

assert.match(html, /data-recover-password/);
assert.match(html, /auth-recovery\.js\?v=/);
assert.match(html, /app\.js\?v=/);
assert.match(recovery, /\/auth\/v1\/recover/);
assert.match(recovery, /recovery=1/);
assert.match(recovery, /\/auth\/v1\/user/);
assert.match(recovery, /commercial\.saas\.session\.v1/);
assert.match(recovery, /Nova senha/);

console.log('commercial auth recovery contract ok');
