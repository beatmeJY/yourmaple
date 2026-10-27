import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try {for (const width of [1280,375]) {
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5513')return r.abort(); const f=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(f)?r.fulfill({body:readFileSync(f),contentType:/\.m?js$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html'}):r.fulfill({status:404,body:''});});
 await p.goto('http://127.0.0.1:5513/?mock=guest#/dashboard');await p.waitForSelector('[data-home-oauth="google"]');
 const google=p.locator('[data-home-oauth="google"]'), discord=p.locator('[data-home-oauth="discord"]');
 assert.equal(await google.locator('svg').count(),1);assert.equal(await discord.locator('svg').count(),1);assert.notEqual(await google.evaluate(x=>getComputedStyle(x).backgroundColor),await discord.evaluate(x=>getComputedStyle(x).backgroundColor));
 await p.evaluate(async()=>{const {getSupabase}=await import('/js/supabase-client.js');const c=await getSupabase();window.calls=[];c.auth.signInWithOAuth=async args=>{window.calls.push(args);await new Promise(r=>setTimeout(r,250));return {error:{message:'network error'}};};});
 await google.click();assert.equal(await discord.isDisabled(),true);await p.waitForFunction(()=>!document.querySelector('[data-home-oauth="google"]').disabled);assert.equal(await p.evaluate(()=>window.calls[0].provider),'google');assert.equal(await p.evaluate(()=>window.calls[0].options.redirectTo),'http://127.0.0.1:5513/');
 await p.evaluate(async()=>{const c=await (await import('/js/supabase-client.js')).getSupabase();c.auth.signInWithOAuth=async args=>{window.calls.push(args);return {error:null};};});
 await discord.click();assert.equal(await p.evaluate(()=>window.calls[1].provider),'discord');assert.equal(await google.isDisabled(),true);assert.equal(await discord.getAttribute('aria-busy'),'true');assert.equal(await p.locator('.auth-screen').count(),0);
 assert.equal(await p.locator('.ym-guest-legal a').count(),2);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.locator('.ym-guest-hero').screenshot({path:`/private/tmp/home-social-login-${width}.png`});assert.deepEqual(errors,[]);console.log(`${width}px 서비스별 로고/색상·직접 OAuth 호출·오류 재시도·중복 방지·약관·넘침 없음 통과`);await p.close();
}} finally {await browser.close();}
