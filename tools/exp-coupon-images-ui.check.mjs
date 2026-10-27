import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try {for (const width of [1280,375]) {
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5513')return r.abort(); const f=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(f)?r.fulfill({body:readFileSync(f),contentType:/\.m?js$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html'}):r.fulfill({status:404,body:''});});
 await p.goto('http://127.0.0.1:5513/?mock=guest#/level-plan');await p.waitForSelector('.lp-coupon-icon');assert.equal(await p.locator('.lp-coupon-icon').count(),2);
 for(const n of [2,3]){const icon=p.locator(`.lp-coupon-icon[src="img/exp-coupon-${n}x.png"]`);assert.equal(await icon.evaluate(x=>x.complete&&x.naturalWidth>0),true);}
 const hunt=p.locator('.nav img[src="img/exp-coupon-3x.png"]');assert.equal(await hunt.count(),1);assert.equal(await hunt.evaluate(x=>x.complete&&x.naturalWidth>0),true);
 await p.locator('[data-step="exp_coupon"][data-delta="1"]').click();assert.equal(await p.locator('[name=exp_coupon]').inputValue(),'1');await p.locator('[data-step="exp_coupon_3"][data-delta="1"]').click();assert.equal(await p.locator('[name=exp_coupon_3]').inputValue(),'1');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.locator('.lp-coupons').screenshot({path:`/private/tmp/exp-coupons-${width}.png`});await p.goto('http://127.0.0.1:5513/#/dashboard');await p.waitForSelector('.ym-guest-tool');assert.equal(await p.locator('.ym-guest-tool img[src="img/exp-coupon-3x.png"]').count(),1);assert.deepEqual(errors,[]);console.log(`${width}px 2배/3배 이미지·메뉴/홈 아이콘·쿠폰 버튼·넘침/실행오류 없음 통과`);await p.close();
}}finally{await browser.close();}
