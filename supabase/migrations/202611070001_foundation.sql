-- Apply to a dedicated Supabase project. Add your auth user to app_members
-- through the SQL editor before connecting a client. No public sign-up access.
create table public.app_members (user_id uuid primary key references auth.users(id));
alter table public.app_members enable row level security;

create table public.workspace_events (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  actor_id text not null,
  clock bigint not null check (clock > 0),
  created_at timestamptz not null,
  payload text not null check (octet_length(payload) <= 100000)
);
create index workspace_events_owner on public.workspace_events(owner_id);
alter table public.workspace_events enable row level security;
create policy read_own_events on public.workspace_events for select to authenticated using (owner_id = auth.uid());
grant select on public.workspace_events to authenticated;
revoke insert, update, delete on public.workspace_events from anon, authenticated;

create or replace function public.append_workspace_events(events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; existing public.workspace_events; uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.app_members where user_id = uid) then
    raise exception 'Workspace access denied';
  end if;
  if jsonb_typeof(events) <> 'array' or jsonb_array_length(events) > 1000 then raise exception 'Invalid event batch'; end if;
  for item in select * from jsonb_array_elements(events) loop
    if jsonb_typeof((item->>'payload')::jsonb) <> 'object' then raise exception 'Invalid event payload'; end if;
    insert into public.workspace_events(id, owner_id, actor_id, clock, created_at, payload)
    values ((item->>'id')::uuid, uid, item->>'actor_id', (item->>'clock')::bigint, (item->>'created_at')::timestamptz, item->>'payload')
    on conflict (id) do nothing;
    select * into existing from public.workspace_events where id = (item->>'id')::uuid;
    if existing.owner_id <> uid or existing.actor_id <> item->>'actor_id' or existing.clock <> (item->>'clock')::bigint or existing.payload <> item->>'payload' then
      raise exception 'Event identifier collision';
    end if;
  end loop;
end;
$$;
revoke all on function public.append_workspace_events(jsonb) from public;
grant execute on function public.append_workspace_events(jsonb) to authenticated;

create table public.print_jobs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  snapshot jsonb not null check (octet_length(snapshot::text) < 1000000),
  status text not null default 'queued' check (status in ('queued', 'processing', 'dispatched', 'failed', 'uncertain')),
  worker_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error text
);
alter table public.print_jobs enable row level security;
create policy read_own_jobs on public.print_jobs for select to authenticated using (owner_id = auth.uid());
create policy queue_own_jobs on public.print_jobs for insert to authenticated with check (
  owner_id = auth.uid() and status = 'queued' and worker_id is null
  and exists (select 1 from public.app_members where user_id = auth.uid())
);
create policy read_own_membership on public.app_members for select to authenticated using (user_id = auth.uid());
grant select on public.app_members to authenticated;
grant select, insert on public.print_jobs to authenticated;
revoke update, delete on public.print_jobs from anon, authenticated;

create or replace function public.claim_print_job(worker text)
returns setof public.print_jobs language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_members where user_id = auth.uid()) then raise exception 'Workspace access denied'; end if;
  return query update public.print_jobs set status = 'processing', worker_id = worker, updated_at = now()
  where id = (select id from public.print_jobs where owner_id = auth.uid() and status = 'queued' order by created_at for update skip locked limit 1)
  returning *;
end;
$$;
create or replace function public.finish_print_job(job uuid, worker text, outcome text, detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if outcome not in ('dispatched', 'failed', 'uncertain') then raise exception 'Invalid print outcome'; end if;
  update public.print_jobs set status = outcome, error = left(detail, 2000), updated_at = now()
  where id = job and owner_id = auth.uid() and worker_id = worker and status in ('processing', 'dispatched', 'failed', 'uncertain');
  if not found then raise exception 'Job is not assigned to this worker'; end if;
end;
$$;
revoke all on function public.claim_print_job(text) from public;
revoke all on function public.finish_print_job(uuid, text, text, text) from public;
grant execute on function public.claim_print_job(text) to authenticated;
grant execute on function public.finish_print_job(uuid, text, text, text) to authenticated;

-- Use the PowerSync dashboard's documented replication role / publication
-- setup for this project. Only workspace_events needs replication initially.
