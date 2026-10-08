-- Study Battle database: profile data, server-timed focus sessions, friends, and cosmetics.
-- Apply this migration to a new Supabase project using the SQL Editor or Supabase CLI.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  coins integer not null default 0 check (coins >= 0),
  focus_seconds bigint not null default 0 check (focus_seconds >= 0),
  coin_progress_seconds integer not null default 0 check (coin_progress_seconds >= 0 and coin_progress_seconds < 3600),
  streak_days integer not null default 0 check (streak_days >= 0),
  last_study_date date,
  is_plus boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (subject in ('Deep work', 'Mathematics', 'Science', 'Languages', 'Reading', 'Other')),
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  started_at timestamptz not null default now(),
  resumed_at timestamptz,
  ended_at timestamptz,
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  coins_awarded integer not null default 0 check (coins_awarded >= 0),
  created_at timestamptz not null default now(),
  constraint study_sessions_state_consistent check (
    (status = 'active' and resumed_at is not null and ended_at is null)
    or (status = 'paused' and resumed_at is null and ended_at is null)
    or (status = 'finished' and resumed_at is null and ended_at is not null)
  )
);

create index if not exists study_sessions_user_recent_idx on public.study_sessions (user_id, ended_at desc);
create unique index if not exists one_open_session_per_user_idx on public.study_sessions (user_id) where status in ('active', 'paused');

create table if not exists public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendships_cannot_self_follow check (user_id <> friend_id)
);

create table if not exists public.shop_products (
  id text primary key,
  name text not null,
  description text not null,
  emoji text not null,
  coin_cost integer not null check (coin_cost >= 0),
  category text not null check (category in ('desk', 'theme', 'break', 'fun')),
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.user_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.shop_products (id),
  purchased_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.profiles enable row level security;
alter table public.study_sessions enable row level security;
alter table public.friendships enable row level security;
alter table public.shop_products enable row level security;
alter table public.user_items enable row level security;

-- Only authenticated users can read the public leaderboard fields in profiles.
create policy "Authenticated users can view leaderboard profiles"
  on public.profiles for select to authenticated using (auth.uid() is not null);
create policy "Users can read their own study sessions"
  on public.study_sessions for select to authenticated using (auth.uid() = user_id);
create policy "Users can view their own friend list"
  on public.friendships for select to authenticated using (auth.uid() = user_id);
create policy "Users can remove friends from their own list"
  on public.friendships for delete to authenticated using (auth.uid() = user_id);
create policy "Authenticated users can view active shop products"
  on public.shop_products for select to authenticated using (is_active);
create policy "Users can view their own collection"
  on public.user_items for select to authenticated using (auth.uid() = user_id);

-- No client-side profile or score writes. Profile mutations and reward changes go through the RPCs below.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.study_sessions from anon, authenticated;
grant select on public.study_sessions to authenticated;
revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;
revoke all on public.shop_products from anon, authenticated;
grant select on public.shop_products to authenticated;
revoke all on public.user_items from anon, authenticated;
grant select on public.user_items to authenticated;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, 'student'), '@', 1)), '[^a-zA-Z0-9_]', '', 'g'));
  requested_username := left(requested_username, 20);
  if length(requested_username) < 3 then
    requested_username := 'student_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  insert into public.profiles (id, username) values (new.id, requested_username);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_study_battle on auth.users;
create trigger on_auth_user_created_study_battle
  after insert on auth.users
  for each row execute procedure public.create_profile_for_user();

create or replace function public.update_my_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_username text := lower(trim(p_username));
begin
  if auth.uid() is null then raise exception 'Sign in to change your username.'; end if;
  if cleaned_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Use 3–20 lowercase letters, numbers, or underscores.';
  end if;
  update public.profiles set username = cleaned_username where id = auth.uid();
  if not found then raise exception 'Your profile could not be found.'; end if;
  return cleaned_username;
exception when unique_violation then
  raise exception 'That username is already in use.';
end;
$$;

create or replace function public.start_study_session(p_subject text)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_session public.study_sessions;
begin
  if current_user_id is null then raise exception 'Sign in to start a study session.'; end if;
  perform 1 from public.profiles where id = current_user_id for update;
  if not found then raise exception 'Your profile could not be found.'; end if;
  if exists (select 1 from public.study_sessions where user_id = current_user_id and status in ('active', 'paused')) then
    raise exception 'Finish or resume your current session first.';
  end if;
  insert into public.study_sessions (user_id, subject, status, started_at, resumed_at)
  values (current_user_id, p_subject, 'active', clock_timestamp(), clock_timestamp())
  returning * into new_session;
  return new_session;
end;
$$;

create or replace function public.pause_study_session(p_session_id uuid)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_session public.study_sessions;
begin
  if auth.uid() is null then raise exception 'Sign in to manage a study session.'; end if;
  update public.study_sessions
  set elapsed_seconds = elapsed_seconds + greatest(0, floor(extract(epoch from clock_timestamp() - resumed_at))::integer),
      resumed_at = null,
      status = 'paused'
  where id = p_session_id and user_id = auth.uid() and status = 'active'
  returning * into changed_session;
  if not found then raise exception 'This session is no longer running.'; end if;
  return changed_session;
end;
$$;

create or replace function public.resume_study_session(p_session_id uuid)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_session public.study_sessions;
begin
  if auth.uid() is null then raise exception 'Sign in to manage a study session.'; end if;
  update public.study_sessions set resumed_at = clock_timestamp(), status = 'active'
  where id = p_session_id and user_id = auth.uid() and status = 'paused'
  returning * into changed_session;
  if not found then raise exception 'This session cannot be resumed.'; end if;
  return changed_session;
