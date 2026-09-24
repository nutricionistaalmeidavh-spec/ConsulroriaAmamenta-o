import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeGrowthRuntimeSource } from '../scripts/normalize-growth-runtime.mjs';

const source = normalizeGrowthRuntimeSource(
  readFileSync('patch-source/legacy/growth-feature.supabase-template.js', 'utf8'),
);

test('curve load failures stay inside one retry notice instead of producing a repeated global error storm', () => {
  const start = source.indexOf('function gfShowLoadError(');
  assert.notEqual(start, -1, 'normalized growth runtime must expose the local load-error UI');
  const showLoadErrorSource = source.slice(start);
  assert.doesNotMatch(showLoadErrorSource, /(?:DOC|DeboraDocuments)\.toast|\btoast\s*\(/i);

  let notice = null;
  let appendCount = 0;
  let enhanceCalls = 0;
  let lastCreated = null;

  const card = {
    querySelector(selector) {
      return selector === '[data-growth-load-error]' ? notice : null;
    },
    appendChild(node) {
      notice = node;
      appendCount += 1;
      return node;
    },
  };

  const document = {
    querySelector(selector) {
      return selector === '[data-growth-load-error]' ? notice : null;
    },
    createElement() {
      const button = { onclick: null };
      const node = {
        dataset: {},
        className: '',
        innerHTML: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        querySelector(selector) { return selector === 'button' ? button : null; },
        button,
      };
      lastCreated = node;
      return node;
    },
  };

  const showLoadError = vm.runInNewContext(`${showLoadErrorSource};gfShowLoadError`, {
    location: { hash: '#/patient/mother-a' },
    document,
    gfHistoryCardV3() { return card; },
    gfEnhanceV3() { enhanceCalls += 1; },
  });

  for (let index = 0; index < 50; index += 1) {
    showLoadError(new Error('Failed to fetch'));
  }

  assert.equal(appendCount, 1, 'repeated curve failures must reuse one in-card notice');
  assert.equal(lastCreated?.dataset.growthLoadError, '1');
  assert.equal(lastCreated?.attributes.role, 'status');
  assert.match(lastCreated?.innerHTML || '', /Curva de peso indisponível/);
  assert.match(lastCreated?.innerHTML || '', /Tentar novamente/);

  lastCreated.button.onclick();
  assert.equal(enhanceCalls, 1, 'retry remains explicit and user-driven');
});

test('curve scheduler keeps at most one pending mount during DOM churn', () => {
  const start = source.indexOf('function gfScheduleV3()');
  const end = source.indexOf('function gfRouteResetV3()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const callbacks = [];
  let mounted = 0;
  const schedule = vm.runInNewContext(`let gfTimerV3;${source.slice(start, end)};gfScheduleV3`, {
    setTimeout(fn) { callbacks.push(fn); return callbacks.length; },
    gfEnhanceV3() { mounted += 1; },
    clearTimeout() { throw new Error('pending curve mount must never be cancelled and postponed'); },
  });

  for (let index = 0; index < 100; index += 1) schedule();
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  assert.equal(mounted, 1);
});
