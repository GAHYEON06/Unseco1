-- =====================================================================
--  디지털 성돌 — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
--  실행 순서: 1) 이 파일  2) seed_slots.sql
-- =====================================================================

-- ── 1. 성돌 자리 (사진에서 검출된 실제 돌 좌표) ─────────────────────
create table if not exists public.slots (
  idx int primary key,
  x   real not null,          -- 사진 왼쪽에서부터 백분율
  y   real not null,          -- 사진 위에서부터 백분율
  w   real not null default 1 -- 돌 너비(백분율), 배치 계산용
);

-- ── 2. 시민이 남긴 성돌 ────────────────────────────────────────────
create table if not exists public.stones (
  id         bigint generated always as identity primary key,
  slot       int not null unique references public.slots(idx),
  message    text not null check (char_length(message) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists stones_created_at_idx on public.stones (created_at desc);

-- ── 3. 남용 방지용 기록 (IP 해시만 저장, 원문 IP는 저장하지 않음) ───
create table if not exists public.submissions (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

create index if not exists submissions_ip_time_idx
  on public.submissions (ip_hash, created_at desc);

-- ── 4. RLS: 읽기는 누구나, 쓰기는 서버(service_role)만 ──────────────
alter table public.slots      enable row level security;
alter table public.stones     enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "slots readable"  on public.slots;
drop policy if exists "stones readable" on public.stones;

create policy "slots readable"  on public.slots  for select using (true);
create policy "stones readable" on public.stones for select using (true);
-- submissions 에는 select 정책을 만들지 않습니다 → 클라이언트는 접근 불가.
-- insert/update/delete 정책이 없으므로 anon 키로는 쓰기가 전부 차단됩니다.
-- 서버의 service_role 키만 RLS를 우회해 쓸 수 있습니다.

-- ── 5. 성돌 놓기: 비어 있는 자리 하나를 원자적으로 차지 ─────────────
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

  -- 동시에 여러 명이 눌러도 같은 자리를 두 번 쓰지 않도록 행을 잠급니다.
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

-- ── 6. 현황 요약 (상단 카운터용) ────────────────────────────────────
create or replace view public.stone_stats as
select
  (select count(*) from public.stones)                                    as total,
  (select count(*) from public.stones
     where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul')
                         at time zone 'Asia/Seoul')                       as today,
  (select count(*) from public.slots)                                     as capacity;

grant select on public.stone_stats to anon, authenticated;

-- ── 7. Realtime: 새 성돌이 켜지면 모든 접속자에게 즉시 전송 ─────────
alter publication supabase_realtime add table public.stones;
