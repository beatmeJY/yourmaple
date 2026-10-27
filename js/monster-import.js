import { getSupabase } from './supabase-client.js';
import { currentSession } from './session.js';
import { escapeHtml } from './format.js';
import { notify } from './toast.js';
import { parseMonsterSheet, classifyMonsterRows, readMonsterFile, readMonsterText, monsterExample } from './monster-sheet.js';

export async function mountMonsterImport(root, reload, getRows) {
  const userId = currentSession()?.user?.id;
  if (!userId) return;
  const client = await getSupabase();
  const {data:allowed,error} = await client.rpc('can_import_catalog_monsters');
  if (error || allowed !== true || !root.isConnected || currentSession()?.user?.id !== userId) return;
  const mount = root.querySelector('[data-monster-import]');
  if (!mount) return;
  mount.innerHTML = `<button class="secondary-button" type="button" data-open-import>엑셀로 몬스터 등록</button>
    <dialog class="monster-import-dialog ym-glass" aria-label="몬스터 엑셀 등록">
      <div class="mi-head"><div><span class="ym-chip">운영자 전용</span><h2>몬스터 일괄 등록</h2></div><button type="button" class="mo-ghost" data-close-import aria-label="등록 창 닫기">닫기</button></div>
      <p>첫 시트에 몹 이름 · 레벨 · HP · 경험치 · 명중률 · 드랍 템 열을 넣어 주세요. 1 경험치 당 HP는 자동 계산해요.</p>
      <label class="field"><span>엑셀 파일 선택 (최대 2MB · 500행)</span><input type="file" accept=".xlsx,.csv,.tsv" data-import-file /></label>
      <label class="field"><span>또는 엑셀에서 제목 줄까지 복사해 붙여넣기</span><textarea rows="5" data-import-text placeholder="몹 이름&#9;레벨&#9;HP&#9;경험치&#9;명중률&#9;드랍 템"></textarea></label>
      <div class="button-row"><button type="button" class="secondary-button" data-preview-text>붙여넣기 미리보기</button><button type="button" class="mo-ghost" data-example>예시 표 채우기</button></div>
      <p class="mi-note">드랍템 약어는 그대로 저장하고 X는 없음으로 처리해요. 기존 몬스터는 덮어쓰지 않고, 새로운 이름만 등록해요.</p>
      <div data-import-preview aria-live="polite"></div>
      <div class="mi-footer"><button type="button" class="primary-button" data-save-import disabled>새 몬스터 등록</button><span data-import-result role="status"></span></div>
    </dialog>`;
  const dialog = mount.querySelector('dialog'), save = mount.querySelector('[data-save-import]');
  const preview = mount.querySelector('[data-import-preview]'), result = mount.querySelector('[data-import-result]');
  let ready = [], generation = 0, busy = false;
  const active = () => root.isConnected && currentSession()?.user?.id===userId;
  function invalidate() { generation++; ready=[]; save.disabled=true; preview.replaceChildren(); result.textContent=''; }
  async function show(load) {
    invalidate(); const token=generation;
    preview.textContent='표를 읽고 있어요…';
    try {
      const parsed = parseMonsterSheet(await load());
      if (!active() || token!==generation) return;
      if (parsed.errors.length) throw new Error(parsed.errors.slice(0,12).join('\n'));
      const rows=classifyMonsterRows(parsed.rows,getRows());
      ready=rows.filter(r=>r.status==='new').map(({status,...r})=>r);
      const labels={new:'새로 등록',same:'이미 등록됨',conflict:'값이 달라 보류'};
      preview.innerHTML=`<p class="ym-chip">신규 ${ready.length} · 동일 ${rows.filter(r=>r.status==='same').length} · 보류 ${rows.filter(r=>r.status==='conflict').length}</p>
        <div class="mi-table"><table><thead><tr><th>이름</th><th>레벨</th><th>HP</th><th>EXP</th><th>명중</th><th>HP/EXP</th><th>드랍템</th><th>상태</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.level}</td><td>${r.hp}</td><td>${r.exp}</td><td>${r.required_accuracy}</td><td>${r.exp>0?Math.round(r.hp/r.exp*10000)/10000:'—'}</td><td>${escapeHtml(r.drop_items ?? '없음')}</td><td><span class="ym-badge">${labels[r.status]}</span></td></tr>`).join('')}</tbody></table></div>`;
      save.disabled=!ready.length;
    } catch(error) { if (active() && token===generation) preview.textContent=error.message; }
  }
  mount.querySelector('[data-open-import]').onclick=()=>dialog.showModal();
  mount.querySelector('[data-close-import]').onclick=()=>{if(!busy) dialog.close();};
  dialog.addEventListener('cancel',event=>{if(busy) event.preventDefault();});
  mount.querySelector('[data-import-file]').onchange=event=>{
    const file=event.target.files[0]; if(file) void show(()=>readMonsterFile(file)); else invalidate();
  };
  mount.querySelector('[data-import-text]').oninput=invalidate;
  mount.querySelector('[data-preview-text]').onclick=()=>void show(()=>readMonsterText(mount.querySelector('[data-import-text]').value));
  mount.querySelector('[data-example]').onclick=()=>{
    mount.querySelector('[data-import-text]').value=monsterExample.map(row=>row.join('\t')).join('\n');
    void show(()=>Promise.resolve(monsterExample));
  };
  save.onclick=async()=>{
    if(busy || !ready.length || !active()) return;
    busy=true;
    const payload=ready; save.disabled=true;
    for(const control of dialog.querySelectorAll('input,textarea,button')) control.disabled=true;
    try {
      const {data,error}=await client.rpc('import_catalog_monsters',{rows:payload});
      if(error) throw new Error(/권한|permission/i.test(error.message)?'등록 권한이 없어요. 운영자 설정을 확인해 주세요.':'등록하지 못했어요. SQL 039 적용과 연결 상태를 확인해 주세요.');
      if(!active()) return;
      invalidate();
      result.textContent=`${data.inserted}개 등록 · ${data.unchanged}개 동일 · ${data.conflicts.length}개 보류`;
      notify(result.textContent);
      await reload();
    } catch(error) { if(active()) result.textContent=error.message; }
    finally {
      busy=false;
      if(active()) {for(const control of dialog.querySelectorAll('input,textarea,button')) control.disabled=false; save.disabled=!ready.length;}
    }
  };
}
