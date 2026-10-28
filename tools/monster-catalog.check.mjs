import assert from 'node:assert/strict';
import {catalogRpc,clearCatalogCache,monsterDrops} from '../js/catalog-api.js';
let count=0;const client={async rpc(name,args){count++;return{data:{rows:[{id:args.id}],revision:1},error:null}}};
clearCatalogCache();await catalogRpc('catalog_search_items',{id:1},client);await catalogRpc('catalog_search_items',{id:1},client);assert.equal(count,1);
await catalogRpc('catalog_search_items',{id:2},client);assert.equal(count,2);clearCatalogCache();await catalogRpc('catalog_search_items',{id:1},client);assert.equal(count,3);
let filters=[];const dropsClient={from(table){assert.equal(table,'catalog_monster_drops');return{select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},async range(){return{data:[{id:'d1',item_id:'i',source_entry:0,rate_percent:0.008},{id:'d2',item_id:'i',source_entry:1,rate_percent:0.002}],error:null}}}}};
const drops=await monsterDrops('monster-id',dropsClient);assert.deepEqual(filters,[['monster_id','monster-id']]);assert.equal(drops.data.length,2);assert.equal(drops.data[1].rate_percent,0.002);
console.log('공용 응답 캐시 재사용/분리/초기화·선택 몬스터만조회·동일템복수확률 통과');

await assert.rejects(()=>catalogRpc("private_trades",{},client),/공용 도감/);
