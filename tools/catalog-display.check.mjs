import assert from 'node:assert/strict';
import {changeCards} from '../js/catalog-history.js';
import {catalogImage} from '../js/catalog-image.js';
const html=changeCards([{entity_name:'<script>bad</script>',operation:'UPDATE',changed_at:'2026-10-28T00:00:00Z',changes:{base_options:{before:{attack:33,remaining_upgrades:7},after:{attack:34,remaining_upgrades:7}}}}]);
assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('33'));assert(html.includes('34'));assert(!html.includes('남은 강화 횟수'));
assert.equal(catalogImage('javascript:alert(1)'), '');
assert.equal(catalogImage('https://maplestory.io/a.gif'),catalogImage('https://maplestory.io/a.gif'));
assert(catalogImage('https://maplestory.io/a.gif').includes('loading="lazy"'));assert(catalogImage('https://maplestory.io/a.gif').includes('decoding="async"'));
console.log('이력 실제변경필드만 표시·HTML이스케이프·이미지HTTPS/고정URL/지연로딩 통과');
