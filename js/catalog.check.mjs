import assert from 'node:assert/strict';
import { loadCatalog, catalogError } from './catalog.js';
const calls=[];
const rows=Array.from({length:1205},(_,id)=>({id}));
const fake={
  from(table){
    assert.equal(table,'catalog_items');
    return {
      select(){return this},
      order(){return this},
      async range(a,b){calls.push([a,b]);return {data:rows.slice(a,b+1),error:null}}
    };
  }
};
const result=await loadCatalog('catalog_items','*',fake);
assert.equal(result.data.length,1205);
assert.deepEqual(calls,[[0,499],[500,999],[1000,1499]]);
await assert.rejects(()=>loadCatalog('trades','*',fake),/알 수 없는/);
const broken={
  from(){return {
    select(){return this},order(){return this},
    range(){return {data:null,error:{message:'catalog_items does not exist'}}}
  }}
};
assert.match(catalogError((await loadCatalog('catalog_items','*',broken)).error),/038/);
console.log('공용 도감: 페이지별 전체 조회·허용 표 제한·SQL 미적용 안내 통과');
