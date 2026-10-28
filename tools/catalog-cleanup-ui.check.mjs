import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/youl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=new URL('..',import.meta.url).pathname;
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:5513')return route.abort();const file=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(file)?route.fulfill({body:readFileSync(file),contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'}):route.fulfill({status:404,body:''});});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('http://127.0.0.1:5513/?mock=guest#/monsters');await page.waitForSelector('.mo-card');
 await page.evaluate(async()=>{
  const {getSupabase}=await import('/js/supabase-client.js');const client=await getSupabase(),original=client.from;
  client.from=table=>{const query=original(table);if(table==='catalog_monsters')query.range=async()=>({data:[{id:'mob',source_id:'7130104',name:'캡틴',level:70,hp:15000,exp:472},{id:'other',name:'다른 몬스터',level:2,hp:20,exp:5}],error:null});
   if(table==='catalog_monster_drops')query.range=async()=>({data:[{id:'1',monster_id:'mob',item_id:'item',source_entry:0,rate_percent:0.008,item:{id:'item',name:'청갑충'}},{id:'2',monster_id:'mob',item_id:'item',source_entry:1,rate_percent:0.002,item:{id:'item',name:'청갑충'}},{id:'3',monster_id:'mob',item_id:'otheritem',source_entry:2,rate_percent:null,item:{id:'otheritem',name:'미상 아이템'}}],error:null});return query;};
  const {render}=await import('/js/pages/monsters.js');await render(document.querySelector('#main'));
 });
 await page.locator('[data-pick-monster=mob]').click();
 assert.equal(await page.locator('.mo-drop-grid .mo-drop').count(),3);
 assert.deepEqual(await page.locator('.mo-drop-grid small').allTextContents(),['0.008%','0.002%','확률 미상']);
 assert.deepEqual(await page.locator('.mo-drop-grid .mo-drop > span').allTextContents(),['청갑충','청갑충','미상 아이템']);
 assert.equal(await page.locator('[data-open-import]').count(),0);
 await page.locator('[data-drop-search]').fill('청갑충');assert.equal(await page.locator('.mo-card').count(),1);
 await page.screenshot({path:`/private/tmp/catalog-cleanup-${width}.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log(`${width}px: FK 이름/확률·중복드랍·미상·검색·구등록버튼제거·넘침/오류없음 통과`);await page.close();
}}finally{await browser.close();}
