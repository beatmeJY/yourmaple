import {readFileSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/youl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=new URL('..',import.meta.url).pathname;
const itemId='e0000000-0000-4000-8000-000000000001';
const monsterId=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const items=Array.from({length:60},(_,n)=>({id:n===0?itemId:`e0000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,name:n===0?'청갑충':`아이템${n+1}`,category:'장비',required_level:n+1,image_url:n===0?'https://image.invalid/1.gif':null,description:'상세 설명',shop_sell_price:'100000',source_url:'https://example.com/item',source_id:String(n+1)}));
const monsters=Array.from({length:60},(_,n)=>({id:monsterId(n+1),name:`몬스터${n+1}`,level:n+1,hp:(n+1)*100,exp:(n+1)*10,required_accuracy:1,accuracy_per_level:0.1}));
const db={catalog_items:items,catalog_monsters:monsters,catalog_monster_drops:[0,1].map(n=>({id:'drop'+n,monster_id:monsterId(1),item_id:itemId,source_entry:n,rate_percent:n?'0.002':'0.008'})),catalog_item_stats:[{item_id:itemId,stat_key:'attack',base_value:34,minimum_value:30,maximum_value:38}],catalog_item_requirements:[{item_id:itemId,requirement_key:'dex',required_value:100}],catalog_item_jobs:[{item_id:itemId,job_name:'도적'}],catalog_item_source_attributes:[],catalog_changes:[{id:1,entity_id:itemId,entity_name:'청갑충',operation:'UPDATE',changes:{attack:{before:33,after:34}},changed_at:'2026-10-28T10:00:00Z'}]};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:5513')return route.abort();const file=root+(u.pathname==='/'?'/index.html':u.pathname);if(!existsSync(file))return route.fulfill({status:404,body:''});let body=readFileSync(file);if(u.pathname==='/js/dev-mock.js')body=body.toString().replace('  run() {','  run() { (window.catalogReads??=[]).push({table:this.table,filters:this.filters.length,limit:this.limitCount});').replace('async function rpc(name, args) {','async function rpc(name, args) { (window.catalogCalls??=[]).push({name,args});');return route.fulfill({body,contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'});});
 await page.addInitScript(data=>{localStorage.setItem('ym-mock-db',JSON.stringify(data));localStorage.setItem('ym-mock-auth','out');},db);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('http://127.0.0.1:5513/?mock=guest#/monsters');await page.waitForSelector('.mo-card');
 assert.equal(await page.locator('.mo-card').count(),24);
 await page.waitForSelector('.mo-drop-grid .mo-drop');assert.equal(await page.locator('.mo-drop-grid .mo-drop').count(),2);
 assert.deepEqual(await page.locator('.mo-drop-grid small').allTextContents(),['0.008%','0.002%']);
 assert.equal(await page.evaluate(()=>window.catalogCalls.filter(c=>c.name==='catalog_search_monsters').length),1);
 const reads=await page.evaluate(()=>window.catalogReads);assert(!reads.some(r=>r.table==='catalog_monsters'));assert(reads.filter(r=>r.table==='catalog_monster_drops').every(r=>r.filters>0));
 await page.locator('[data-page-next]').click();await page.waitForFunction(()=>document.querySelector('.mo-card .mo-name strong')?.textContent==='몬스터25');
 await page.locator('[data-search]').fill('몬스터59');await page.waitForFunction(()=>document.querySelectorAll('.mo-card').length===1);assert.match(await page.locator('.mo-card').innerText(),/몬스터59/);
 await page.locator('[data-search]').fill('');await page.waitForFunction(()=>document.querySelectorAll('.mo-card').length===24);await page.waitForSelector('.mo-drop-grid a');
 await page.evaluate(async()=>{
  const c=await(await import('/js/supabase-client.js')).getSupabase();const original=c.rpc;
  c.rpc=async(name,args)=>{
   if(name==='catalog_search_monsters'&&args.p_query==='느린검색'){await new Promise(r=>setTimeout(r,1000));return{data:{rows:[{id:'slow',name:'오래된 응답',level:1,hp:10,exp:1}],total:1,revision:1},error:null};}
   if(name==='catalog_search_monsters'&&args.p_query==='빠른검색')return{data:{rows:[{id:'fast',name:'최신 응답',level:1,hp:10,exp:1}],total:1,revision:1},error:null};
   if(name==='catalog_search_monsters'&&args.p_query==='오류검색')return{data:null,error:{message:'function catalog_search_monsters does not exist'}};
   return original(name,args);
  };
 });
 await page.locator('[data-search]').fill('느린검색');await page.waitForTimeout(350);
 await page.locator('[data-search]').fill('빠른검색');await page.waitForFunction(()=>document.querySelector('.mo-card .mo-name strong')?.textContent==='최신 응답');await page.waitForTimeout(1100);assert.match(await page.locator('.mo-card').innerText(),/최신 응답/);
 await page.locator('[data-search]').fill('오류검색');await page.waitForFunction(()=>document.querySelector('[data-list]').textContent.includes('SQL047'));
 await page.locator('[data-search]').fill('');await page.waitForFunction(()=>document.querySelectorAll('.mo-card').length===24);await page.waitForSelector('.mo-drop-grid a');
 await page.locator('.mo-drop-grid a').first().click();await page.waitForSelector('.catalog-stat');await page.waitForSelector('.catalog-image-fallback');
 assert.match(await page.locator('[data-item-detail]').innerText(),/청갑충/);assert.match(await page.locator('.catalog-stat').innerText(),/30 ~ 38/);assert.match(await page.locator('.catalog-item-hero').innerText(),/DEX 100.*도적/s);
 await page.waitForSelector('.catalog-change');assert.match(await page.locator('.catalog-change').innerText(),/33.*34/s);
 await page.screenshot({path:`/private/tmp/item-detail-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto('http://127.0.0.1:5513/?mock=guest#/item-catalog');await page.waitForSelector('.catalog-item');assert.equal(await page.locator('.catalog-item').count(),24);await page.locator('[data-next]').click();await page.waitForFunction(()=>document.querySelector('.catalog-pager [data-page]').textContent.startsWith('2 /'),null,{timeout:5000}).catch(async e=>{console.log(await page.locator('#main').innerText());console.log(await page.evaluate(()=>window.catalogCalls));throw e;});assert.equal(await page.locator('.catalog-item').count(),24);
 await page.locator('[data-catalog-search]').fill('아이템60');await page.waitForFunction(()=>document.querySelectorAll('.catalog-item').length===1);assert.match(await page.locator('.catalog-item').innerText(),/아이템60/);
 await page.goto('http://127.0.0.1:5513/?mock=guest#/catalog-updates');await page.waitForSelector('.catalog-change');assert.match(await page.locator('.catalog-change').innerText(),/청갑충/);
 await page.screenshot({path:`/private/tmp/catalog-history-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log(`${width}px: 목록24개·페이지/전체검색·선택드랍만조회·아이템범위/조건/이력·공개변경·넘침/오류없음 통과`);await page.close();
}}finally{await browser.close();}
