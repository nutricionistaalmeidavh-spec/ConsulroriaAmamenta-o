import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const hub=readFileSync('public/patient-records-hub.js','utf8');

test('generic prontuario entry opens the records selector instead of a concrete encounter',()=>{
  assert.match(hub,/data-prh-target="records"/);
  assert.match(hub,/\['records','terms','referrals','album'\]/);
  assert.match(hub,/DeboraPatientWorkspace\?\.open\(kind,motherId/);
  assert.doesNotMatch(hub,/data-prh-target="records"[\s\S]{0,500}openEncounter\(/);
});
