// 엑셀·붙여넣기 표를 같은 검증 경로로 보냅니다. 확률/약어를 추측하지 않습니다.
export const monsterHeaders = ['몹 이름', '레벨', 'HP', '경험치', '명중률', '1 경험치 당 HP', '드랍 템'];
export const monsterExample = [monsterHeaders,
  ['스포아',2,20,5,0,4,'망체60'], ['스텀프',4,40,8,0,5,'망체10'],
  ['슬라임',6,50,10,3,5,'X'], ['돼지',7,75,15,0,5,'신민10 망행100 금'], ['주황버섯',8,80,15,3,5.34,'신점10 흰색고무신']];
const compact = value => String(value ?? '').replace(/[\s\u200b-\u200d]/g, '');
const fields = {'몹이름':'name','몬스터명':'name','레벨':'level','HP':'hp','경험치':'exp','명중률':'required_accuracy','드랍템':'drop_items','드롭템':'drop_items','1경험치당HP':'ratio'};
export function parseMonsterSheet(matrix) {
  const errors = [], rows = [], seen = new Set();
  if (!Array.isArray(matrix) || !matrix.length) return {rows, errors:['첫 줄에 열 이름을 넣어 주세요.']};
  const headers = matrix[0].map(value => fields[compact(value)]);
  for (const field of ['name','level','hp','exp','required_accuracy','drop_items']) {
    if (headers.filter(x => x === field).length !== 1) errors.push('필수 열을 한 번씩 넣어 주세요: ' + monsterHeaders.join(' · '));
  }
  if (matrix.length>501) errors.push('한 번에 500행까지 등록할 수 있어요.');
  if (errors.length) return {rows, errors:[...new Set(errors)]};
  matrix.slice(1).forEach((cells,index) => {
    if (!cells.some(value => String(value ?? '').trim() !== '')) return;
    const values = Object.fromEntries(headers.map((key,i) => [key,cells[i] ?? '']));
    const name = compact(values.name), prefix = `${index+2}행`;
    if (!name || name.length>100) errors.push(`${prefix}: 이름을 1~100자로 적어 주세요.`);
    if (seen.has(name)) errors.push(`${prefix}: ${name} 이름이 중복돼요.`);
    seen.add(name);
    const row = {name};
    for (const field of ['level','hp','exp','required_accuracy']) {
      const text = String(values[field]).trim();
      const number = Number(text);
      if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(number) || number>Number.MAX_SAFE_INTEGER ||
          (field !== 'required_accuracy' && !Number.isSafeInteger(number)) || (field==='level' && (number<1 || number>2147483647))) {
        errors.push(`${prefix}: ${field==='required_accuracy'?'명중률':field} 숫자를 확인해 주세요.`);
      }
      row[field] = number;
    }
    row.drop_items = /^x$/i.test(String(values.drop_items).trim()) ? null : String(values.drop_items).trim() || null;
    if ((row.drop_items?.length ?? 0)>2000) errors.push(`${prefix}: 드랍템 설명은 2,000자까지 적어 주세요.`);
    rows.push(row);
  });
  if (!rows.length) errors.push('등록할 몬스터가 없어요.');
  return {rows, errors};
}

export function classifyMonsterRows(rows, existing) {
  const byName = new Map(existing.map(row => [compact(row.name),row]));
  return rows.map(row => {
    const old = byName.get(row.name);
    const same = old && ['level','hp','exp','required_accuracy'].every(k => old[k] != null && Number(old[k])===row[k]) &&
      (String(old.drop_items ?? '').trim() || null) === row.drop_items;
    return {...row, status:!old?'new':same?'same':'conflict'};
  });
}

export async function readMonsterFile(file) {
  if (file.size>2*1024*1024) throw new Error('파일은 2MB까지 올릴 수 있어요.');
  if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) throw new Error('.xlsx, .csv, .tsv 파일을 골라 주세요.');
  const XLSX = await import('./vendor/xlsx-0.20.3.mjs');
  const workbook = XLSX.read(await file.arrayBuffer(), {type:'array', sheetRows:502, cellFormula:true});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('첫 번째 시트를 찾지 못했어요.');
  // 계산식 실행이나 캐시값 의존 없이 실제 입력값만 받습니다. 파생 비율 열은 무시합니다.
  const matrix = XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
  const header = matrix[0]?.map(compact) ?? [];
  for (const [address,cell] of Object.entries(sheet)) {
    if (address.startsWith('!') || !cell.f) continue;
    const pos = XLSX.utils.decode_cell(address);
    if (header[pos.c]!=='1경험치당HP') throw new Error('입력 열의 수식은 값으로 붙여넣은 뒤 올려 주세요.');
  }
  return matrix;
}

export async function readMonsterText(text) {
  if (text.length>2*1024*1024) throw new Error('붙여넣기 내용이 너무 커요.');
  const XLSX = await import('./vendor/xlsx-0.20.3.mjs');
  const book = XLSX.read(text,{type:'string',raw:true,sheetRows:502});
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:'',raw:true});
}
