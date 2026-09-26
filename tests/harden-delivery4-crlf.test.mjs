import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformDelivery4Billing } from '../scripts/harden-delivery4-package-billing.mjs';

const billingPath = new URL('../public/billing-v2.js', import.meta.url);

test('Delivery 4 billing hardening supports Windows CRLF checkouts', () => {
  const source = readFileSync(billingPath, 'utf8').replace(/\r?\n/g, '\r\n');
  const materialized = transformDelivery4Billing(source);

  assert.match(materialized, /p_request_key:s\.mode==='package_new'\?'package-new:'\+appointmentId:null/);
  assert.match(materialized, /!packages\.length\|\|selection\.mode==='package_new'/);
  assert.match(materialized, /function bvSchedule\(\)\{if\(bvTimer\)return;bvTimer=setTimeout\(\(\)=>\{bvTimer=null;/);
});
