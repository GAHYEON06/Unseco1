-- =====================================================================
--  디지털 성돌 — 메시지 길이 제한 50자 → 200자
--  이미 배포한 프로젝트에서만 실행하세요. (schema.sql 은 이미 200자로 갱신됨)
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
-- =====================================================================

-- 1. stones 테이블의 길이 제약 교체
alter table public.stones drop constraint if exists stones_message_check;
alter table public.stones
  add constraint stones_message_check check (char_length(message) between 1 and 200);

-- 2. place_stone() 함수의 내부 검증도 200자로
create or replace function public.place_stone(msg text)
returns public.stones
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.stones;
  clean  text := btrim(msg);
begin
  if char_length(clean) < 1 or char_length(clean) > 200 then
    raise exception 'MESSAGE_LENGTH' using errcode = 'P0001';
  end if;

  insert into public.stones (slot, message)
  select s.idx, clean
  from public.slots s
  where not exists (select 1 from public.stones st where st.slot = s.idx)
  order by random()
  limit 1
  returning * into result;

  if result is null then
    raise exception 'WALL_FULL' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.place_stone(text) from public, anon, authenticated;
