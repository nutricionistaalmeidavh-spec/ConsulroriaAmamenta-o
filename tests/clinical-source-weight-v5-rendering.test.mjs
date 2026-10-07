import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const weightSource=readFileSync('public/weight-evolution-v5.js','utf8');
const growthTemplate=readFileSync('patch-source/legacy/growth-feature.supabase-template.js','utf8');
const mobileIntegrity=readFileSync('public/mobile-layout-integrity.css','utf8');

function createHarness(){
  const classes=new Set();
  const host={
    dataset:{},
    innerHTML:'',
    classList:{
      add(name){classes.add(name)},
      contains(name){return classes.has(name)}
    }
  };
  const document={
    head:{appendChild(){}},
    getElementById(){return null},
    createElement(){return{}}
  };
  const context={console,document};
  context.window=context;
  context.globalThis=context;
  vm.runInNewContext(weightSource,context,{filename:'weight-evolution-v5.js'});
  return {host,api:context.DeboraWeightEvolution};
}

const baby={birth_date:'2026-08-23',birth_weight_g:1944};
const weights=[
  {measured_at:'2026-08-29T12:00:00Z',weight_g:1890},
  {measured_at:'2026-09-11T12:00:00Z',weight_g:2210},
];
const measurements=[
  {measured_at:'2026-09-02T12:00:00Z',weight_g:1970},
  {measured_at:'2026-09-11T12:00:00Z',weight_g:2210},
  {measured_at:'2026-09-18T12:00:00Z',weight_g:2290},
];

test('approved V5 weight history renders directly from canonical growth data',()=>{
  const {host,api}=createHarness();
  assert.equal(api.mount({host,baby,weights,measurements}),true);
  assert.equal(host.classList.contains('gf-weight-changes-v5'),true);
  assert.match(host.innerHTML,/Evolução do peso/);
  assert.match(host.innerHTML,/Trajetória desde o nascimento/);
  assert.match(host.innerHTML,/5 medições/);
  assert.match(host.innerHTML,/1\.944 g/);
  assert.match(host.innerHTML,/2\.290 g/);
  assert.match(host.innerHTML,/\+346 g/);
  assert.match(host.innerHTML,/Peso ao nascer/);
  assert.match(host.innerHTML,/54 g/);
  assert.match(host.innerHTML,/80 g/);
  assert.match(host.innerHTML,/240 g/);
});

test('canonical projection deduplicates the same measurement across weights and growth measurements',()=>{
  const {api}=createHarness();
  const rows=api.buildRows({
    baby,
    weights:[{measured_at:'2026-09-11T12:00:00Z',weight_g:2210}],
    measurements:[{measured_at:'2026-09-11T14:30:00Z',weight_g:2210}],
  });
  assert.equal(rows.length,2);
  assert.equal(rows[0].birth,true);
  assert.equal(rows[1].weight,2210);
});

test('V5 updates from new canonical input without DOM scraping or MutationObserver scheduling',()=>{
  const {host,api}=createHarness();
  api.mount({host,baby,weights,measurements});
  assert.match(host.innerHTML,/5 medições/);

  api.mount({
    host,
    baby,
    weights,
    measurements:[...measurements,{measured_at:'2026-09-25T12:00:00Z',weight_g:2400}],
  });
  assert.match(host.innerHTML,/6 medições/);
  assert.match(host.innerHTML,/2\.400 g/);
  assert.match(host.innerHTML,/\+456 g/);

  assert.doesNotMatch(weightSource,/MutationObserver/);
  assert.doesNotMatch(weightSource,/gf-weight-change-row/);
  assert.doesNotMatch(weightSource,/querySelectorAll\(['"]\[data-weight-changes-v4\]/);
  assert.doesNotMatch(weightSource,/\bfetch\s*\(/);
});

test('growth runtime owns the canonical data handoff to V5 and has no dedicated V4 weight observer',()=>{
  assert.match(growthTemplate,/^import '\.\/weight-evolution-v5\.js';/);
  assert.match(growthTemplate,/DeboraWeightEvolution\?\.mount\?\.\(\{host,baby:s\.baby,weights:s\.w,measurements:s\.g\}\)/);
  assert.match(growthTemplate,/gfMountDetailV3\(\);gfMountInlineV3\(\);gfMountWeightHistoryV5\(\)/);
  assert.doesNotMatch(growthTemplate,/gfWeightTimelineV4/);
  assert.doesNotMatch(growthTemplate,/gfWeightScheduleV4/);
  assert.doesNotMatch(growthTemplate,/gf-weight-change-row/);
});

test('compact home KPI layout gives receivable amount a full-width card',()=>{
  assert.match(mobileIntegrity,/@media\(max-width:520px\)/);
  assert.match(mobileIntegrity,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(mobileIntegrity,/\.lactation-kpis \.lactation-kpi:nth-child\(3\)\{\s*grid-column:1\/-1/);
  assert.match(mobileIntegrity,/font-size:clamp\(18px,5\.4vw,22px\)!important/);
});
