-- Workspace bootstrap.
--
-- There is deliberately no INSERT policy on `workspaces`: creating one must
-- also create the owner membership, and two separate client writes could leave
-- an orphaned workspace that nobody can administer. This RPC does both in one
-- transaction instead.

create or replace function public.create_workspace(
    p_name text,
    p_slug text
)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_workspace public.workspaces;
begin
    -- SECURITY DEFINER bypasses RLS, so the caller is checked explicitly.
    if v_user_id is null then
        raise exception 'Not authenticated'
            using errcode = '42501';
    end if;

    if coalesce(trim(p_name), '') = '' then
        raise exception 'Workspace name is required'
            using errcode = '22023';
    end if;

    -- Normalize the slug rather than trusting client input, and reject one that
    -- normalizes to nothing.
    p_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-zA-Z0-9]+', '-', 'g'));
    p_slug := trim(both '-' from p_slug);

    if p_slug = '' then
        raise exception 'Workspace slug is required'
            using errcode = '22023';
    end if;

    insert into public.workspaces (name, slug)
    values (trim(p_name), p_slug)
    returning * into v_workspace;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_workspace.id, v_user_id, 'workspace_owner');

    -- Every workspace gets budget controls so the FinOps gate always has a row
    -- to read.
    insert into public.finops_budget_controls (workspace_id)
    values (v_workspace.id);

    return v_workspace;
end;
$$;

revoke all on function public.create_workspace(text, text) from public;
grant execute on function public.create_workspace(text, text) to authenticated;
