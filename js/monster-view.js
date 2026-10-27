import { hpPerExp, isBlank } from './monster-merge.js';

export function expPerHp(hp, exp) {
  if (isBlank(hp) || isBlank(exp)) return null;
  const health=Number(hp), experience=Number(exp);
  return Number.isFinite(health) && Number.isFinite(experience) && health>0 && experience>=0 ? experience/health : null;
}
export function formatExpPerHp(hp,exp) {
  const value=expPerHp(hp,exp);
  return value==null ? '-' : value.toLocaleString('ko-KR',{maximumSignificantDigits:6});
}
export function sortMonsterRows(rows,mode='level') {
  const level=row=>isBlank(row.level) || !Number.isFinite(Number(row.level)) ? Infinity : Number(row.level);
  const byLevel=(a,b)=>(level(a)-level(b)) || String(a.name ?? '').localeCompare(String(b.name ?? ''),'ko',{numeric:true}) || String(a.id ?? '').localeCompare(String(b.id ?? ''));
  return [...rows].sort((a,b)=>{
    if(mode!=='eff') return byLevel(a,b);
    const left=hpPerExp(a.hp,a.exp),right=hpPerExp(b.hp,b.exp);
    if(left==null && right==null) return byLevel(a,b);
    if(left==null) return 1;
    if(right==null) return -1;
    return left-right || byLevel(a,b);
  });
}
