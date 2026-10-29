-- 049 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다(재실행 가능).
-- 저장된 몬스터 원문의 수치를 별도 컬럼으로 옮깁니다. 외부 요청·추정 계산은 하지 않습니다.
begin;
select pg_advisory_xact_lock(20261028,43);
alter table public.catalog_monsters
 add column if not exists mp numeric,
 add column if not exists physical_attack numeric,
 add column if not exists magic_attack numeric,
 add column if not exists physical_defense numeric,
 add column if not exists magic_defense numeric,
 add column if not exists movement_speed numeric,
 add column if not exists knockback_damage numeric,
 add column if not exists meso_value numeric,
 add column if not exists accuracy_reference_level integer;

create or replace function catalog_import_private.monster_stat(v text, label text)
returns numeric language sql immutable set search_path='' as $$
 select (regexp_match(v,label||'[[:space:]]*:[[:space:]]*([+-]?[0-9]+(?:\.[0-9]+)?)(?=[[:space:]+]|$)'))[1]::numeric
$$;
revoke all on function catalog_import_private.monster_stat(text,text) from public,anon,authenticated;
grant execute on function catalog_import_private.monster_stat(text,text) to service_role;

-- 사용자 결정: 원문에 필요 명중 숫자가 있으면 기존 값을 덮어씁니다.
-- 원문 미제공일 때는 정규화 트리거의 coalesce로 기존 값을 유지합니다.

create or replace function public.catalog_monster_columns()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v text;
begin
 if new.source is distinct from 'collected' then return new; end if;
 v:=new.source_data->>'stats_text';
 -- MP는 이미 해석된 숫자를 우선 사용해 50K 같은 축약 표기를 잘못 읽지 않습니다.
 new.mp:=case when jsonb_typeof(new.source_data->'mp')='number' then (new.source_data->>'mp')::numeric else catalog_import_private.monster_stat(v,'MP') end;
 new.physical_attack:=catalog_import_private.monster_stat(v,'물리 데미지');
 new.magic_attack:=catalog_import_private.monster_stat(v,'마법 데미지');
 new.physical_defense:=catalog_import_private.monster_stat(v,'물리 방어력');
 new.magic_defense:=catalog_import_private.monster_stat(v,'마법 방어력');
 new.movement_speed:=catalog_import_private.monster_stat(v,'속도');
 new.knockback_damage:=catalog_import_private.monster_stat(v,'넉백 가능 데미지');
 new.meso_value:=catalog_import_private.monster_stat(v,'메소');
 new.required_accuracy:=coalesce(catalog_import_private.monster_stat(v,'필요 명중'),new.required_accuracy);
 new.accuracy_reference_level:=(regexp_match(v,'([0-9]+)레벨[[:space:]]*에서의 필요 명중'))[1]::integer;
 -- 레벨별 증가량은 원문에 없으므로 기존 값을 유지하고 임의로 정하지 않습니다.
 return new;
end $$;
revoke all on function public.catalog_monster_columns() from public,anon,authenticated;
grant execute on function public.catalog_monster_columns() to service_role;
drop trigger if exists catalog_monster_columns on public.catalog_monsters;
create trigger catalog_monster_columns before insert or update of source_data,source
 on public.catalog_monsters for each row execute function public.catalog_monster_columns();

-- 상세 수치 변경도 기존 공개 이력과 비공개 원문 보관에 포함합니다.
create or replace function public.record_catalog_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare before_row jsonb; after_row jsonb; a jsonb; b jsonb; diff jsonb; k text;
 entity uuid; label text; kind text; change_no bigint; allowed text[];
