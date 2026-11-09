import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try {for (const width of [1280,375]) {
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5513')return r.abort(); const f=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(f)?r.fulfill({body:readFileSync(f),contentType:/\.m?js$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html'}):r.fulfill({status:404,body:''});});
 await p.goto('http://127.0.0.1:5513/?mock#/hunts');await p.waitForSelector('[data-timer-character] option[value]:not([value=""])', {state:'attached'});assert.equal(await p.locator('[data-predict]').count(),0);
 await p.locator('[data-measured-minutes="15"]').click();assert.equal(await p.locator('[data-clock]').innerText(),'15:00');
 await p.locator('[data-timer-field="title"]').fill('15분 실측');await p.locator('[data-timer-field="exp"]').fill('100000');await p.locator('[data-timer-field="meso"]').fill('20000');await p.locator('[data-timer-field="potion"]').fill('3000');await p.locator('[data-timer-field="leech"]').fill('-5000');
 // 캐릭터를 골랐으면 기록 남기기로 바로 저장한다(확인 폼 없음). 알림의 되돌리기로 지우고 값을 돌려놓은 뒤 다시 저장한다.
 await p.locator('[data-timer-finish]').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('ym-mock-db')).hunts.some(x=>x.title==='15분 실측'));assert.equal(await p.locator('[data-hunt-form-panel]').isHidden(),true);assert.equal(await p.locator('[data-clock]').innerText(),'00:00');
 await p.locator('.toast-action').click();await p.waitForFunction(()=>!JSON.parse(localStorage.getItem('ym-mock-db')).hunts.some(x=>x.title==='15분 실측'));assert.equal(await p.locator('[data-clock]').innerText(),'15:00');assert.equal((await p.locator('[data-timer-field="exp"]').inputValue()).replaceAll(',',''),'100000');
 await p.locator('[data-timer-finish]').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('ym-mock-db')).hunts.filter(x=>x.title==='15분 실측').length===1);const row=await p.evaluate(()=>JSON.parse(localStorage.getItem('ym-mock-db')).hunts.find(x=>x.title==='15분 실측'));assert.equal(row.exp_per_hour,'400000');assert.equal(row.meso_per_hour,'80000');assert.equal(row.leech_fee,'-20000');assert.equal(row.potion_cost,'12000');
 await p.locator('[data-measured-minutes="30"]').click();assert.equal(await p.locator('[data-clock]').innerText(),'30:00');await p.locator('[data-measured-minutes="60"]').click();assert.equal(await p.locator('[data-clock]').innerText(),'1:00:00');await p.locator('[data-measured-time]').fill('45');await p.locator('[data-measured-time]').dispatchEvent('change');assert.equal(await p.locator('[data-clock]').innerText(),'45:00');
 await p.reload();await p.waitForSelector('[data-timer-character]');assert.equal(await p.locator('[data-clock]').innerText(),'45:00');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(`${width}px 예측 제거·15/30/60/직접시간·비용 포함 시간당 환산·바로 저장/되돌리기/재조회·넘침 없음 통과`);await p.locator('[data-timer]').screenshot({path:`/private/tmp/hunt-measurements-${width}.png`});await p.close();
}}finally{await browser.close();}
