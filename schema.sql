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
