export function translateDbError(error) {
  const raw = error?.message || "";
  if (/failed to fetch|network/i.test(raw)) {
    return "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  }
  if (/row-level security|permission denied|42501/i.test(raw)) {
    return "이 데이터를 다룰 권한이 없습니다. 다시 로그인한 뒤 시도해 주세요.";
  }
  if (/JWT|invalid claim|not authenticated/i.test(raw)) {
    return "로그인이 만료되었습니다. 다시 로그인해 주세요.";
  }
  if (/characters_level_check/i.test(raw)) return "레벨은 1 이상이어야 합니다.";
  if (/characters_combat_power_check|characters_current_exp_check|characters_meso_check/i.test(raw)) {
    return "스공, 경험치, 메소는 0 이상이어야 합니다.";
  }
  if (/quests_start_level_check/i.test(raw)) return "시작 레벨은 1 이상이어야 합니다.";
  if (/quests_exp_reward_check|quests_meso_reward_check/i.test(raw)) {
    return "경험치와 메소 보상은 0 이상이어야 합니다.";
  }
  if (/quests_duration_minutes_check/i.test(raw)) return "진행 시간은 1분 이상이어야 합니다.";
  if (/quests_material_cost_check/i.test(raw)) return "재료비는 0 이상이어야 합니다.";
  if (/material_cost/i.test(raw) && /does not exist|schema cache|could not find/i.test(raw)) {
    return "재료비 칸이 없습니다. Supabase SQL Editor에서 sql/009_quest_material_cost.sql 을 실행해 주세요.";
  }
  if (/duration_minutes/i.test(raw) && /does not exist|schema cache|could not find/i.test(raw)) {
    return "진행 시간 칸이 없습니다. Supabase SQL Editor에서 sql/007_quest_duration.sql 을 실행해 주세요.";
  }
  if (/trades_buy_qty_check/i.test(raw)) return "산 개수는 1 이상이어야 합니다.";
  if (/trades_sell_qty_check/i.test(raw)) return "판 개수는 산 개수보다 많을 수 없습니다.";
  if (/trades_sell_pair_check/i.test(raw)) {
    return "판 가격과 판 개수를 따로 저장하려면 Supabase SQL Editor에서 sql/012_trades_partial_sell.sql 을 실행해 주세요.";
  }
  if (/trades_buy_price_check|trades_sell_price_check/i.test(raw)) return "가격은 0 이상이어야 합니다.";
  if (/account_character_limit/i.test(raw)) return "한 계정에는 캐릭터를 6개까지 만들 수 있습니다.";
  if (/account_not_owned/i.test(raw)) return "내 계정이 아닌 곳에는 캐릭터를 넣을 수 없습니다.";
  if (/face_path/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "얼굴 칸이 없습니다. Supabase SQL Editor에서 sql/026_character_face.sql 을 실행해 주세요.";
  }
  if (/quests_hidden/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "퀘스트 표시 칸이 없습니다. Supabase SQL Editor에서 sql/023_character_quests_hidden.sql 을 실행해 주세요.";
  }
  if (/rift_/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "차원의 균열 조각 칸이 없습니다. Supabase SQL Editor에서 sql/021_rift_fragment.sql 을 실행해 주세요.";
  }
  if (/pianus_|papulatus_/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "피아누스와 파풀라투스 칸이 없습니다. Supabase SQL Editor에서 sql/020_boss_runs.sql 을 실행해 주세요.";
  }
  if (/characters_account_id_fkey/i.test(raw)) {
    return "이 계정에 캐릭터가 있어서 삭제할 수 없습니다. 캐릭터를 먼저 삭제해 주세요.";
  }
  if (/monsters_level_check/i.test(raw)) return "몬스터 레벨은 1 이상이어야 합니다.";
  if (/monsters_.*_check/i.test(raw)) return "명중률, 체력, 경험치, 1경험치당 HP는 0 이상이어야 합니다.";
  if (/could not find the '(materials|hp_per_exp)' column/i.test(raw)) {
    return "새 칸이 없습니다. Supabase SQL Editor에서 sql/005_glance_columns.sql 을 실행해 주세요.";
  }
  if (/weak_elements|resist_elements|immune_elements/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "속성 칸이 없습니다. Supabase SQL Editor에서 sql/014_monster_elements.sql 을 실행해 주세요.";
  }
  if (/trades/i.test(raw) && /could not find the table|schema cache|does not exist/i.test(raw)) {
    return "거래 표가 없습니다. Supabase SQL Editor에서 sql/006_trades.sql 을 실행해 주세요.";
  }
  if (/hunts_level_check/i.test(raw)) return "사냥 레벨은 1부터 300까지입니다.";
  if (/hunts_potion_cost_check/i.test(raw)) return "물약 값은 0 이상이어야 합니다.";
  if (/hunts_leech_fee_check/i.test(raw)) {
    return "쩔비에 음수를 저장하려면 Supabase SQL Editor에서 sql/015_hunt_leech_signed.sql 을 실행해 주세요.";
  }
  if (/hunts_exp_per_hour_check/i.test(raw)) return "경험치는 1 이상이어야 합니다.";
  if (/level_exp_level_check/i.test(raw)) return "경험치 표의 레벨은 1부터 299까지입니다.";
  if (/level_exp_amount_check/i.test(raw)) return "다음 레벨 경험치는 1 이상이어야 합니다.";
  if (/level_exp_user_level_key/i.test(raw)) return "그 레벨의 경험치는 이미 있습니다. 그 줄을 수정해 주세요.";
  if (/numeric field overflow/i.test(raw)) return "숫자가 너무 큽니다.";
  if (/hunts/i.test(raw) && /leech_fee/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "쩔비 칸이 없습니다. Supabase SQL Editor에서 sql/013_hunt_leech_fee.sql 을 실행해 주세요.";
  }
  if (/hunts/i.test(raw) && /title/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "사냥 이름 칸이 없습니다. Supabase SQL Editor에서 sql/011_hunt_title.sql 을 실행해 주세요.";
  }
  if (/hunts/i.test(raw) && /memo/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "사냥 메모 칸이 없습니다. Supabase SQL Editor에서 sql/010_hunt_memo.sql 을 실행해 주세요.";
  }
  if (/hunts|level_exp/i.test(raw) && /could not find the table|schema cache|does not exist/i.test(raw)) {
    return "사냥 표가 없습니다. Supabase SQL Editor에서 sql/008_hunts.sql 을 실행해 주세요.";
  }
  if (/job_id|jobs/i.test(raw) && /could not find|schema cache|does not exist|relationship/i.test(raw)) {
    return "직업 표가 없습니다. Supabase SQL Editor에서 sql/008_jobs.sql 을 실행해 주세요.";
  }
  if (/dojo_belt_prices_price_check/i.test(raw)) return "시세는 0 이상이어야 합니다.";
  if (/dojo_records_score_check/i.test(raw)) return "지금 점수가 허용 범위를 벗어났습니다. 입력한 점수를 확인해 주세요.";
  if (/dojo_records_user_character/i.test(raw)) return "이 캐릭터의 이 방식 구간 시간은 이미 있습니다.";
  if (/dojo_records_actual_minutes_check/i.test(raw)) return "실제 한 바퀴는 1분 이상이어야 합니다.";
  if (/\bruns\b/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "돌아본 시간 칸이 없습니다. Supabase SQL Editor에서 sql/018_dojo_character_runs.sql 을 실행해 주세요.";
  }
  if (/actual_minutes/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw)) {
    return "실제 시간 칸이 없습니다. Supabase SQL Editor에서 sql/017_dojo_actual_minutes.sql 을 실행해 주세요.";
  }
  if (/dojo_records|dojo_belt_prices/i.test(raw) && /could not find the table|schema cache|does not exist/i.test(raw)) {
    return "무릉 표가 없습니다. Supabase SQL Editor에서 sql/016_dojo.sql 을 실행해 주세요.";
  }
  if (/links_url_check/i.test(raw)) return "http 또는 https 주소만 저장할 수 있습니다.";
  if (/could not find the table 'public\.links'/i.test(raw)) {
    return "링크 표가 없습니다. Supabase SQL Editor에서 sql/022_links.sql 을 실행해 주세요.";
  }
  if (/could not find the table|schema cache|does not exist/i.test(raw)) {
    return "표를 찾지 못했습니다. Supabase SQL Editor에서 sql/004_accounts_and_monsters.sql 을 실행해 주세요.";
  }
  return "저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.";
}
