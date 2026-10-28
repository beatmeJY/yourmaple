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
