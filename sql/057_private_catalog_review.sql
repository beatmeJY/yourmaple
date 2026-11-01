-- 056 이후 운영자가 전체 실행합니다. 검토 자료는 공개 도감과 분리합니다.
-- 운영자 지정·검토 자료 입력은 별도 비공개 준비 SQL에서 수행합니다.
begin;
create schema if not exists catalog_review_private;
revoke all on schema catalog_review_private from public,anon,authenticated;
create table if not exists catalog_review_private.reviewer (
 singleton boolean primary key default true check(singleton),
 user_id uuid not null references auth.users(id) on delete cascade,
 google_subject text not null check(btrim(google_subject)<>''),
 created_at timestamptz not null default now()
);
create table if not exists catalog_review_private.items (
 source_id text primary key check(source_id ~ '^[0-9]+$'),
 category text not null, review_kind text not null check(review_kind in ('unverified','different')),
 image_url text check(image_url is null or image_url ~ '^https://maplestory\.io/'),
 comparison jsonb not null check(jsonb_typeof(comparison)='object'),
 proposals jsonb not null check(jsonb_typeof(proposals)='object'),
 draft jsonb not null check(jsonb_typeof(draft)='object'),
 status text not null default 'draft' check(status in ('draft','ready')),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);
create table if not exists catalog_review_private.edits (
 id bigint generated always as identity primary key,
 source_id text not null references catalog_review_private.items(source_id),
 before_draft jsonb not null,after_draft jsonb not null,
 before_status text not null,after_status text not null,
 changed_by uuid references auth.users(id) on delete set null, changed_at timestamptz not null default now()
);
create index if not exists catalog_review_items_status_idx on catalog_review_private.items(status,source_id);
alter table catalog_review_private.reviewer enable row level security;
alter table catalog_review_private.items enable row level security;
alter table catalog_review_private.edits enable row level security;
revoke all on all tables in schema catalog_review_private from public,anon,authenticated;
revoke all on all sequences in schema catalog_review_private from public,anon,authenticated;

-- 앱에서 바꿀 수 있는 사용자 메타데이터/이메일 문자열을 권한 근거로 삼지 않습니다.
-- 등록된 사용자 UUID와 서버의 검증된 Google identity를 함께 확인합니다.
create or replace function public.can_review_catalog()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from catalog_review_private.reviewer r join auth.identities i on i.user_id=r.user_id
  where r.singleton and r.user_id=auth.uid() and i.provider='google'
   and i.provider_id=r.google_subject and i.identity_data->>'email_verified'='true'
 );
$$;
revoke all on function public.can_review_catalog() from public;
grant execute on function public.can_review_catalog() to anon,authenticated;

create or replace function catalog_review_private.valid_draft(d jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare e record;
begin
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>100000
  or (d-array['name','description','effect_description','base_options','requirements','review_note'])<>'{}'::jsonb
  or jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 200
  or jsonb_typeof(d->'description') is distinct from 'string' or length(d->>'description')>20000
  or jsonb_typeof(d->'effect_description') is distinct from 'string' or length(d->>'effect_description')>20000
  or jsonb_typeof(d->'review_note') is distinct from 'string' or length(d->>'review_note')>4000
  or not public.valid_item_options(d->'base_options')
  or jsonb_typeof(d->'requirements') is distinct from 'object' then return false; end if;
 for e in select key,value from jsonb_each(d->'requirements') loop
  if e.key in ('level','str','dex','int','luk','fame') then
   if jsonb_typeof(e.value)<>'number' or (e.value::text)::numeric<>trunc((e.value::text)::numeric)
    or (e.value::text)::numeric<0 or (e.value::text)::numeric>2147483647 then return false; end if;
  elsif e.key in ('REQ JOB','GENDER') then
   if jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>100 then return false; end if;
  else return false; end if;
 end loop;
 return true;
end $$;
revoke all on function catalog_review_private.valid_draft(jsonb) from public,anon,authenticated;

create or replace function public.catalog_review_list(p_query text default '',p_kind text default '',p_status text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_query is null or length(p_query)>100 or p_kind is null or p_kind not in ('','different','unverified')
  or p_status is null or p_status not in ('','draft','ready') or p_page is null or p_page<0 or p_page>10000 then raise exception '조회 조건 오류'; end if;
 with filtered as (select * from catalog_review_private.items
  where (p_query='' or strpos(lower(draft->>'name'),lower(p_query))>0 or source_id=p_query)
  and (p_kind='' or review_kind=p_kind) and (p_status='' or status=p_status)),
 paged as (select source_id,category,review_kind,status,revision,updated_at,draft->>'name' name,image_url
  from filtered order by source_id::bigint limit 24 offset p_page*24)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by source_id::bigint) from paged p),'[]'),
 'counts',jsonb_build_object('all',(select count(*) from catalog_review_private.items),'ready',(select count(*) from catalog_review_private.items where status='ready'))) into result;
 return result;
end $$;

create or replace function public.catalog_review_detail(p_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select to_jsonb(i) into result from catalog_review_private.items i where source_id=p_id;
 return result;
end $$;

create or replace function public.catalog_review_save(p_id text,p_revision integer,p_draft jsonb,p_status text default 'draft')
returns jsonb language plpgsql security definer set search_path='' as $$
declare old catalog_review_private.items; result jsonb;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_status is null or p_status not in ('draft','ready') or not catalog_review_private.valid_draft(p_draft) then raise exception '이름·설명·옵션 입력을 확인해 주세요'; end if;
 select * into old from catalog_review_private.items where source_id=p_id for update;
 if not found then raise exception '검토 항목이 없습니다'; end if;
 if p_revision is null or old.revision<>p_revision then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
 if old.draft=p_draft and old.status=p_status then return to_jsonb(old); end if;
 insert into catalog_review_private.edits(source_id,before_draft,after_draft,before_status,after_status,changed_by)
 values(p_id,old.draft,p_draft,old.status,p_status,auth.uid());
 update catalog_review_private.items set draft=p_draft,status=p_status,revision=revision+1,updated_at=now(),updated_by=auth.uid()
 where source_id=p_id returning to_jsonb(items) into result;
 return result;
end $$;
revoke all on function public.catalog_review_list(text,text,text,integer),public.catalog_review_detail(text),public.catalog_review_save(text,integer,jsonb,text) from public,anon;
grant execute on function public.catalog_review_list(text,text,text,integer),public.catalog_review_detail(text),public.catalog_review_save(text,integer,jsonb,text) to authenticated;
-- 공개 도감·공개 변경 이력에 쓰는 함수는 만들지 않습니다.
commit;
