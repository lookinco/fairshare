-- FairShare v2 — initial schema
-- Run: supabase db push   (or paste into Supabase SQL editor)
--
-- Model: the "wallet" that a group splits across is a PARTICIPANT — either a
-- solo user or a family (a bundle of weighted members). See fairshare-v2-spec.md.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users (Supabase owns auth.users)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  weight       numeric not null default 1.0,   -- solo participant weight
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- families and their members
-- ---------------------------------------------------------------------------
create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists family_members (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id) on delete cascade,
  name       text not null,
  birthday   date,
  weight     numeric not null default 1.0,
  height     numeric,
  role       text not null default 'adult' check (role in ('adult','child','toddler')),
  user_id    uuid references auth.users(id) on delete set null,  -- null = no account (kid)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- groups and participants (a participant = one solo user OR one family)
-- ---------------------------------------------------------------------------
create table if not exists groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  theme      text,
  join_code  text unique not null default encode(gen_random_bytes(6), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists group_participants (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  kind       text not null check (kind in ('user','family')),
  user_id    uuid references auth.users(id) on delete cascade,
  family_id  uuid references families(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','member')),
  joined_at  timestamptz not null default now(),
  -- exactly one of user_id / family_id is set, matching kind
  constraint participant_ref_matches_kind check (
    (kind = 'user'   and user_id   is not null and family_id is null) or
    (kind = 'family' and family_id is not null and user_id   is null)
  ),
  unique (group_id, user_id),
  unique (group_id, family_id)
);

-- ---------------------------------------------------------------------------
-- events (optional tag for a shared gathering with many buyers)
-- ---------------------------------------------------------------------------
create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  name       text not null,
  date       date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- expenses (+ items +receipts)
-- ---------------------------------------------------------------------------
create table if not exists expenses (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references groups(id) on delete cascade,
  event_id              uuid references events(id) on delete set null,
  payer_participant_id  uuid not null references group_participants(id) on delete cascade,
  amount                numeric not null check (amount >= 0),
  currency              text not null default 'USD',
  kind                  text not null default 'tally' check (kind in ('tally','itemized')),
  note                  text,
  tax                   numeric not null default 0,
  tip                   numeric not null default 0,
  created_by            uuid not null references auth.users(id) on delete set null,
  created_at            timestamptz not null default now()
);

create table if not exists expense_items (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  name       text not null,
  qty        numeric not null default 1,
  price      numeric not null default 0
);

create table if not exists receipts (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references expenses(id) on delete cascade,
  storage_path text not null,             -- object path in the 'receipts' storage bucket
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- settlements + activity log
-- ---------------------------------------------------------------------------
create table if not exists settlements (
  id                     uuid primary key default gen_random_uuid(),
  group_id               uuid not null references groups(id) on delete cascade,
  from_participant_id    uuid not null references group_participants(id) on delete cascade,
  to_participant_id      uuid not null references group_participants(id) on delete cascade,
  amount                 numeric not null check (amount > 0),
  currency               text not null default 'USD',
  method                 text not null default 'mark_paid' check (method in ('mark_paid','link')),
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now()
);

create table if not exists activity_log (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     uuid,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_expenses_group     on expenses(group_id);
create index if not exists idx_settlements_group  on settlements(group_id);
create index if not exists idx_activity_group      on activity_log(group_id, created_at desc);
create index if not exists idx_gp_group            on group_participants(group_id);

-- ===========================================================================
-- Row Level Security
-- Membership rule: you can see/act on a group if you are a participant of it,
-- either as a solo user or as an adult member (linked user_id) of a family
-- that participates. Helper below centralizes that check.
-- ===========================================================================
create or replace function is_group_member(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_participants gp
    where gp.group_id = gid
      and (
        gp.user_id = uid
        or gp.family_id in (
          select fm.family_id from family_members fm where fm.user_id = uid
        )
      )
  );
$$;

alter table profiles            enable row level security;
alter table families            enable row level security;
alter table family_members      enable row level security;
alter table groups              enable row level security;
alter table group_participants  enable row level security;
alter table events              enable row level security;
alter table expenses            enable row level security;
alter table expense_items       enable row level security;
alter table receipts            enable row level security;
alter table settlements         enable row level security;
alter table activity_log        enable row level security;

-- profiles: everyone can read (needed to render names/avatars); you edit only yours
create policy profiles_read   on profiles for select using (true);
create policy profiles_upsert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid());

-- families: creator manages; members can read
create policy families_read   on families for select
  using (created_by = auth.uid()
         or id in (select family_id from family_members where user_id = auth.uid()));
create policy families_insert  on families for insert with check (created_by = auth.uid());
create policy families_update  on families for update using (created_by = auth.uid());
create policy families_delete  on families for delete using (created_by = auth.uid());

-- family_members: manage if you own the family; read if you own or are that member
create policy fm_read   on family_members for select
  using (user_id = auth.uid()
         or family_id in (select id from families where created_by = auth.uid()));
create policy fm_write  on family_members for all
  using (family_id in (select id from families where created_by = auth.uid()))
  with check (family_id in (select id from families where created_by = auth.uid()));

-- groups: members read; anyone can create; creator updates
create policy groups_read   on groups for select using (is_group_member(id, auth.uid()));
create policy groups_insert on groups for insert with check (created_by = auth.uid());
create policy groups_update on groups for update using (created_by = auth.uid());

-- group_participants: members read the roster; you can add yourself (join),
-- and the group owner can manage the roster.
create policy gp_read   on group_participants for select using (is_group_member(group_id, auth.uid()));
create policy gp_insert on group_participants for insert
  with check (
    user_id = auth.uid()  -- joining yourself
    or group_id in (select id from groups where created_by = auth.uid())
  );
create policy gp_delete on group_participants for delete
  using (user_id = auth.uid()
         or group_id in (select id from groups where created_by = auth.uid()));

-- everything scoped to a group: readable + writable by group members
create policy events_all on events for all
  using (is_group_member(group_id, auth.uid()))
  with check (is_group_member(group_id, auth.uid()));

create policy expenses_all on expenses for all
  using (is_group_member(group_id, auth.uid()))
  with check (is_group_member(group_id, auth.uid()));

create policy expense_items_all on expense_items for all
  using (expense_id in (select id from expenses where is_group_member(group_id, auth.uid())))
  with check (expense_id in (select id from expenses where is_group_member(group_id, auth.uid())));

create policy receipts_all on receipts for all
  using (expense_id in (select id from expenses where is_group_member(group_id, auth.uid())))
  with check (expense_id in (select id from expenses where is_group_member(group_id, auth.uid())));

create policy settlements_all on settlements for all
  using (is_group_member(group_id, auth.uid()))
  with check (is_group_member(group_id, auth.uid()));

create policy activity_read   on activity_log for select using (is_group_member(group_id, auth.uid()));
create policy activity_insert on activity_log for insert with check (is_group_member(group_id, auth.uid()));
