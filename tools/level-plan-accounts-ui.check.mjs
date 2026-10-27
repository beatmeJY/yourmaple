import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try {for (const width of [1280,375]) {
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5513')return r.abort(); const f=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(f)?r.fulfill({body:readFileSync(f),contentType:/\.m?js$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html'}):r.fulfill({status:404,body:''});});
 await p.goto('http://127.0.0.1:5513/?mock#/level-plan'); await p.waitForSelector('[data-account-pick]');
 const account=id=>p.locator(`[data-account-pick$="${id}"]`);const char=id=>p.locator(`[data-character-pick$="${id}"]`);
 assert.equal(await account('001').getAttribute('aria-pressed'),'true'); assert.equal(await char('001').getAttribute('aria-pressed'),'true');assert.equal(await char('004').count(),0);assert.equal(await p.locator('[name=from_level]').inputValue(),'118');
 await account('002').click(); assert.equal(await char('001').count(),0);assert.equal(await char('004').count(),1);await char('004').click();assert.equal(await p.locator('[name=from_level]').inputValue(),'88');
 await p.locator('[name=to_level]').fill('100');await p.reload();await p.waitForSelector('[data-account-pick]');assert.equal(await account('002').getAttribute('aria-pressed'),'true');assert.equal(await char('004').getAttribute('aria-pressed'),'true');assert.equal(await p.locator('[name=to_level]').inputValue(),'100');
 await p.locator('[data-character-pick=""]').click();await p.locator('[name=from_level]').fill('60');await p.reload();await p.waitForSelector('[data-account-pick]');assert.equal(await p.locator('[name=from_level]').inputValue(),'60');assert.equal(await account('002').getAttribute('aria-pressed'),'true');
 await p.evaluate(()=>{sessionStorage.removeItem("yourmaple.huntPlan");const d=JSON.parse(localStorage.getItem('ym-mock-db'));d.profiles[0].main_character_id=d.characters[3].id;d.accounts.push({id:'empty',name:'빈 계정'});d.characters.push({...d.characters[0],id:'loose',account_id:null,name:'미지정'});localStorage.setItem('ym-mock-db',JSON.stringify(d));});
 await p.reload();await p.waitForSelector('[data-account-pick]');assert.equal(await account('002').getAttribute('aria-pressed'),'true');assert.equal(await char('004').getAttribute('aria-pressed'),'true');await account('empty').click();assert.match(await p.locator('[data-character-chips]').innerText(),/캐릭터가 없어요/);await account('unassigned').click();assert.equal(await char('loose').count(),1);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.locator('.lp-hero').screenshot({path:`/private/tmp/level-plan-accounts-${width}.png`});
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.lp-characters').evaluate(x=>getComputedStyle(x).animationName),'none');
 await p.goto('http://127.0.0.1:5513/?mock=guest#/level-plan');await p.waitForSelector('[data-character-pick=""]');assert.equal(await p.locator('[data-account-pick]').count(),0);assert.deepEqual(errors,[]);console.log(`${width}px 대표 계정/캐릭터·계정 전환·입력 복원·빈 계정·미지정·게스트·모션 축소·넘침 없음 통과`);await p.close();
}} finally {await browser.close();}
