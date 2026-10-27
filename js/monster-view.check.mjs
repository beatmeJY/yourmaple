import assert from 'node:assert/strict';
import { expPerHp,formatExpPerHp,sortMonsterRows } from './monster-view.js';
assert.equal(expPerHp(20,5),.25);assert.equal(expPerHp(80,15),.1875);assert.equal(expPerHp(75,15),.2);assert.equal(expPerHp(20,0),0);
for(const hp of [0,null,'',-1,'bad']) assert.equal(expPerHp(hp,5),null);
assert.equal(formatExpPerHp(80,15),'0.1875');assert.equal(formatExpPerHp(0,5),'-');assert.notEqual(formatExpPerHp(1e10,1),'0');
const rows=[{id:'a',level:'100',name:'백',hp:100,exp:100},{id:'b',level:2,name:'둘',hp:20,exp:5},{id:'c',level:'10',name:'열',hp:100,exp:10},{id:'d',level:null,name:'미정',hp:null,exp:null}];
assert.deepEqual(sortMonsterRows(rows).map(r=>r.id),['b','c','a','d']);assert.deepEqual(sortMonsterRows(rows,'eff').map(r=>r.id),['a','b','c','d']);assert.equal(rows[0].id,'a');
console.log('몬스터 표시: 숫자 레벨순/효율순·미정 뒤로·원본불변·HP당EXP/0/누락/소수정밀도 통과');
