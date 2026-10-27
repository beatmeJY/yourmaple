import {readFileSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');const root=new URL('..',import.meta.url).pathname;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try{for(const width of [1280,375]){
const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5513')return r.abort();const f=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(f)?r.fulfill({body:readFileSync(f),contentType:/\.m?js$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html'}):r.fulfill({status:404,body:''});});
await p.emulateMedia({reducedMotion:'reduce'});await p.goto('http://127.0.0.1:5513/?mock#/homework');await p.waitForSelector('[data-task-card="monster-park"]');
await p.evaluate(async()=>{const {getSupabase}=await import('/js/supabase-client.js');const client=await getSupabase();const {data}=await client.from('characters').select('id,level');await client.from('characters').update({level:data[0].level}).eq('id',data[0].id);const d=JSON.parse(localStorage.getItem('ym-mock-db'));const c=d.characters[0];d.characters=[49,50,129,130].map((level,i)=>({...c,id:`c0000000-0000-4000-8000-00000000000${i+1}`,name:`레벨${level}`,level}));d.homework_members=d.homework_members.filter(x=>x.task_key!=='monster-park');d.homework_checks=d.homework_checks.filter(x=>x.task_key!=='monster-park');localStorage.setItem('ym-mock-db',JSON.stringify(d));});
await p.reload();await p.waitForSelector('[data-task-card="monster-park"]');await p.addStyleTag({content:'.mock-badge{display:none!important}'});
const card=p.locator('[data-task-card="monster-park"]');assert.match(await card.innerText(),/50~129레벨 · 하루 2회 · 매일 00시/);
assert.equal(await card.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0),true);
await card.locator('[data-manage]').click();assert.equal(await card.locator('[data-enable]').count(),2);
await card.locator('[data-enable][data-character$="002"]').locator('..').click();await card.locator('[data-enable][data-character$="003"]').locator('..').click();await card.locator('[data-manage]').click();
assert.equal(await card.locator('[data-check]').count(),2);
const cell=()=>card.locator('[data-check][data-character$="002"]');await cell().click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('ym-mock-db')).homework_checks.some(x=>x.task_key==='monster-park'));
assert.equal(await cell().getAttribute('aria-pressed'),'true');
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('ym-mock-db')).homework_checks.filter(x=>x.task_key==='monster-park'));assert.equal(saved.length,1);
// 캐릭터 카드와 같은 요약 함수도 완료/미완료와 레벨 범위를 공유합니다.
const status=await p.evaluate(async()=>{const {getSupabase}=await import('/js/supabase-client.js');const {loadHomeworkStatus}=await import('/js/homework-status.js');const f=await loadHomeworkStatus(await getSupabase());return [1,2,3,4].map(i=>f(`c0000000-0000-4000-8000-00000000000${i}`).filter(x=>x.key==='monster-park'));});
assert.equal(status[0].length,0);assert.equal(status[1][0].done,true);assert.equal(status[2][0].done,false);assert.equal(status[3].length,0);
await p.reload();await p.waitForSelector('[data-check="monster-park"]');assert.equal(await cell().getAttribute('aria-pressed'),'true');
await card.screenshot({path:`/private/tmp/monster-park-${width}.png`});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
// 어제 기록은 다음 날의 완료로 보지 않습니다.
await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('ym-mock-db'));const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);for(const x of d.homework_checks.filter(x=>x.task_key==='monster-park'))x.checked_at=yesterday.toISOString();localStorage.setItem('ym-mock-db',JSON.stringify(d));});
await p.reload();await p.waitForSelector('[data-check="monster-park"]');assert.equal(await cell().getAttribute('aria-pressed'),'false');
assert.deepEqual(errors,[]);console.log(`${width}px: 새 그림·50/129 선택·49/130 제외·1체크 저장/재조회·캐릭터칩 공유·다음날 초기화·넘침없음 통과`);await p.close();
}}finally{await browser.close()}
