import assert from 'node:assert/strict';
import {catalogRpc,clearCatalogCache,monsterDrops,itemDropPage} from '../js/catalog-api.js';
let count=0;const client={async rpc(name,args){count++;return{data:{rows:[{id:args.id}],revision:1},error:null}}};
clearCatalogCache();await catalogRpc('catalog_search_items',{id:1},client);await catalogRpc('catalog_search_items',{id:1},client);assert.equal(count,1);
await catalogRpc('catalog_search_items',{id:2},client);assert.equal(count,2);clearCatalogCache();await catalogRpc('catalog_search_items',{id:1},client);assert.equal(count,3);
let filters=[];const dropsClient={from(table){assert.equal(table,'catalog_monster_drops');return{select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},async range(){return{data:[{id:'d1',item_id:'i',source_entry:0,rate_percent:0.008},{id:'d2',item_id:'i',source_entry:1,rate_percent:0.002}],error:null}}}}};
const drops=await monsterDrops('monster-id',dropsClient);assert.deepEqual(filters,[['monster_id','monster-id']]);assert.equal(drops.data.length,2);assert.equal(drops.data[1].rate_percent,0.002);
console.log('공용 응답 캐시 재사용/분리/초기화·선택 몬스터만조회·동일템복수확률 통과');

await assert.rejects(()=>catalogRpc("private_trades",{},client),/공용 도감/);

const pageFilters=[],ranges=[];
const pageClient={from(table){assert.equal(table,'catalog_monster_drops');return{select(columns){assert(columns.includes('monster:catalog_monsters'));return this},eq(k,v){pageFilters.push([k,v]);return this},order(){return this},async range(from,to){ranges.push([from,to]);return{data:Array.from({length:25},(_,n)=>({id:'d'+n,monster:{id:'same'},source_entry:n,rate_percent:n?0.002:0})),error:null}}}}};
const firstPage=await itemDropPage('selected-item',0,pageClient);assert.equal(firstPage.data.length,24);assert.equal(firstPage.hasMore,true);assert.equal(firstPage.data[0].rate_percent,0);assert.equal(firstPage.data[1].monster.id,firstPage.data[0].monster.id);
await itemDropPage('selected-item',1,pageClient);assert.deepEqual(ranges,[[0,24],[24,48]]);assert(pageFilters.every(([k,v])=>k==='item_id'&&v==='selected-item'));
const errorClient={from(){return{select(){return this},eq(){return this},order(){return this},async range(){return{data:null,error:{message:'조회 실패'}}}}}};
assert.equal((await itemDropPage('i',0,errorClient)).error.message,'조회 실패');
console.log('선택 아이템만조회·24+1 페이지·복수드랍/확률0 보존·오류 전달 통과');

const detailClient={async rpc(name,args){assert.equal(name,'catalog_monster_detail');assert.equal(args.p_id,'monster-1');return {data:{monster:{id:args.p_id,physical_attack:12}},error:null};}};
clearCatalogCache();assert.equal((await catalogRpc('catalog_monster_detail',{p_id:'monster-1'},detailClient)).data.monster.physical_attack,12);
const {catalogError}=await import('../js/catalog.js');assert(catalogError({message:'function catalog_monster_detail does not exist'}).includes('SQL052'));
console.log('몬스터 상세 RPC 허용·미설치SQL052 안내 통과');
