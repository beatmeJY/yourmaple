import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('..',import.meta.url).pathname;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try {for(const width of [1280,375]) {
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:5513')return route.abort();const file=root+(u.pathname==='/'?'/index.html':u.pathname);return existsSync(file)?route.fulfill({body:readFileSync(file),contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'}):route.fulfill({status:404,body:''});});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('http://127.0.0.1:5513/?mock=guest#/monsters');await page.waitForSelector('.mo-card');assert.equal(await page.locator('[data-open-import]').count(),0);
 await page.evaluate(async()=>{
  const {getSupabase}=await import('/js/supabase-client.js');const client=await getSupabase(),original=client.from;
  client.from=table=>{const query=original(table);if(table==='catalog_monsters') query.range=async()=>({data:[{id:'test-pig',name:'돼지',level:7,hp:75,exp:15,required_accuracy:0,drop_items:'신민10 망행100 금'}, {id:'high',name:'레벨100',level:100,hp:100,exp:100}, {id:'low',name:'레벨2',level:2,hp:20,exp:5}, {id:'ten',name:'레벨10',level:10,hp:100,exp:10}],error:null});return query;};
  const {render}=await import('/js/pages/monsters.js');await render(document.querySelector('#main'));
 });
 assert.deepEqual(await page.locator('.mo-card .mo-name strong').allTextContents(),['레벨2','돼지','레벨10','레벨100']);
 await page.locator('[data-pick-monster="test-pig"]').click();
 assert.deepEqual(await page.locator('.mo-drop-grid .mo-drop').allTextContents(),['신신민10','망망행100','금금']);
 assert.match(await page.locator('[data-mo-detail]').innerText(),/1 HP당 EXP\s*0.2/);
 assert.match(await page.locator('[data-pick-monster="test-pig"]').innerText(),/1 HP당 EXP\s*0.2/);
 await page.locator('[data-sort-mode=eff]').click();assert.equal(await page.locator('.mo-card .mo-name strong').first().innerText(),'레벨100');
 await page.locator('[data-sort-mode=level]').click();assert.equal(await page.locator('.mo-card .mo-name strong').first().innerText(),'레벨2');
 await page.locator('[data-drop-search]').fill('금');assert.equal(await page.locator('.mo-card').count(),1);
 await page.locator('[data-drop-search]').fill('없는드랍');assert.equal(await page.locator('.mo-card').count(),0);
 await page.goto('http://127.0.0.1:5513/?mock#/monsters');await page.waitForSelector('.mo-card');assert.equal(await page.locator('[data-open-import]').count(),0);
 // 실제 인증을 대신하지 않는 UI 전용 권한 응답을 주입합니다.
 await page.evaluate(async()=>{
  const {getSupabase}=await import('/js/supabase-client.js');const client=await getSupabase();
  window.savedPayload=null;window.failSave=false;window.allowImport=true;
  client.rpc=async(name,args)=>{
   if(name==='can_import_catalog_monsters')return {data:window.allowImport,error:null};
   if(name==='import_catalog_monsters'){
    if(window.failSave)return {data:null,error:{message:'등록 권한이 없습니다.'}};
    window.savedPayload=args.rows;
    return {data:{inserted:args.rows.length-1,filled:1,unchanged:0,conflicts:[]},error:null};
   }
   return {data:null,error:null};
  };
  const {mountMonsterImport}=await import('/js/monster-import.js');
  await mountMonsterImport(document.querySelector('#main'),async()=>{},()=>[{name:'스포아',level:2,hp:20,exp:5,required_accuracy:0,drop_items:'망체60'},{name:'스텀프',level:4,hp:99,exp:8,required_accuracy:0,drop_items:'망체10'},{name:'돼지',level:7,hp:75,exp:15,required_accuracy:0,drop_items:null}]);
 });
 await page.locator('[data-open-import]').click();await page.locator('[data-example]').click();
 assert.match(await page.locator('[data-import-preview]').innerText(),/신규 2 · 드랍 채우기 1 · 동일 1 · 보류 1/);
 assert.equal(await page.locator('[data-save-import]').isEnabled(),true);
 assert.deepEqual(await page.locator('.mi-drop-item').allTextContents(),['망체60','망체10','신민10','망행100','금','신점10','흰색고무신']);
 await page.locator('[data-import-text]').fill('잘못된 열');assert.equal(await page.locator('[data-save-import]').isDisabled(),true);
 await page.locator('[data-preview-text]').click();await page.waitForFunction(()=>document.querySelector('[data-import-preview]').textContent.includes('필수 열'));
 // 실제 xlsx 파일을 브라우저에서 생성해 업로드 판독 경로도 확인합니다.
 const bytes=await page.evaluate(async()=>{const X=await import('/js/vendor/xlsx-0.20.3.mjs');const {monsterExample}=await import('/js/monster-sheet.js');const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(monsterExample),'몬스터');return [...new Uint8Array(X.write(b,{type:'array',bookType:'xlsx'}))];});
 await page.locator('[data-import-file]').setInputFiles({name:'monsters.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
 await page.waitForFunction(()=>document.querySelector('[data-import-preview]').textContent.includes('신규 2'));
 await page.evaluate(()=>window.failSave=true);await page.locator('[data-save-import]').click();await page.waitForFunction(()=>document.querySelector('[data-import-result]').textContent.includes('권한'));
 assert.equal(await page.evaluate(()=>window.savedPayload),null);assert.equal(await page.locator('[data-save-import]').isEnabled(),true);
 await page.evaluate(()=>window.failSave=false);await page.locator('[data-save-import]').click();await page.waitForFunction(()=>document.querySelector('[data-import-result]').textContent.includes('2개 등록 · 1개 드랍 채움'));
 assert.equal((await page.evaluate(()=>window.savedPayload)).length,3);assert.equal(await page.locator('[data-save-import]').isDisabled(),true);
 await page.locator('[data-example]').click();await page.screenshot({path:`/private/tmp/monster-import-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 assert.equal(await page.locator('dialog').evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.locator('[data-close-import]').click();assert.equal(await page.locator('dialog').isVisible(),false);
 assert.deepEqual(errors,[]);console.log(`${width}px: 비로그인/일반 버튼없음·운영자 미리보기·XLSX업로드·충돌/동일제외·권한실패/재시도·오버플로/모션축소 통과`);
 await page.close();
}}finally{await browser.close();}
