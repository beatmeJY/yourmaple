import { readItemRanges } from "./item-option-ranges.js";
import { escapeHtml } from "./format.js";
import { itemOptionFields, readItemOptions } from "./item-options.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { clearCatalogCache } from "./catalog-api.js";
import { mountSpeedPicker, speedPickerHtml } from "./attack-speed.js";
import { jobPickerHtml, mountJobPicker } from "./job-picker.js";
const esc = value => escapeHtml(String(value ?? ""));
const conditions = [["level","레벨"],["str","필요 STR"],["dex","필요 DEX"],["int","필요 INT"],["luk","필요 LUK"],["fame","인기도"]];
const input = (name,label,value,type="number") => `<label><span>${esc(label)}</span><input aria-label="${esc(label)}" name="${esc(name)}" type="${type}" ${type==="number"?'step="1"':''} value="${esc(value)}"></label>`;
export function itemEditForm(draft, ranges = {}) {
 return `<form data-item-edit-form>${input("name","아이템 이름",draft.name,"text")}<label><span>선택 · 보완한 설명</span><textarea aria-label="선택 · 보완한 설명" name="description" rows="4" maxlength="20000">${esc(draft.description)}</textarea></label><label><span>효과 설명</span><textarea aria-label="효과 설명" name="effect_description" rows="3" maxlength="20000">${esc(draft.effect_description)}</textarea></label><section><h3>기본 옵션 · 가능한 범위</h3><p class="hint">범위가 없으면 최소·최대 모두 비워 주세요. 0은 실제 값입니다.</p><div class="catalog-edit-stats"><div class="catalog-edit-stat-head"><span>옵션</span><span>기본값</span><span>최소</span><span>최대</span></div>${itemOptionFields.map(f=>`<div class="catalog-edit-stat-row"><span>${esc(f.label)}</span>${input(`stat:${f.key}`,`${f.label} 기본값`,draft.base_options?.[f.key])}${input(`min:${f.key}`,`${f.label} 최소`,ranges[f.key]?.min)}${input(`max:${f.key}`,`${f.label} 최대`,ranges[f.key]?.max)}</div>`).join("")}</div></section><section><h3>공격속도</h3><p class="hint">등급을 고르고 숫자를 알면 숫자도 고르세요. 매우 빠름 3·보통 6·매우 느림 9는 숫자가 정해져 있습니다.</p>${speedPickerHtml(draft.attack_speed_label)}</section><section><h3>장비 성장</h3>${input("level_up_count","레벨업 가능 횟수",draft.level_up_count)}<p class="hint">강화 횟수와 별개입니다. 미확인은 빈칸, 레벨업 불가는 0으로 입력하세요.</p></section><section><h3>착용 조건</h3><div class="catalog-edit-grid">${conditions.map(([k,label])=>input(`req:${k}`,label,draft.requirements?.[k])).join("")}</div><div class="catalog-edit-jobs"><span>착용 직업 · 여러 개 고를 수 있어요</span>${jobPickerHtml(draft.requirements?.["REQ JOB"])}</div>${input("req:GENDER","성별 제한",draft.requirements?.GENDER,"text")}</section><p class="hint">저장하면 공개 도감에 바로 반영됩니다. 입력한 기본값과 최소·최대 범위를 함께 저장합니다.</p><p data-edit-status role="status"></p><div data-close-warning hidden><p>저장하지 않은 변경을 버리고 닫을까요?</p><button type="button" class="mo-ghost" data-discard-edit>변경을 버리고 닫기</button></div><footer><button type="button" class="mo-ghost" data-close-edit>취소</button><button type="submit" class="primary-button">수정 저장 · 공개 반영</button></footer></form>`;
}
function readDraft(form) {
 const f=new FormData(form),values={};itemOptionFields.forEach(({key})=>values[key]=f.get(`stat:${key}`));
 const options=readItemOptions(values);if(options.error)throw new Error(options.error);
 const levelRaw=f.get("level_up_count").trim(),levelUpCount=levelRaw===""?null:Number(levelRaw);
 if(levelUpCount!==null&&(!Number.isSafeInteger(levelUpCount)||levelUpCount<0||levelUpCount>2147483647))throw new Error("레벨업 가능 횟수는 0 이상의 정수로 입력해 주세요.");
 const name=f.get("name").trim();if(!name||name.length>200)throw new Error("아이템 이름은 1~200자로 입력해 주세요.");
 const requirements={};for(const [key,label] of conditions){const raw=f.get(`req:${key}`).trim();if(!raw)continue;const n=Number(raw);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw new Error(`${label}은 0 이상의 정수로 입력해 주세요.`);requirements[key]=n;}
 for(const key of ["REQ JOB","GENDER"]){const raw=f.get(`req:${key}`).trim();if(raw)requirements[key]=raw;}
 const rangeValues={};itemOptionFields.forEach(({key})=>rangeValues[key]={min:f.get(`min:${key}`),max:f.get(`max:${key}`)});
 const ranges=readItemRanges(rangeValues,options.value);if(ranges.error)throw new Error(ranges.error);
 return {ranges:ranges.value,draft:{attack_speed_label:f.get("attack_speed_label").trim(),percent_options_supported:true,level_up_count:levelUpCount,name,description:f.get("description"),effect_description:f.get("effect_description"),base_options:options.value,requirements,review_note:""}};
}
export function mountItemEditor(button, root, id, onSaved) {
 button.setAttribute("aria-haspopup","dialog");let dialog;
 button.addEventListener("click",async()=>{
  if(dialog?.isConnected)return;
  dialog=document.createElement("dialog");dialog.className="catalog-edit-dialog ym-glass";dialog.setAttribute("aria-labelledby","catalog-edit-title");
  dialog.innerHTML='<header><h2 id="catalog-edit-title">아이템 수정</h2><button type="button" class="mo-ghost" data-close-edit aria-label="수정창 닫기">닫기</button></header><div data-edit-body><p class="hint">수정할 정보를 불러오는 중입니다.</p></div>';
  root.append(dialog);dialog.showModal();const active=dialog;let dirty=false,saving=false;
  const close=()=>{if(saving)return;if(dirty){active.querySelector('[data-close-warning]').hidden=false;return;}active.close();};
  active.addEventListener("close",()=>{active.remove();if(button.isConnected)button.focus();},{once:true});
  active.addEventListener("cancel",e=>{e.preventDefault();close();});
  active.addEventListener("click",e=>{if(e.target.closest('[data-discard-edit]')){dirty=false;close();}else if(e.target.closest('[data-close-edit]'))close();});
  active.addEventListener("input",()=>{dirty=true;const warning=active.querySelector('[data-close-warning]');if(warning)warning.hidden=true;});
  const result=await reviewRpc("catalog_item_edit_detail",{p_id:id});if(!active.isConnected||!active.open)return;
  const body=active.querySelector('[data-edit-body]');if(result.error||!result.data?.draft){body.innerHTML=`<p class="hint" role="alert">${esc(result.error?reviewError(result.error):"아이템을 찾을 수 없습니다.")}</p>`;return;}
  if(!result.data.ranges_supported||!result.data.level_up_supported||!result.data.percent_supported||!result.data.speed_supported){body.innerHTML='<p role="alert">장비 성장·증가율·공격속도 수정을 준비하려면 SQL062을 먼저 실행해 주세요.</p>';return;}
  body.innerHTML=itemEditForm(result.data.draft,result.data.ranges);mountSpeedPicker(body);mountJobPicker(body);
  active.addEventListener("submit",async e=>{
   e.preventDefault();if(saving)return;let draft;const status=active.querySelector('[data-edit-status]');
   try{draft=readDraft(active.querySelector('form'));}catch(error){status.textContent=error.message;return;}
   saving=true;status.textContent="공개 도감에 반영하고 있습니다.";active.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=true);
   const saved=await reviewRpc("catalog_item_edit_save",{p_id:id,p_version:result.data.version,p_draft:draft.draft,p_ranges:draft.ranges});saving=false;if(!active.isConnected)return;
   if(saved.error){active.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=false);status.textContent=reviewError(saved.error);return;}
   clearCatalogCache();dirty=false;active.close();if(root.isConnected)await onSaved();
  });
 });
}