end;
$$;

create or replace function public.finish_study_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_session public.study_sessions;
  new_elapsed integer;
  old_coin_progress integer;
  earned_coins integer;
  new_streak integer;
  result_profile public.profiles;
begin
  if current_user_id is null then raise exception 'Sign in to save a study session.'; end if;
  perform 1 from public.profiles where id = current_user_id for update;
  select * into target_session from public.study_sessions
  where id = p_session_id and user_id = current_user_id for update;
  if not found or target_session.status not in ('active', 'paused') then
    raise exception 'This session has already been saved or could not be found.';
  end if;

  new_elapsed := target_session.elapsed_seconds;
  if target_session.status = 'active' then
    new_elapsed := new_elapsed + greatest(0, floor(extract(epoch from clock_timestamp() - target_session.resumed_at))::integer);
  end if;

  select coin_progress_seconds into old_coin_progress from public.profiles where id = current_user_id;
  select case when is_plus then 20 else 10 end * floor((old_coin_progress + new_elapsed)::numeric / 3600)::integer
    into earned_coins from public.profiles where id = current_user_id;

  update public.study_sessions
  set status = 'finished', resumed_at = null, ended_at = clock_timestamp(),
      elapsed_seconds = new_elapsed, coins_awarded = earned_coins
  where id = p_session_id returning * into target_session;

  select case
    when last_study_date = current_date then streak_days
    when last_study_date = current_date - 1 then streak_days + 1
    else 1
  end into new_streak from public.profiles where id = current_user_id;

  update public.profiles
  set focus_seconds = focus_seconds + new_elapsed,
      coins = coins + earned_coins,
      coin_progress_seconds = mod(old_coin_progress + new_elapsed, 3600),
      streak_days = new_streak,
      last_study_date = current_date
  where id = current_user_id returning * into result_profile;

  return jsonb_build_object('coins_earned', earned_coins, 'session', to_jsonb(target_session), 'coins_balance', result_profile.coins);
end;
$$;

create or replace function public.add_friend_by_username(p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to add a study buddy.'; end if;
  select id into target_id from public.profiles where username = lower(trim(p_username));
  if target_id is null then raise exception 'We could not find that username.'; end if;
  if target_id = auth.uid() then raise exception 'You are already on your own study team.'; end if;
  insert into public.friendships (user_id, friend_id) values (auth.uid(), target_id)
  on conflict (user_id, friend_id) do nothing;
end;
$$;

create or replace function public.purchase_shop_item(p_product_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  product public.shop_products;
  current_balance integer;
begin
  if current_user_id is null then raise exception 'Sign in to shop for focus rewards.'; end if;
  select * into product from public.shop_products where id = p_product_id and is_active;
  if not found then raise exception 'This item is not available.'; end if;
  perform 1 from public.profiles where id = current_user_id for update;
  if exists (select 1 from public.user_items where user_id = current_user_id and product_id = p_product_id) then
    raise exception 'You already own this item.';
  end if;
  select coins into current_balance from public.profiles where id = current_user_id;
  if current_balance < product.coin_cost then raise exception 'You need more focus coins for this item.'; end if;
  update public.profiles set coins = coins - product.coin_cost where id = current_user_id returning coins into current_balance;
  insert into public.user_items (user_id, product_id) values (current_user_id, p_product_id);
  return jsonb_build_object('message', product.name || ' added to your collection!', 'coins_balance', current_balance);
end;
$$;

revoke all on function public.create_profile_for_user() from public, anon, authenticated;
revoke all on function public.update_my_username(text) from public, anon;
revoke all on function public.start_study_session(text) from public, anon;
revoke all on function public.pause_study_session(uuid) from public, anon;
revoke all on function public.resume_study_session(uuid) from public, anon;
revoke all on function public.finish_study_session(uuid) from public, anon;
revoke all on function public.add_friend_by_username(text) from public, anon;
revoke all on function public.purchase_shop_item(text) from public, anon;
grant execute on function public.update_my_username(text) to authenticated;
grant execute on function public.start_study_session(text) to authenticated;
grant execute on function public.pause_study_session(uuid) to authenticated;
grant execute on function public.resume_study_session(uuid) to authenticated;
grant execute on function public.finish_study_session(uuid) to authenticated;
grant execute on function public.add_friend_by_username(text) to authenticated;
grant execute on function public.purchase_shop_item(text) to authenticated;

insert into public.shop_products (id, name, description, emoji, coin_cost, category, sort_order) values
  ('desk-raccoon', 'Tiny desk raccoon', 'A very serious supervisor for your next study session.', '🦝', 25, 'desk', 1),
  ('galaxy-theme', 'Galaxy desk theme', 'A little cosmic color for your focus room.', '🌌', 40, 'theme', 2),
  ('nap-break', 'Nap spell', 'A reminder that your rival deserves a tiny break too.', '😴', 30, 'break', 3),
  ('emergency-pizza', 'Emergency pizza', 'A tiny celebration for an extremely productive human.', '🍕', 15, 'fun', 4),
  ('motivational-duck', 'Motivational duck', 'One imaginary quack. Surprisingly solid advice.', '🦆', 10, 'fun', 5),
  ('five-minute-break', 'Five-minute break', 'A guilt-free nudge to stand up and stretch.', '🧃', 20, 'break', 6)
on conflict (id) do update set name = excluded.name, description = excluded.description, emoji = excluded.emoji,
  coin_cost = excluded.coin_cost, category = excluded.category, sort_order = excluded.sort_order, is_active = true;
