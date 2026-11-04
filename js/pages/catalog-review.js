import { clearCatalogCache } from "../catalog-api.js";
import { reviewSections } from "../catalog-review-sections.js";
import { escapeHtml } from "../format.js";
import { itemOptionFields, readItemOptions } from "../item-options.js";
import { catalogImage, mountCatalogImageFallback } from "../catalog-image.js";
import { reviewRpc, canReviewCatalog, reviewError } from "../catalog-review.js";

const esc = value => escapeHtml(String(value ?? ""));
const requirements = [["level","착용 레벨"],["str","필요 STR"],["dex","필요 DEX"],["int","필요 INT"],["luk","필요 LUK"],["fame","필요 인기도"]];
const valueText = value => Array.isArray(value) ? value.join(" · ") : String(value ?? "미제공");
export async function render(root) {
  root.innerHTML = `<section class="catalog-page"><p class="empty">검토 권한을 확인하는 중입니다.</p></section>`;
  if (!await canReviewCatalog()) {
    if (root.isConnected) root.innerHTML = `<section class="catalog-page"><h1>비공개 검토 보관함</h1><p class="empty">지정된 Google 운영자 계정으로 로그인해 주세요.</p><a href="#/item-catalog">공개 도감으로 돌아가기</a></section>`;
    return;
  }
  if (!root.isConnected) return;
  mountCatalogImageFallback(root);
  root.innerHTML = `<section class="catalog-page review-page"><header class="ym-page-head"><div><span class="ym-chip">운영자 전용 · 비공개</span><h1>아이템 검토 보관함</h1><p>설명을 골라 보완한 뒤 공개 도감에 반영하세요.</p></div><a href="#/item-catalog" class="mo-ghost">공개 도감</a></header><p class="review-private-note">‘초안 저장’은 비공개로 보관합니다. ‘검토 완료 · 공개 반영’을 누르면 수정한 아이템이 모든 사용자에게 공개됩니다.</p><div class="review-filters"><label class="field"><span>이름 · 아이템 ID</span><input data-search aria-label="이름 · 아이템 ID" maxlength="100" placeholder="검토할 아이템 찾기"></label><label class="field"><span>검토 사유</span><select data-kind aria-label="검토 사유"><option value="">전체</option><option value="unverified">확인 필요</option><option value="different">수치 차이</option></select></label><label class="field"><span>진행 상태</span><select data-status aria-label="진행 상태"><option value="">전체</option><option value="draft">검토 중</option><option value="ready">검토 완료</option><option value="deleted">삭제한 아이템</option></select></label><button class="mo-ghost" type="button" data-retry>새로 확인</button></div><p class="hint" data-count aria-live="polite"></p><div class="review-layout"><aside class="ym-glass review-list-panel"><div data-list></div><nav class="catalog-pager" aria-label="검토 목록 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></aside><section class="review-editor ym-glass" data-editor><p class="empty">왼쪽 목록에서 아이템을 골라 주세요.</p></section></div></section>`;
  let page = 0, listId = 0, detailId = 0, timer, current = null, dirty = false, saving = false, pendingId = null;
  const editor = root.querySelector("[data-editor]");
  const status = message => { const node = editor.querySelector("[data-save-state]"); if (node) node.textContent = message; };
  const markDirty = () => { dirty = true; status("저장하지 않은 변경이 있습니다."); };
  async function loadList() {
    const request = ++listId;
    root.querySelectorAll(".catalog-pager button").forEach(b => b.disabled = true);
    const result = await reviewRpc("catalog_review_list", {p_query:root.querySelector("[data-search]").value.trim(),p_kind:root.querySelector("[data-kind]").value,p_status:root.querySelector("[data-status]").value,p_page:page});
    if (!root.isConnected || request !== listId) return;
    if (result.error) { root.querySelector("[data-count]").textContent = reviewError(result.error); return; }
    const {rows=[],total=0,counts={}} = result.data || {};
    root.querySelector("[data-count]").textContent = `검토 대상 ${counts.all ?? total}개 · 공개 반영 ${counts.published ?? 0}개 · 검토 완료 ${counts.ready ?? 0}개 · 삭제 ${counts.deleted ?? 0}개 · 현재 조건 ${total}개`;
    root.querySelector("[data-list]").innerHTML = rows.map(item => `<button type="button" class="review-list-item${current?.source_id===item.source_id ? " is-selected" : ""}" data-pick="${esc(item.source_id)}" aria-pressed="${current?.source_id===item.source_id}"><span class="review-thumb">${catalogImage(item.image_url,"",40)}</span><span><b>${esc(item.name)}</b><small>${esc(item.source_id)} · ${esc(item.category)}</small></span><span class="ym-chip">${item.deleted_at ? "삭제됨" : item.published_revision === item.revision ? "공개 반영" : item.status === "ready" ? "공개 대기" : item.review_kind === "different" ? "수치 차이" : "확인 필요"}</span></button>`).join("") || `<p class="empty">조건에 맞는 검토 항목이 없습니다.</p>`;
    root.querySelector("[data-page]").textContent = `${page+1} / ${Math.max(1,Math.ceil(total/24))}`;
    root.querySelector("[data-prev]").disabled = page === 0;
    root.querySelector("[data-next]").disabled = (page+1)*24 >= total;
  }
  function field(name,label,value,type="text") { return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" aria-label="${esc(label)}" type="${type}" ${type==="number"?'step="1"':''} value="${esc(value)}"></label>`; }
  function paint(item) {
    const d = item.draft, p = item.proposals || {}, c = item.comparison || {}, sections = reviewSections(item);
    const descriptionFields = `<label class="field"><span>선택 · 보완한 설명</span><textarea name="description" aria-label="선택 · 보완한 설명" maxlength="20000" rows="6">${esc(d.description)}</textarea></label><label class="field"><span>효과 설명</span><textarea name="effect_description" aria-label="효과 설명" maxlength="20000" rows="4">${esc(d.effect_description)}</textarea></label>`;
    const statFields = `<div class="review-number-grid">${itemOptionFields.map(f=>field(`stat:${f.key}`,f.label,d.base_options?.[f.key],"number")).join("")}</div>`;
    const sourceCards = sections.skipDescription && sections.skipStats && !p.api?.attack_speed_label && !p.comparison?.attack_speed_label ? "" : ["api","comparison"].map((key,index)=>{
      const source = p[key] || {};
      const summary = itemOptionFields.filter(f=>source.base_options?.[f.key]!=null).map(f=>`<div><dt>${esc(f.label)}</dt><dd>${esc(source.base_options[f.key])}</dd></div>`).join("");
      return `<article class="review-source"><h3>${index===0?"API · 자료 A":"비교 자료 · B"}</h3>${sections.skipDescription?"":`<p>${esc(source.description || source.effect_description || "이쪽 설명은 미제공입니다.")}</p><button type="button" class="mo-ghost" data-description="${key}" ${source.description||source.effect_description?"":"disabled"}>이 설명 사용</button>`}${sections.skipStats&&!source.attack_speed_label?"":`${source.attack_speed_label?`<p class="review-source-stats">공격속도 <strong>${esc(source.attack_speed_label)}</strong></p>`:""}${summary?`<dl class="review-source-stats">${summary}</dl>`:`<p class="hint">이쪽 스탯은 미제공입니다.</p>`}<button type="button" class="mo-ghost" data-options="${key}" ${Object.keys(source.base_options||{}).length||source.attack_speed_label?"":"disabled"}>이쪽 수치 사용</button>`}</article>`;
    }).join("");
    editor.innerHTML = `<header class="review-editor-head"><div><span class="ym-chip">ID ${esc(item.source_id)} · ${esc(item.category)}</span><h2>${esc(d.name)}</h2></div><span class="review-thumb">${catalogImage(item.image_url,"",48)}</span></header>${item.published_item_id?`<a class="mo-ghost" href="#/item-catalog?id=${encodeURIComponent(item.published_item_id)}">공개 아이템 보기</a>`:""}<div class="review-reasons">${(c.differences||[]).map(x=>`<p><b>${esc(x.field)}</b> · 자료 A ${esc(valueText(x.api))} → 자료 B ${esc(valueText(x.reference))}</p>`).join("")}${sections.unknown.map(x=>`<p>${esc(x)}</p>`).join("")}</div><div class="review-skip-notes">${sections.skipDescription?'<span class="ym-chip">양쪽 설명 없음 · 확인 생략</span>':""}${sections.skipStats?'<span class="ym-chip">양쪽 스탯 없음 · 확인 생략</span>':""}</div>${sourceCards?`<div class="review-sources">${sourceCards}</div>`:""}<form data-review-form>${field("name","아이템 이름",d.name)}${field("attack_speed_label","공격속도",d.attack_speed_label)}<p class="hint">등급만 알면 빠름처럼 입력하세요. 숫자 공속은 추측하지 않습니다.</p>${sections.openDescription?descriptionFields:`<details class="review-options review-optional-description"><summary>설명 직접 추가 (선택)</summary><div class="review-optional-fields">${descriptionFields}</div></details>`}<section class="review-options review-visible-options" aria-label="기본 옵션 · 착용 조건"><h3>기본 옵션 · 적용할 값</h3><p class="hint">위 자료 A·B와 비교하며 바로 수정하세요. 빈칸은 미제공이며 0과 구분합니다.</p>${sections.openStats?statFields:`<details class="review-optional-stats"><summary>스탯 직접 추가 (선택)</summary>${statFields}</details>`}<h3>착용 조건 · 적용할 값</h3><div class="review-number-grid">${requirements.map(([key,label])=>field(`req:${key}`,label,d.requirements?.[key],"number")).join("")}</div><div class="review-number-grid">${field("req:REQ JOB","착용 직업 (예: 전사/도적 또는 공용)",d.requirements?.["REQ JOB"])}${field("req:GENDER","성별 제한",d.requirements?.GENDER)}</div></section><label class="field"><span>검토 메모</span><textarea name="review_note" aria-label="검토 메모" maxlength="4000" rows="3">${esc(d.review_note)}</textarea></label><div class="review-savebar"><span data-save-state role="status">${item.published_revision===item.revision?"공개 반영 완료":item.published_item_id?"공개본 있음 · 수정 초안":item.status==="ready"?"검토 완료 · 공개 대기":"비공개 초안"} · 수정 ${item.revision}</span><button type="button" class="mo-ghost" data-remove>아이템 삭제</button><button type="button" class="mo-ghost" data-reload>다시 불러오기</button><button type="submit" class="mo-ghost" data-save="draft">초안 저장</button><button type="submit" class="primary-button" data-save="ready">검토 완료 · 공개 반영</button></div></form><div data-discard-notice></div>`;
    if(item.deleted_at) editor.innerHTML=`<header class="review-editor-head"><h2>${esc(d.name)}</h2><span class="ym-chip">삭제한 검토 항목</span></header><p>검토 목록에서 제외했습니다. 기존 공개 도감과 저장한 초안은 유지됩니다.</p><p data-save-state role="status"></p><button type="button" class="mo-ghost" data-restore>아이템 복구</button>`;
    dirty = false;
  }
  async function setDeleted(deleted, discard = false) {
    if(saving||!current)return;
    if (deleted && dirty && !discard) {
      editor.querySelector("[data-discard-notice]").innerHTML = `<p class="review-discard">저장하지 않은 변경이 있습니다. 삭제하면 이 입력은 저장되지 않습니다. <button type="button" class="mo-ghost" data-confirm-remove>변경을 버리고 삭제</button><button type="button" class="mo-ghost" data-keep>계속 편집</button></p>`;
      return;
    }
    ++detailId;
    const controls = [...editor.querySelectorAll("button,input,textarea")].map(node=>[node,node.disabled]);
    controls.forEach(([node])=>node.disabled=true);
    status(deleted?"검토 목록에서 삭제하는 중입니다.":"아이템을 복구하는 중입니다.");
    saving=true;const result=await reviewRpc("catalog_review_set_deleted",{p_id:current.source_id,p_revision:current.revision,p_deleted:deleted});saving=false;
    if(!root.isConnected)return;
    if(result.error){controls.forEach(([node,disabled])=>node.disabled=disabled);status(reviewError(result.error));return;}
    current=result.data;dirty=false;paint(current);status(deleted?"검토 목록에서 삭제했습니다. 공개 도감은 유지됩니다.":"검토 목록으로 복구했습니다.");void loadList();
  }
  async function pick(id, discard = false) {
    if (saving) return;
    if (dirty && !discard) {
      pendingId = id;
      editor.querySelector("[data-discard-notice]").innerHTML = `<p class="review-discard">저장하지 않은 변경이 있습니다. <button type="button" class="mo-ghost" data-discard>변경을 버리고 열기</button><button type="button" class="mo-ghost" data-keep>계속 편집</button></p>`;
      return;
    }
    const request = ++detailId;
    const result = await reviewRpc("catalog_review_detail", {p_id:id});
    if (!root.isConnected || request !== detailId) return;
    if (result.error || !result.data) { if(current)status(result.error?reviewError(result.error):"항목을 찾을 수 없습니다.");else editor.innerHTML=`<p class="empty">${esc(result.error?reviewError(result.error):"항목을 찾을 수 없습니다.")}</p>`;return; }
    current = result.data; pendingId = null; paint(current);
    root.querySelectorAll("[data-pick]").forEach(b=>{const active=b.dataset.pick===id;b.classList.toggle("is-selected",active);b.setAttribute("aria-pressed",String(active));});
  }
  function readDraft() {
    const f = new FormData(editor.querySelector("form")), stats = {};
    itemOptionFields.forEach(({key})=>stats[key]=f.get(`stat:${key}`));
    const parsed = readItemOptions(stats); if(parsed.error)throw new Error(parsed.error);
    const req = {};
    for(const [key,label] of requirements){const value=f.get(`req:${key}`).trim();if(!value)continue;const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw new Error(`${label}은 0 이상의 정수로 입력해 주세요.`);req[key]=n;}
    for(const key of ["REQ JOB","GENDER"]){const value=f.get(`req:${key}`).trim();if(value)req[key]=value;}
    const name=f.get("name").trim();if(!name||name.length>200)throw new Error("아이템 이름은 1~200자로 입력해 주세요.");
    const speed=f.get("attack_speed_label").trim();
    return {...(speed||Object.hasOwn(current.draft,"attack_speed_label")?{attack_speed_label:speed}:{}),name,description:f.get("description"),effect_description:f.get("effect_description"),base_options:parsed.value,requirements:req,review_note:f.get("review_note")};
  }
  root.addEventListener("input",event=>{if(event.target.closest("[data-review-form]"))markDirty();if(event.target.matches("[data-search]")){clearTimeout(timer);++listId;page=0;timer=setTimeout(()=>{if(root.isConnected)void loadList();},250);}});
  root.addEventListener("change",event=>{if(event.target.matches("[data-kind],[data-status]")){clearTimeout(timer);page=0;void loadList();}});
  root.addEventListener("click",event=>{
    if(event.target.closest("[data-confirm-remove]")){void setDeleted(true,true);return;}
    if(event.target.closest("[data-remove]")){void setDeleted(true);return;}
    if(event.target.closest("[data-restore]")){void setDeleted(false);return;}
    const pickButton=event.target.closest("[data-pick]");if(pickButton){void pick(pickButton.dataset.pick);return;}
    const description=event.target.closest("[data-description]");if(description&&current&&!saving){const source=current.proposals[description.dataset.description];editor.querySelector('[name="description"]').value=source.description||source.effect_description||"";editor.querySelector('[name="effect_description"]').value=source.effect_description||source.description||"";markDirty();}
    const options=event.target.closest("[data-options]");if(options&&current&&!saving){const source=current.proposals[options.dataset.options];editor.querySelector('[name="attack_speed_label"]').value=source.attack_speed_label||"";for(const [key,value] of Object.entries(source.base_options||{})){const input=editor.querySelector(`[name="stat:${key}"]`);if(input)input.value=value;}for(const input of editor.querySelectorAll('[name^="stat:"]'))if(!Object.hasOwn(source.base_options||{},input.name.slice(5)))input.value="";for(const input of editor.querySelectorAll('[name^="req:"]'))input.value=source.requirements?.[input.name.slice(4)]??"";markDirty();}
    if(event.target.closest("[data-prev]")){page=Math.max(0,page-1);void loadList();}
    if(event.target.closest("[data-next]")){page++;void loadList();}
    if(event.target.closest("[data-retry]")){clearTimeout(timer);void loadList();}
    if(event.target.closest("[data-reload]")&&current)void pick(current.source_id);
    if(event.target.closest("[data-discard]"))void pick(pendingId||current.source_id,true);
    if(event.target.closest("[data-keep]")){pendingId=null;editor.querySelector("[data-discard-notice]").innerHTML="";}
  });
  root.addEventListener("submit",async event=>{
    if(!event.target.matches("[data-review-form]"))return;event.preventDefault();if(saving||!current)return;
    let draft;try{draft=readDraft();}catch(error){status(error.message);return;}
    const state=event.submitter?.dataset.save||"draft",id=current.source_id,revision=current.revision;
    ++detailId;
    saving=true;editor.querySelectorAll("button,input,textarea").forEach(x=>x.disabled=true);status(state==="ready"?"공개 도감에 반영하는 중입니다.":"비공개 초안을 저장하는 중입니다.");
    const result=await reviewRpc("catalog_review_save",{p_id:id,p_revision:revision,p_draft:draft,p_status:state,p_publish:state==="ready"});
    saving=false;if(!root.isConnected)return;editor.querySelectorAll("button,input,textarea").forEach(x=>x.disabled=false);
    if(result.error){
      for(const button of editor.querySelectorAll("[data-description]"))button.disabled=!(current.proposals?.[button.dataset.description]?.description||current.proposals?.[button.dataset.description]?.effect_description);
      for(const button of editor.querySelectorAll("[data-options]"))button.disabled=!(Object.keys(current.proposals?.[button.dataset.options]?.base_options||{}).length||current.proposals?.[button.dataset.options]?.attack_speed_label);
      status(reviewError(result.error));return;
    }
    if (state==="ready" && (!result.data?.published_item_id || result.data.published_revision!==result.data.revision)) {
      status("공개 반영을 확인하지 못했습니다. 운영 설정을 확인한 뒤 다시 불러와 주세요.");return;
    }
    if (state==="ready") clearCatalogCache();
    current=result.data;paint(current);status(state==="ready"?"공개 도감에 반영했습니다.":"비공개 초안을 저장했습니다. 기존 공개본은 유지됩니다.");void loadList();
  });
  await loadList();
}
