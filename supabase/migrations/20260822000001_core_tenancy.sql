-- Core multi-tenancy, roles, and the RLS helper functions every other
-- migration depends on.
--
-- Deviations from `ai_docs/database_arch copy.md` are deliberate and noted inline.

-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
-- NOTE: the blueprint calls for uuid-ossp + uuid_generate_v4(). Postgres 13+
-- ships gen_random_uuid() in core, so the extension is unnecessary.
create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. PRIVATE SCHEMA FOR SECURITY-DEFINER HELPERS
-- ============================================================================
-- The blueprint puts current_user_has_workspace_role() in `public` as SECURITY
-- DEFINER. Postgres grants EXECUTE to PUBLIC on every new function, which would
-- make it a callable API endpoint for anon. It lives in an unexposed schema
-- instead, with EXECUTE granted only to authenticated.
create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

-- ============================================================================
-- 2. ROLES & WORKSPACES
-- ============================================================================
create type public.user_role_enum as enum (
    'workspace_owner',
    'ai_administrator',
    'compliance_auditor',
    'agent_operator',
    'business_user'
);

create table public.workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    enterprise_tier text not null default 'enterprise_sla_tier_1',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.workspace_members (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role public.user_role_enum not null default 'business_user',
    created_at timestamptz not null default now(),
    unique (workspace_id, user_id)
);

create index idx_workspace_members_user on public.workspace_members(user_id);
create index idx_workspace_members_workspace on public.workspace_members(workspace_id);

-- ============================================================================
-- 3. RLS HELPERS
-- ============================================================================
-- These are SECURITY DEFINER purely to break RLS recursion: a policy on
-- workspace_members cannot itself select from workspace_members. Both filter on
-- auth.uid() internally, so they never widen access beyond the caller.

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.workspace_members
        where workspace_id = p_workspace_id
          and user_id = (select auth.uid())
    );
$$;

create or replace function private.has_workspace_role(
    p_workspace_id uuid,
    p_required_roles public.user_role_enum[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.workspace_members
        where workspace_id = p_workspace_id
          and user_id = (select auth.uid())
          and role = any(p_required_roles)
    );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.has_workspace_role(uuid, public.user_role_enum[]) from public;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.user_role_enum[]) to authenticated;

-- Shared updated_at trigger.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_workspaces_updated_at
    before update on public.workspaces
    for each row execute function private.set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy workspaces_select_member on public.workspaces
    for select to authenticated
    using (private.is_workspace_member(id));

create policy workspaces_update_owner on public.workspaces
    for update to authenticated
    using (private.has_workspace_role(id, array['workspace_owner']::public.user_role_enum[]))
    with check (private.has_workspace_role(id, array['workspace_owner']::public.user_role_enum[]));

-- A member may always read the roster of a workspace they belong to.
create policy workspace_members_select on public.workspace_members
    for select to authenticated
    using (private.is_workspace_member(workspace_id));

-- Only owners and AI administrators manage membership. Separate policies per
-- command so UPDATE carries both USING and WITH CHECK (without WITH CHECK a
-- member could reassign a row to another workspace).
create policy workspace_members_insert on public.workspace_members
    for insert to authenticated
    with check (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
    ));

create policy workspace_members_update on public.workspace_members
    for update to authenticated
    using (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
    ))
    with check (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
    ));

create policy workspace_members_delete on public.workspace_members
    for delete to authenticated
    using (private.has_workspace_role(
        workspace_id,
        array['workspace_owner', 'ai_administrator']::public.user_role_enum[]
    ));

-- ============================================================================
-- 5. DATA API GRANTS
-- ============================================================================
-- As of 2026-04-28 new public tables are no longer auto-exposed to the Data
-- API (enforced 2026-10-30), so access is granted explicitly. RLS above still
-- governs which rows are visible.
grant usage on schema public to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
