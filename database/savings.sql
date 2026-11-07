-- ActivityPlus: savings tables (already applied to the Supabase project; kept here for reference)

alter table public.activityplus_goals add column if not exists client_id bigint;
create unique index if not exists activityplus_goals_user_client_uidx on public.activityplus_goals (user_id, client_id);
create index if not exists activityplus_goals_user_idx on public.activityplus_goals (user_id);

create table if not exists public.activityplus_savings_tx (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id bigint not null,
  goal_client_id bigint not null,
  goal_name text not null,
  type text not null check (type in ('deposit','withdraw')),
  amount numeric not null check (amount > 0),
  currency text not null,
  tx_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists activityplus_savings_tx_user_goal_idx on public.activityplus_savings_tx (user_id, goal_client_id);

alter table public.activityplus_savings_tx
  add constraint activityplus_savings_tx_goal_fk
  foreign key (user_id, goal_client_id)
  references public.activityplus_goals (user_id, client_id) on delete cascade;

alter table public.activityplus_savings_tx enable row level security;
create policy activityplus_savings_tx_all_own on public.activityplus_savings_tx
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- goal.saved is kept in step with its transactions on the server
create or replace function public.activityplus_sync_goal_saved()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare g_uid uuid; g_cid bigint; total numeric;
begin
  if tg_op = 'DELETE' then g_uid := old.user_id; g_cid := old.goal_client_id;
  else g_uid := new.user_id; g_cid := new.goal_client_id; end if;
  select coalesce(sum(case when type = 'deposit' then amount else -amount end), 0) into total
    from public.activityplus_savings_tx where user_id = g_uid and goal_client_id = g_cid;
  if total < 0 and tg_op <> 'DELETE' then
    raise exception 'Withdrawal is more than the amount saved in this goal';
  end if;
  update public.activityplus_goals set saved = greatest(total, 0), updated_at = now()
   where user_id = g_uid and client_id = g_cid;
  return null;
end; $$;

create trigger activityplus_savings_tx_sync
  after insert or update or delete on public.activityplus_savings_tx
  for each row execute function public.activityplus_sync_goal_saved();
