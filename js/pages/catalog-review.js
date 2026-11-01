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
  root.innerHTML = `<section class="catalog-page review-page"><header class="ym-page-head"><div><span class="ym-chip">운영자 전용 · 비공개</span><h1>아이템 검토 보관함</h1><p>설명을 골라 보완하고, 공개 전 초안을 준비하세요.</p></div><a href="#/item-catalog" class="mo-ghost">공개 도감</a></header><p class="review-private-note">여기서 저장하거나 ‘검토 완료’로 표시해도 공개 도감에는 반영되지 않습니다.</p><div class="review-filters"><label class="field"><span>이름 · 아이템 ID</span><input data-search aria-label="이름 · 아이템 ID" maxlength="100" placeholder="검토할 아이템 찾기"></label><label class="field"><span>검토 사유</span><select data-kind aria-label="검토 사유"><option value="">전체</option><option value="unverified">확인 필요</option><option value="different">수치 차이</option></select></label><label class="field"><span>진행 상태</span><select data-status aria-label="진행 상태"><option value="">전체</option><option value="draft">검토 중</option><option value="ready">검토 완료</option></select></label><button class="mo-ghost" type="button" data-retry>새로 확인</button></div><p class="hint" data-count aria-live="polite"></p><div class="review-layout"><aside class="ym-glass review-list-panel"><div data-list></div><nav class="catalog-pager" aria-label="검토 목록 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></aside><section class="review-editor ym-glass" data-editor><p class="empty">왼쪽 목록에서 아이템을 골라 주세요.</p></section></div></section>`;
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
    root.querySelector("[data-count]").textContent = `비공개 ${counts.all ?? total}개 · 검토 완료 ${counts.ready ?? 0}개 · 현재 조건 ${total}개`;
    root.querySelector("[data-list]").innerHTML = rows.map(item => `<button type="button" class="review-list-item${current?.source_id===item.source_id ? " is-selected" : ""}" data-pick="${esc(item.source_id)}" aria-pressed="${current?.source_id===item.source_id}"><span class="review-thumb">${catalogImage(item.image_url,"",40)}</span><span><b>${esc(item.name)}</b><small>${esc(item.source_id)} · ${esc(item.category)}</small></span><span class="ym-chip">${item.status === "ready" ? "완료" : item.review_kind === "different" ? "수치 차이" : "확인 필요"}</span></button>`).join("") || `<p class="empty">조건에 맞는 검토 항목이 없습니다.</p>`;
    root.querySelector("[data-page]").textContent = `${page+1} / ${Math.max(1,Math.ceil(total/24))}`;
    root.querySelector("[data-prev]").disabled = page === 0;
    root.querySelector("[data-next]").disabled = (page+1)*24 >= total;
  }
  function field(name,label,value,type="text") { return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" aria-label="${esc(label)}" type="${type}" ${type==="number"?'step="1"':''} value="${esc(value)}"></label>`; }
  function paint(item) {
    const d = item.draft, p = item.proposals || {}, c = item.comparison || {};
    editor.innerHTML = `<header class="review-editor-head"><div><span class="ym-chip">ID ${esc(item.source_id)} · ${esc(item.category)}</span><h2>${esc(d.name)}</h2></div><span class="review-thumb">${catalogImage(item.image_url,"",48)}</span></header><div class="review-reasons">${(c.differences||[]).map(x=>`<p><b>${esc(x.field)}</b> · 자료 A ${esc(valueText(x.api))} → 자료 B ${esc(valueText(x.reference))}</p>`).join("")}${(c.unknown||[]).map(x=>`<p>${esc(x)}</p>`).join("")}</div><div class="review-sources">${["api","comparison"].map((key,index)=>`<article class="review-source"><h3>${index===0?"API 설명 · 자료 A":"비교 설명 · 자료 B"}</h3><p>${esc(p[key]?.description || "제공된 설명이 없습니다.")}</p><button type="button" class="mo-ghost" data-description="${key}" ${p[key]?.description?"":"disabled"}>이 설명 사용</button><button type="button" class="mo-ghost" data-options="${key}" ${p[key]?.base_options?"":"disabled"}>이쪽 수치 사용</button></article>`).join("")}</div><form data-review-form>${field("name","아이템 이름",d.name)}<label class="field"><span>선택 · 보완한 설명</span><textarea name="description" aria-label="선택 · 보완한 설명" maxlength="20000" rows="6">${esc(d.description)}</textarea></label><label class="field"><span>효과 설명</span><textarea name="effect_description" aria-label="효과 설명" maxlength="20000" rows="4">${esc(d.effect_description)}</textarea></label><details class="review-options"><summary>기본 옵션 · 착용 조건 수정</summary><p class="hint">빈칸은 미제공입니다. 0과 구분해서 입력해 주세요.</p><div class="review-number-grid">${itemOptionFields.map(f=>field(`stat:${f.key}`,f.label,d.base_options?.[f.key],"number")).join("")}${requirements.map(([key,label])=>field(`req:${key}`,label,d.requirements?.[key],"number")).join("")}</div><div class="review-number-grid">${field("req:REQ JOB","착용 직업 (예: 전사/도적 또는 공용)",d.requirements?.["REQ JOB"])}${field("req:GENDER","성별 제한",d.requirements?.GENDER)}</div></details><label class="field"><span>검토 메모</span><textarea name="review_note" aria-label="검토 메모" maxlength="4000" rows="3">${esc(d.review_note)}</textarea></label><div class="review-savebar"><span data-save-state role="status">${item.status==="ready"?"검토 완료 · 비공개":"비공개 초안"} · 수정 ${item.revision}</span><button type="button" class="mo-ghost" data-reload>다시 불러오기</button><button type="submit" class="mo-ghost" data-save="draft">초안 저장</button><button type="submit" class="primary-button" data-save="ready">검토 완료</button></div></form><div data-discard-notice></div>`;
    dirty = false;
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
    return {name,description:f.get("description"),effect_description:f.get("effect_description"),base_options:parsed.value,requirements:req,review_note:f.get("review_note")};
  }
  root.addEventListener("input",event=>{if(event.target.closest("[data-review-form]"))markDirty();if(event.target.matches("[data-search]")){clearTimeout(timer);++listId;page=0;timer=setTimeout(()=>{if(root.isConnected)void loadList();},250);}});
  root.addEventListener("change",event=>{if(event.target.matches("[data-kind],[data-status]")){clearTimeout(timer);page=0;void loadList();}});
  root.addEventListener("click",event=>{
    const pickButton=event.target.closest("[data-pick]");if(pickButton){void pick(pickButton.dataset.pick);return;}
    const description=event.target.closest("[data-description]");if(description&&current&&!saving){const source=current.proposals[description.dataset.description];editor.querySelector('[name="description"]').value=source.description||"";editor.querySelector('[name="effect_description"]').value=source.effect_description||source.description||"";markDirty();}
    const options=event.target.closest("[data-options]");if(options&&current&&!saving){const source=current.proposals[options.dataset.options];for(const [key,value] of Object.entries(source.base_options||{})){const input=editor.querySelector(`[name="stat:${key}"]`);if(input)input.value=value;}for(const input of editor.querySelectorAll('[name^="stat:"]'))if(!Object.hasOwn(source.base_options||{},input.name.slice(5)))input.value="";for(const input of editor.querySelectorAll('[name^="req:"]'))input.value=source.requirements?.[input.name.slice(4)]??"";markDirty();}
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
    saving=true;editor.querySelectorAll("button,input,textarea").forEach(x=>x.disabled=true);status("비공개 초안을 저장하는 중입니다.");
    const result=await reviewRpc("catalog_review_save",{p_id:id,p_revision:revision,p_draft:draft,p_status:state});
    saving=false;if(!root.isConnected)return;editor.querySelectorAll("button,input,textarea").forEach(x=>x.disabled=false);
    if(result.error){
      for(const button of editor.querySelectorAll("[data-description]"))button.disabled=!current.proposals?.[button.dataset.description]?.description;
      for(const button of editor.querySelectorAll("[data-options]"))button.disabled=!current.proposals?.[button.dataset.options]?.base_options;
      status(reviewError(result.error));return;
    }
    current=result.data;paint(current);status(state==="ready"?"검토 완료로 저장했습니다. 공개 도감에는 아직 반영되지 않습니다.":"비공개 초안을 저장했습니다.");void loadList();
  });
  await loadList();
}
