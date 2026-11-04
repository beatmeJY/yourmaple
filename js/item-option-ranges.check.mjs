import assert from 'node:assert/strict';
import {readItemRanges} from './item-option-ranges.js';
assert.deepEqual(readItemRanges({},{}).value,{});
assert.deepEqual(readItemRanges({attack:{min:'100',max:'110'}},{attack:105}).value,{attack:{min:100,max:110}});
assert.deepEqual(readItemRanges({str:{min:'0',max:'0'}},{str:0}).value,{str:{min:0,max:0}});
assert.deepEqual(readItemRanges({str:{min:'-2',max:'2'}},{str:0}).value,{str:{min:-2,max:2}});
for(const [range,options] of [[{min:'100',max:''},{attack:105}],[{min:'120',max:'110'},{attack:105}],[{min:'100.5',max:'110'},{attack:105}],[{min:'0',max:'10'},{}],[{min:'-2147483648',max:'10'},{attack:0}],[{min:'1',max:'4'},{attack:5}]])assert(readItemRanges({attack:range},options).error);
console.log('옵션 범위 검사 10개 통과: 빈값/정수/0/음수/한쪽누락/역전/기본값포함');
