import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const base=new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const calc=await import(base+'/js/dojo-calc.js');
const fmt=await import(base+'/js/format.js');
const source=fs.readFileSync(process.argv[2]||base+'/js/pages/dojo.js','utf8');
const names=['runInputs','deltaText','editorHtml','hourText','beltText','paintLive','paintPlaque','paintBeltSum'];
const functions=names.map(name=>{
 const start=source.indexOf('  function '+name+'(');
 const end=source.indexOf('\n  }',start)+4;
 assert(start>=0&&end>start,name);return source.slice(start,end);
}).join('\n');
const prices={white:100n,yellow:200n,blue:300n,red:400n,black:500n};
const route={saves:[],runs:[{}],points:100,seconds:60};
const key=calc.chainKey([]),draftRuns=new Map();
let score=6000;
const nodes=new Map();
const row={dataset:{chain:key,timeMode:'recommend'},querySelector(s){if(!nodes.has(s)) nodes.set(s,{textContent:''});return nodes.get(s);}};
const context=vm.createContext({...calc,...fmt,draftRuns,priceMap:()=>prices,routeForKey:()=>route,floorsOf:()=>({score}),form:{querySelectorAll:()=>[row]}});
vm.runInContext(functions,context);
function html(mode){return context.editorHtml(route,score,mode);}
function value(h,n){return h.match(new RegExp('data-live="'+n+'">([^<]*)'))?.[1];}
let h=html('recommend');
assert.equal(value(h,'belt-total'),calc.formatDuration(7200));
assert.equal(value(h,'belt'),calc.formatDuration(3600));
assert.equal(value(h,'hour'),fmt.formatCount(calc.quoteBlackBelt(prices,route,60).hour));
draftRuns.set(key,120);
assert.equal(value(html('recommend'),'belt'),calc.formatDuration(3600));
assert.equal(value(html('actual'),'belt'),calc.formatDuration(7200));
context.paintLive(key);assert.equal(nodes.get("[data-live='belt']").textContent,calc.formatDuration(3600));
row.dataset.timeMode='actual';context.paintLive(key);assert.equal(nodes.get("[data-live='belt']").textContent,calc.formatDuration(7200));
assert.equal(nodes.get("[data-live='belt-total']").textContent,calc.formatDuration(14400));
draftRuns.clear();context.paintLive(key);assert.equal(nodes.get("[data-live='belt']").textContent,calc.formatDuration(3600));
assert.equal(nodes.get("[data-live='belt-total']").textContent,calc.formatDuration(7200));
for (const points of [0, 12000]) {
 score=points;
 assert.equal(value(html('recommend'),'belt-total'),calc.formatDuration(7200));
 assert.equal(value(html('recommend'),'belt'),points===0?calc.formatDuration(7200):'달성');
 context.paintLive(key);
 assert.equal(nodes.get("[data-live='belt-total']").textContent,calc.formatDuration(7200));
}
delete prices.black;assert.equal(value(html('recommend'),'hour'),'시세 없음');
console.log('참고/실제 기준·남은시간·시간당메소·입력삭제 fallback·미입력시세 검증 통과');

const summary=new Map(['[data-stat-need]','[data-stat-play-label]','[data-stat-play]','[data-stat-hour-label]','[data-stat-hour]','[data-belt-sum]','[data-belt-hour]'].map(key=>[key,{textContent:''}]));
context.root={querySelector:selector=>summary.get(selector)??null};
context.shownEntry={route,seconds:60,mode:'recommend'};
for (const points of [0,6000,12000]) {
 context.paintPlaque(points);
 assert.equal(summary.get('[data-stat-play]').textContent,calc.formatDuration(7200));
}
assert.match(summary.get('[data-stat-play-label]').textContent,/0 → 12,000점/);
assert.match(summary.get('[data-stat-hour-label]').textContent,/참고 1위/);
assert.equal(summary.get('[data-stat-hour]').textContent,'시세 없음');
prices.black=500n;context.paintBeltSum();
assert.equal(summary.get('[data-stat-hour]').textContent,fmt.formatCount(calc.quoteBlackBelt(prices,route,60).hour));
context.shownEntry={route,seconds:120,mode:'actual'};context.paintPlaque(6000);
assert.equal(summary.get('[data-stat-play]').textContent,calc.formatDuration(14400));
assert.match(summary.get('[data-stat-hour-label]').textContent,/실제 1위/);
context.shownEntry=null;context.paintPlaque(0);
assert.equal(summary.get('[data-stat-play]').textContent,'-');
assert.equal(summary.get('[data-stat-hour]').textContent,'-');
console.log('상단 총시간/시간당메소·점수독립·실제/참고·시세갱신 검증 통과');
