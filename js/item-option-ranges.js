import { itemOptionFields } from "./item-options.js";
export function readItemRanges(values, options) {
 const ranges={};
 for(const {key,label} of itemOptionFields){
  const low=String(values[key]?.min??"").trim(),high=String(values[key]?.max??"").trim();
  if(!low&&!high)continue;
  const min=Number(low),max=Number(high);
  if(!low||!high||!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||Math.abs(min)>2147483647||Math.abs(max)>2147483647||options[key]==null||min>options[key]||max<options[key])
   return {error:`${label}: 기본값을 입력하고 최소 ≤ 기본값 ≤ 최대인 정수 범위를 넣어 주세요.`};
  ranges[key]={min,max};
 }
 return {value:ranges};
}
