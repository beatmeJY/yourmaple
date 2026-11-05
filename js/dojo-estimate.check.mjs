import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const base=new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const calc=await import(base+'/js/dojo-calc.js');
const fmt=await import(base+'/js/format.js');
const source=fs.readFileSync(process.argv[2]||base+'/js/pages/dojo.js','utf8');
const names=['runInputs','deltaText','editorHtml','hourText','beltText','paintLive'];
const functions=names.map(name=>{
 const start=source.indexOf('  function '+name+'(');
 const end=source.indexOf('\n  }',start)+4;
 assert(start>=0&&end>start,name);return source.slice(start,end);
}).join('\n');
const prices={white:100n,yellow:200n,blue:300n,red:400n,black:500n};
const route={saves:[],runs:[{}],points:100,seconds:60};
const key=calc.chainKey([]),draftRuns=new Map();
const nodes=new Map();
const row={dataset:{chain:key,timeMode:'recommend'},querySelector(s){if(!nodes.has(s)) nodes.set(s,{textContent:''});return nodes.get(s);}};
const context=vm.createContext({...calc,...fmt,draftRuns,priceMap:()=>prices,routeForKey:()=>route,floorsOf:()=>({score:6000}),form:{querySelectorAll:()=>[row]}});
vm.runInContext(functions,context);
function html(mode){return context.editorHtml(route,6000,mode);}
function value(h,n){return h.match(new RegExp('data-live="'+n+'">([^<]*)'))?.[1];}
let h=html('recommend');
assert.equal(value(h,'belt'),calc.formatDuration(3600));
assert.equal(value(h,'hour'),fmt.formatCount(calc.quoteBlackBelt(prices,route,60).hour));
draftRuns.set(key,120);
assert.equal(value(html('recommend'),'belt'),calc.formatDuration(3600));
assert.equal(value(html('actual'),'belt'),calc.formatDuration(7200));
context.paintLive(key);assert.equal(nodes.get("[data-live='belt']").textContent,calc.formatDuration(3600));
row.dataset.timeMode='actual';context.paintLive(key);assert.equal(nodes.get("[data-live='belt']").textContent,calc.formatDuration(7200));
draftRuns.clear();context.paintLive(key);assert.equal(nodes.get("[data-live='belt']").textContent,calc.formatDuration(3600));
delete prices.black;assert.equal(value(html('recommend'),'hour'),'시세 없음');
console.log('참고/실제 기준·남은시간·시간당메소·입력삭제 fallback·미입력시세 검증 통과');