begin
 -- 정규화 함수가 같은 관계표를 재생성하는 과정은 부모 아이템 이력 한 건으로 처리합니다.
 if tg_table_name like 'catalog_item_%' and pg_trigger_depth()>1 then return null; end if;
 if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
 a:=coalesce(before_row,'{}'); b:=coalesce(after_row,'{}');
 if tg_table_name='catalog_items' then
  kind:='item';entity:=coalesce(b->>'id',a->>'id')::uuid;label:=coalesce(b->>'name',a->>'name');
  allowed:=array['name','category','middle_category','subcategory','required_level','gender_restriction','attack_speed','attack_speed_label','shop_sell_price','description','effect_description','base_options','requirements','image_url'];
  a:=a||jsonb_build_object('option_ranges',a#>'{source_data,option_ranges}','extra_effects',a#>'{source_data,other_effects}');b:=b||jsonb_build_object('option_ranges',b#>'{source_data,option_ranges}','extra_effects',b#>'{source_data,other_effects}');
  allowed:=allowed||array['option_ranges','extra_effects'];
 elsif tg_table_name='catalog_monsters' then
  kind:='monster';entity:=coalesce(b->>'id',a->>'id')::uuid;label:=coalesce(b->>'name',a->>'name');
  allowed:=array['name','level','hp','exp','required_accuracy','accuracy_per_level','weak_elements','resist_elements','image_url','mp','physical_attack','magic_attack','physical_defense','magic_defense','movement_speed','knockback_damage','meso_value','accuracy_reference_level'];
 elsif tg_table_name='catalog_monster_drops' then
  kind:='monster';entity:=coalesce(b->>'monster_id',a->>'monster_id')::uuid;
  select name into label from public.catalog_monsters where id=entity;
  allowed:=array['item_id','rate_percent'];
 else
  kind:='item';entity:=coalesce(b->>'item_id',a->>'item_id')::uuid;
  select name into label from public.catalog_items where id=entity;
  allowed:=array['stat_key','base_value','minimum_value','maximum_value','requirement_key','required_value','job_name','attribute_name','value_text'];
 end if;
 diff:='{}';
 foreach k in array allowed loop
  if a->k is distinct from b->k then
   if k='shop_sell_price' then diff:=diff||jsonb_build_object(k,jsonb_build_object('before',a->>k,'after',b->>k));
   else diff:=diff||jsonb_build_object(k,jsonb_build_object('before',a->k,'after',b->k)); end if;
  end if;
 end loop;
 if diff='{}' then return null; end if;
 if tg_table_name='catalog_monster_drops' and diff ? 'item_id' then
  diff:=jsonb_set(diff,'{item_id}',jsonb_build_object(
   'before',(select name from public.catalog_items where id=(a->>'item_id')::uuid),
   'after',(select name from public.catalog_items where id=(b->>'item_id')::uuid)));
 end if;
 insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
 values(kind,entity,coalesce(label,'삭제된 정보'),tg_op,diff,nullif(current_setting('yourmaple.release_label',true),'')) returning id into change_no;
 insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
 values(change_no,tg_table_name,before_row,after_row);
 update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
 return null;
end $$;
revoke all on function public.record_catalog_change() from public,anon,authenticated;


update public.catalog_monsters set source_data=source_data where source='collected';
grant select(mp,physical_attack,magic_attack,physical_defense,magic_defense,movement_speed,knockback_damage,meso_value,accuracy_reference_level)
 on public.catalog_monsters to anon,authenticated;
create or replace function public.catalog_monster_detail(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('monster',jsonb_build_object(
  'id',m.id,'required_accuracy',m.required_accuracy,'accuracy_per_level',m.accuracy_per_level,
  'accuracy_reference_level',m.accuracy_reference_level,'mp',m.mp,
  'physical_attack',m.physical_attack,'magic_attack',m.magic_attack,
  'physical_defense',m.physical_defense,'magic_defense',m.magic_defense,
  'movement_speed',m.movement_speed,'knockback_damage',m.knockback_damage,'meso_value',m.meso_value))
 from public.catalog_monsters m where m.id=p_id
$$;
revoke all on function public.catalog_monster_detail(uuid) from public;
grant execute on function public.catalog_monster_detail(uuid) to anon,authenticated,service_role;
commit;
