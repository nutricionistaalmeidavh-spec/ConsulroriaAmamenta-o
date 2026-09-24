import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const weightSource = readFileSync('public/weight-evolution-v5.js', 'utf8');

function weightRow(date, weight, primary = '') {
  return {
    querySelector(selector) {
      if (selector === ':scope > div') {
        return {
          querySelector(child) {
            if (child === 'span') return { textContent: date };
            if (child === 'strong') return { textContent: `${weight} g` };
            return null;
          },
        };
      }
      if (selector === 'p') return { textContent: primary };
      return null;
    },
  };
}

function createWeightHarness(initialRows = []) {
  let sourceRows = [...initialRows];
  const classes = new Set();
  const timers = [];
  let observerCallback = null;
  let nextTimerId = 1;
  let scheduledCount = 0;
  let clearedCount = 0;

  const host = {
    dataset: {},
    innerHTML: '<div class="legacy-v4">legacy</div>',
    classList: {
      add(name) { classes.add(name); },
      contains(name) { return classes.has(name); },
    },
    querySelectorAll(selector) {
      if (selector === '.gf-weight-change-row') return [...sourceRows];
      return [];
    },
    querySelector(selector) {
      if (selector === '.gf-weight-change-row') return sourceRows[0] || null;
      return null;
    },
  };

  const document = {
    documentElement: {},
    head: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return {}; },
    querySelectorAll(selector) {
      if (selector === '[data-weight-changes-v4]') return [host];
      return [];
    },
  };

  class MutationObserver {
    constructor(callback) {
      observerCallback = callback;
      this.callback = callback;
    }
    observe() {}
  }

  const setTimeout = (fn) => {
    const timer = { id: nextTimerId++, fn, active: true };
    timers.push(timer);
    scheduledCount += 1;
    return timer.id;
  };

  const clearTimeout = (id) => {
    const timer = timers.find((item) => item.id === id && item.active);
    if (timer) {
      timer.active = false;
      clearedCount += 1;
    }
  };

  const context = {
    console,
    document,
    MutationObserver,
    setTimeout,
    clearTimeout,
    addEventListener() {},
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(weightSource, context, { filename: 'weight-evolution-v5.js' });

  return {
    host,
    setRows(rows) { sourceRows = [...rows]; },
    triggerMutation() { observerCallback?.(); },
    pendingTimerCount() { return timers.filter((timer) => timer.active).length; },
    scheduledCount() { return scheduledCount; },
    clearedCount() { return clearedCount; },
    runNextTimer() {
      const timer = timers.find((item) => item.active);
      if (!timer) return false;
      timer.active = false;
      timer.fn();
      return true;
    },
  };
}

const rows = [
  weightRow('01/09/2026', 1944, 'Peso ao nascer'),
  weightRow('04/09/2026', 1860, 'Perda'),
  weightRow('10/09/2026', 2100, 'Ganho'),
  weightRow('23/09/2026', 2290, 'Ganho'),
];

test('approved V5 weight history renders the final patient-facing structure and calculations', () => {
  const { host } = createWeightHarness(rows);

  assert.equal(host.classList.contains('gf-weight-changes-v5'), true);
  assert.match(host.innerHTML, /Evolução do peso/);
  assert.match(host.innerHTML, /Trajetória desde o nascimento/);
  assert.match(host.innerHTML, /4 medições/);
  assert.match(host.innerHTML, /1\.944 g/);
  assert.match(host.innerHTML, /2\.290 g/);
  assert.match(host.innerHTML, /\+346 g/);
  assert.match(host.innerHTML, /Peso ao nascer/);
  assert.match(host.innerHTML, /84 g/);
  assert.match(host.innerHTML, /240 g/);
  assert.doesNotMatch(host.innerHTML, /legacy-v4/);
});

test('V5 scheduling keeps one first pending pass instead of postponing under mutation bursts', () => {
  const harness = createWeightHarness([]);
  harness.setRows(rows);

  harness.triggerMutation();
  harness.triggerMutation();
  harness.triggerMutation();

  assert.equal(harness.pendingTimerCount(), 1);
  assert.equal(harness.scheduledCount(), 1, 'repeated mutations must not schedule replacement timers');
  assert.equal(harness.clearedCount(), 0, 'the first pending V5 pass must never be cancelled');

  harness.runNextTimer();
  assert.equal(harness.host.classList.contains('gf-weight-changes-v5'), true);
});

test('V5 rebuilds from updated source measurements after the V4 producer remounts', () => {
  const harness = createWeightHarness(rows);
  assert.match(harness.host.innerHTML, /4 medições/);

  harness.setRows([
    ...rows,
    weightRow('30/09/2026', 2400, 'Ganho'),
  ]);
  harness.host.innerHTML = '<div class="legacy-v4">updated source</div>';
  harness.triggerMutation();
  harness.runNextTimer();

  assert.match(harness.host.innerHTML, /5 medições/);
  assert.match(harness.host.innerHTML, /2\.400 g/);
  assert.match(harness.host.innerHTML, /\+456 g/);
  assert.doesNotMatch(harness.host.innerHTML, /updated source/);
});
