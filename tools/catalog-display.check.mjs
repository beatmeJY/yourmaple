import assert from 'node:assert/strict';
import {changeCards} from '../js/catalog-history.js';
import {catalogImage,catalogMonsterImage} from '../js/catalog-image.js';
const html=changeCards([{entity_name:'<script>bad</script>',operation:'UPDATE',changed_at:'2026-10-28T00:00:00Z',changes:{base_options:{before:{attack:33,remaining_upgrades:7},after:{attack:34,remaining_upgrades:7}}}}]);
assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('33'));assert(html.includes('34'));assert(!html.includes('남은 강화 횟수'));
assert.equal(catalogImage('javascript:alert(1)'), '');
assert.equal(catalogImage('https://maplestory.io/a.gif'),catalogImage('https://maplestory.io/a.gif'));
assert(catalogImage('https://maplestory.io/a.gif').includes('loading="lazy"'));assert(catalogImage('https://maplestory.io/a.gif').includes('decoding="async"'));
console.log('이력 실제변경필드만 표시·HTML이스케이프·이미지HTTPS/고정URL/지연로딩 통과');

assert.match(catalogMonsterImage({source_id:'8810018',name:'혼테일'}), /img\/horntail.png/);
assert.match(catalogMonsterImage({source_id:'8888889',name:'카오스 자쿰'}), /img\/zakum.png/);
assert.equal(catalogMonsterImage({source_id:'8810018',name:'다른 몬스터'}), '');
assert.equal(catalogMonsterImage({source_id:'9420521',name:'크렉셀(1페이즈)'}), '');
assert.match(catalogMonsterImage({source_id:'8810018',name:'혼테일',image_url:'https://example.com/original.png'}), /https:\/\/example.com\/original.png/);
assert(!catalogMonsterImage({source_id:'8810018',name:'혼테일',image_url:'javascript:alert(1)'}).includes('javascript:'));
console.log('원본 이미지 우선·보스 ID/이름 일치 시 기존 공용 그림·미확인 몬스터 대체 금지 통과');

const {equipmentCard,isEquipment}=await import('../js/catalog-equipment.js');
const card=equipmentCard({item:{name:'<장비>',category:'방어구',required_level:0,shop_sell_price:'9007199254740993'},requirements:[{requirement_key:'str',required_value:0}],jobs:['공용'],stats:[{stat_key:'attack',base_value:0,minimum_value:0,maximum_value:2}]});
assert(isEquipment({category:'방어구'}));assert(!isEquipment({category:'소비'}));
assert(card.includes('&lt;장비&gt;'));assert(card.includes('9,007,199,254,740,993'));assert.equal((card.match(/is-allowed/g)||[]).length,5);
assert(card.includes('<dd>0</dd>'));assert(card.includes('<dd>미제공</dd>'));assert(card.includes('(0 ~ 2)'));assert(!card.includes('메랜지지'));
assert(!changeCards([{entity_name:'아이템',operation:'UPDATE',changes:{source_url:{before:'https://example.com/before',after:'https://example.com/after'}}}]).includes('example.com'));
console.log('장비 분류·공용 직업·0/미제공 구분·큰 메소 정밀도·범위·수집처 이력 비노출 통과');
