-- ============================================================
--  흑선행 — Supabase 데이터베이스 설정
--  Supabase 대시보드 > SQL Editor 에 이 내용을 통째로 붙여넣고 Run 을 누르세요.
--  (한 번만 실행하면 됩니다)
-- ============================================================

-- 캐릭터 기록 표
create table if not exists public.players (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null unique check (char_length(nickname) between 1 and 12),
  state       jsonb not null,               -- 캐릭터 전체 상태 (위치, 행낭, 장비 등)
  merit       integer not null default 0,   -- 공적 (전공록 순위용)
  level       integer not null default 1,   -- 경지 (전공록 표시용)
  updated_at  timestamptz not null default now()
);

create index if not exists players_merit_idx on public.players (merit desc);

-- 두상(100x100 그림)과 프로필(소속, 한마디, 두상 출처)
alter table public.players add column if not exists avatar text;
alter table public.players add column if not exists profile jsonb not null default '{}'::jsonb;
alter table public.players drop constraint if exists players_avatar_size;
alter table public.players add constraint players_avatar_size
  check (avatar is null or (avatar like 'data:image/%' and length(avatar) <= 150000));

-- 보안 규칙(RLS): 남의 기록은 볼 수만 있고, 내 기록만 만들고 고칠 수 있다
alter table public.players enable row level security;

drop policy if exists "누구나 읽기" on public.players;
create policy "누구나 읽기" on public.players
  for select to anon, authenticated using (true);

drop policy if exists "내 기록 만들기" on public.players;
create policy "내 기록 만들기" on public.players
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "내 기록 고치기" on public.players;
create policy "내 기록 고치기" on public.players
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 웹페이지에서 표에 접근할 수 있도록 권한 부여
grant select on public.players to anon, authenticated;
grant insert, update on public.players to authenticated;

-- ============================================================
--  교환: 참가자끼리 보내는 꾸러미
--  (받는 사람이 접속하면 꾸러미를 받으면서 이 표에서 지워집니다)
-- ============================================================
create table if not exists public.gifts (
  id          bigint generated always as identity primary key,
  from_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_name   text not null,
  to_id       uuid not null references public.players(id) on delete cascade,
  items       jsonb not null,
  note        text check (note is null or char_length(note) <= 60),
  created_at  timestamptz not null default now()
);
create index if not exists gifts_to_idx on public.gifts (to_id);

alter table public.gifts enable row level security;

drop policy if exists "내가 보내기" on public.gifts;
create policy "내가 보내기" on public.gifts
  for insert to authenticated with check (from_id = auth.uid() and to_id <> auth.uid());

drop policy if exists "주고받은 것만 보기" on public.gifts;
create policy "주고받은 것만 보기" on public.gifts
  for select to authenticated using (to_id = auth.uid() or from_id = auth.uid());

drop policy if exists "받은 것 받아가기" on public.gifts;
create policy "받은 것 받아가기" on public.gifts
  for delete to authenticated using (to_id = auth.uid());

grant select, insert, delete on public.gifts to authenticated;

-- ============================================================
--  공동 임무: 날짜별 전체 진행도
--  직접 고칠 수는 없고, 아래 commune_add 함수로만 조금씩 더할 수 있습니다.
-- ============================================================
create table if not exists public.commune (
  day       date primary key,
  progress  integer not null default 0
);

alter table public.commune enable row level security;

drop policy if exists "누구나 진행도 보기" on public.commune;
create policy "누구나 진행도 보기" on public.commune
  for select to anon, authenticated using (true);

grant select on public.commune to anon, authenticated;

create or replace function public.commune_add(p_day date, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  v integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if p_amount < 1 or p_amount > 5 then raise exception '한 번에 1~5까지만 더할 수 있습니다'; end if;
  if p_day < today - 1 or p_day > today then raise exception '오늘의 공동 임무가 아닙니다'; end if;
  insert into public.commune as c (day, progress) values (p_day, p_amount)
    on conflict (day) do update set progress = c.progress + excluded.progress
    returning c.progress into v;
  return v;
end;
$$;

revoke all on function public.commune_add(date, integer) from public, anon;
grant execute on function public.commune_add(date, integer) to authenticated;

-- ============================================================
--  운영진(관리자)과 우편함
--  관리자 등록은 가이드의 "관리자 등록" SQL을 따로 실행하세요.
-- ============================================================
create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;   -- 정책 없음: 웹에서는 읽기·쓰기 불가

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()); $$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.mail (
  id          bigint generated always as identity primary key,
  to_id       uuid not null references public.players(id) on delete cascade,
  from_name   text not null default '풍운집결 운영진',
  title       text not null check (char_length(title) between 1 and 40),
  body        text check (body is null or char_length(body) <= 300),
  items       jsonb not null default '{}'::jsonb,
  sent_by     uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists mail_to_idx on public.mail (to_id);

alter table public.mail enable row level security;

drop policy if exists "운영진만 보내기" on public.mail;
create policy "운영진만 보내기" on public.mail
  for insert to authenticated with check (public.is_admin());

drop policy if exists "내 우편과 운영진" on public.mail;
create policy "내 우편과 운영진" on public.mail
  for select to authenticated using (to_id = auth.uid() or public.is_admin());

drop policy if exists "받기 또는 회수" on public.mail;
create policy "받기 또는 회수" on public.mail
  for delete to authenticated using (to_id = auth.uid() or public.is_admin());

grant select, insert, delete on public.mail to authenticated;
