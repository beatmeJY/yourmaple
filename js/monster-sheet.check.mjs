import assert from 'node:assert/strict';
import {parseMonsterSheet, classifyMonsterRows, monsterExample, readMonsterText, readMonsterFile} from './monster-sheet.js';
import * as XLSX from './vendor/xlsx-0.20.3.mjs';
const parsed=parseMonsterSheet(monsterExample);
assert.deepEqual(parsed.errors,[]); assert.equal(parsed.rows.length,5);assert.equal(parsed.rows[2].drop_items,null);
assert.equal(parsed.rows[3].drop_items,'신민10 망행100 금');assert.ok(!('hp_per_exp' in parsed.rows[4]));
for(const value of ['', 'abc','-1','2.2','1e3',Number.MAX_SAFE_INTEGER+1]) {
 const bad=structuredClone(monsterExample);bad[1][2]=value;assert.ok(parseMonsterSheet(bad).errors.length);
}
let bad=structuredClone(monsterExample);bad.push(['스 포 아',2,20,5,0,4,'망체60']);assert.ok(parseMonsterSheet(bad).errors.some(x=>x.includes('중복')));
bad=structuredClone(monsterExample);bad[0][2]='경험치';assert.ok(parseMonsterSheet(bad).errors.length);
const classified=classifyMonsterRows(parsed.rows,[{...parsed.rows[0],hp:'20'},{...parsed.rows[1],hp:99}]);
assert.deepEqual(classified.map(r=>r.status),['same','conflict','new','new','new']);
assert.equal(parseMonsterSheet(await readMonsterText(monsterExample.map(r=>r.join('\t')).join('\n'))).rows.length,5);
assert.equal(parseMonsterSheet(await readMonsterText('몹 이름,레벨,HP,경험치,명중률,드랍 템\n"돼지",7,75,15,0,"신민10, 금"')).rows[0].drop_items,'신민10, 금');
const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(monsterExample);XLSX.utils.book_append_sheet(wb,ws,'몬스터');
const buffer=()=>XLSX.write(wb,{type:'array',bookType:'xlsx'});
const file=()=>({name:'monsters.xlsx',size:1000,arrayBuffer:async()=>buffer()});
assert.equal(parseMonsterSheet(await readMonsterFile(file())).rows.length,5);
ws.F2={t:'n',f:'C2/D2',v:4};assert.equal((await readMonsterFile(file())).length,6);
ws.C2={t:'n',f:'1+1',v:2};await assert.rejects(()=>readMonsterFile(file()),/수식/);
await assert.rejects(()=>readMonsterFile({name:'a.xlsx',size:3*1024*1024}),/2MB/);
assert.ok(parseMonsterSheet([monsterExample[0],...Array(501).fill(monsterExample[1])]).errors.length);
console.log('몬스터 표: 예시5행·0/빈값·소수/범위·열/이름중복·충돌분류·CSV/TSV/XLSX·수식/크기제한 통과');
