import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try {for (const width of [1280,375]) {
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5513')return r.abort(); const f=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(f)?r.fulfill({body:readFileSync(f),contentType:/\.m?js$/.test(f)?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html'}):r.fulfill({status:404,body:''});});
 await p.emulateMedia({reducedMotion:'reduce'});await p.goto('http://127.0.0.1:5513/?mock#/dojo');await p.waitForSelector('[data-belt-detail]');const icons=p.locator('[data-belts] [data-belt-detail]');assert.equal(await icons.count(),5);
 for(let i=0;i<5;i++){const icon=icons.nth(i);await icon.scrollIntoViewIfNeeded();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await icon.focus();await p.waitForFunction(()=>{const t=document.querySelector('#dojo-belt-tip');const img=t.querySelector('img');return !t.hidden&&img.complete&&img.naturalWidth>0;});const img=p.locator('#dojo-belt-tip img');assert.match(await img.getAttribute('src'),/-detail-transparent.png$/);const box=await p.locator('#dojo-belt-tip').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=900);}
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(`${width}px 상세이미지5종 로딩·포커스표시·화면경계·넘침/오류없음 통과`);await p.close();
}}finally{await browser.close();}
