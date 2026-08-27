-- Membership finally gets a writer, via invitations rather than a user lookup.
--
-- workspace_members has carried INSERT/UPDATE/DELETE policies for owners and
-- administrators since migration ...01, plus the grants, and nothing has ever
-- called them. Every workspace has exactly one member — its creator — so the
-- role hierarchy in migration ...22 is real but unexercised: there is no way to
-- appoint a compliance_auditor.
--
-- The obvious wiring is "look the invitee up in auth.users by email", and it is
-- rejected here. `authenticated` cannot read auth.users, so it would need a
-- SECURITY DEFINER RPC, and that RPC is an email-existence oracle: anyone who
-- administers any workspace could test addresses to learn who has an account on
-- the platform. In an enterprise tenant that leaks corporate relationships, and
-- it is permanent — there is no version of the lookup that does not answer the
-- question. It also cannot invite anyone who has not signed up yet, which is
-- the ordinary case when onboarding a team.
--
-- An invitation asks nothing. It records an intent against an address, and the
-- address proves itself later by being confirmed on an account.

create table public.workspace_invitations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    -- Stored lowercased; every comparison here is against a lowercased value.
    -- Address case is not identity, and a case-sensitive match would leave an
    -- invitation to Alice@corp silently unredeemed by alice@corp.
    email text not null,
    invited_by uuid references auth.users(id) on delete set null,
    invited_role public.user_role_enum not null default 'business_user',
    expires_at timestamptz not null default (now() + interval '7 days'),
    created_at timestamptz not null default now(),
    unique (workspace_id, email),
    constraint workspace_invitations_email_lowercase check (email = lower(email))
);

-- `on delete set null` on invited_by, not cascade: an invitation is a fact
-- about the workspace, and it should not evaporate because the admin who sent
-- it left the company. Who invited whom is also exactly what an auditor asks.

create index idx_workspace_invitations_email
    on public.workspace_invitations(email);
create index idx_workspace_invitations_workspace
    on public.workspace_invitations(workspace_id, created_at desc);

-- NO TOKEN COLUMN.
--
-- A secure random token only earns its place if it is what redemption checks.
-- Redemption here is "this account has proven control of this address", which
-- is strictly stronger than holding a link — a token in an inbox is a bearer
-- credential that forwarding, logging, or a shared mailbox all leak. Carrying
-- one that nothing verifies would be a credential stored for no reason.

alter table public.workspace_invitations enable row level security;

-- Per-command policies rather than FOR ALL, so UPDATE carries both USING and
-- WITH CHECK — the convention every other table here follows. FOR ALL applies
-- one USING to reads and deletes and one WITH CHECK to writes, which reads as
-- if it were the same rule and is not.

create policy workspace_invitations_select on public.workspace_invitations
    for select to authenticated
    using (private.has_role_power(workspace_id, 'ai_administrator'));

/**
 * You may not invite anyone to a rank above your own.
 *
 * `has_role_power(workspace_id, invited_role)` says the caller is at least as
 * powerful as the role they are handing out, which stops an ai_administrator
 * from minting a workspace_owner and then being outranked by their own
 * invitation. Exactly the ratchet argument from migration ...22, in the other
 * direction: there, a gate's bar may only rise; here, a grant may not exceed
 * the granter.
 */
create policy workspace_invitations_insert on public.workspace_invitations
    for insert to authenticated
    with check (
        private.has_role_power(workspace_id, 'ai_administrator')
        and private.has_role_power(workspace_id, invited_role)
    );

create policy workspace_invitations_update on public.workspace_invitations
    for update to authenticated
    using (private.has_role_power(workspace_id, 'ai_administrator'))
    with check (
        private.has_role_power(workspace_id, 'ai_administrator')
        and private.has_role_power(workspace_id, invited_role)
    );

create policy workspace_invitations_delete on public.workspace_invitations
    for delete to authenticated
    using (private.has_role_power(workspace_id, 'ai_administrator'));

-- New public tables are not auto-exposed to the Data API since 2026-04-28.
grant select, insert, update, delete on public.workspace_invitations to authenticated;
grant all on public.workspace_invitations to service_role;

-- ============================================================================
-- Redemption
-- ============================================================================

/**
 * Turns every unexpired invitation for a confirmed address into membership.
 *
 * SECURITY DEFINER because it writes workspace_members on behalf of someone who
 * is, by definition, not yet a member and so has no policy that would admit the
 * insert. It takes a user id rather than reading auth.uid(), so both callers —
 * the signup trigger and the self-service RPC — go through one implementation.
 *
 * `on conflict do nothing`: an invitation must never change the role of an
 * existing member. Someone already in the workspace as a compliance_auditor
 * being handed a business_user invitation would otherwise be silently demoted,
 * and re-inviting an admin would be a way to quietly strip their access.
 *
 * Only the rows it actually consumed are deleted. Expired invitations stay put,
 * so an administrator can see the invitation that timed out and re-send it,
 * rather than finding it gone with no record that it was ever issued.
 */
create or replace function private.redeem_invitations(
    p_user_id uuid,
    p_email text
)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
    v_redeemed int;
begin
    if p_user_id is null or p_email is null or p_email = '' then
        return 0;
    end if;

    with claimed as (
        delete from public.workspace_invitations i
         where i.email = lower(p_email)
           and i.expires_at > now()
        returning i.workspace_id, i.invited_role
    ),
    inserted as (
        insert into public.workspace_members (workspace_id, user_id, role)
        select c.workspace_id, p_user_id, c.invited_role
          from claimed c
        on conflict (workspace_id, user_id) do nothing
        returning 1
    )
    select count(*) into v_redeemed from inserted;

    return v_redeemed;
end;
$fn$;

revoke all on function private.redeem_invitations(uuid, text) from public;

/**
 * Redemption at signup — and it is gated on CONFIRMATION, not on insertion.
 *
 * An AFTER INSERT trigger keyed on email alone hands workspace membership to
 * whoever signs up claiming the address first, which turns an invitation into
 * an unauthenticated grant. The address has to prove itself, and
 * `email_confirmed_at` is that proof.
 *
 * Both events matter: a row can arrive already confirmed, or be confirmed
 * later, and only handling the second would strand every user created in the
 * first shape.
 *
 * NOTE: this is only as strong as `enable_confirmations` in config.toml, which
 * is currently FALSE — GoTrue then stamps email_confirmed_at at signup without
 * anyone reading the inbox, and the check passes vacuously. Turn confirmations
 * on before this platform accepts a real tenant, or the paragraph above
 * describes a protection that is not running.
 */
create or replace function private.handle_confirmed_user_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
    perform private.redeem_invitations(new.id, new.email);
    return new;
end;
$fn$;

drop trigger if exists trg_redeem_invitations_on_confirm on auth.users;

create trigger trg_redeem_invitations_on_confirm
    after insert or update of email_confirmed_at on auth.users
    for each row
    when (new.email_confirmed_at is not null)
    execute function private.handle_confirmed_user_invitations();

/**
 * Redemption for someone who ALREADY had an account.
 *
 * The signup trigger cannot cover this and it is the common case: an
 * administrator invites a colleague who registered months ago, and no row in
 * auth.users changes, so nothing fires and the invitation sits unredeemed
 * forever. A design that only redeems at signup quietly only works for people
 * who had not signed up.
 *
 * No oracle: it reads the caller's own row and nothing else, so it can only
 * ever tell you about invitations sent to you.
 */
create or replace function public.redeem_my_invitations()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
    v_email text;
    v_confirmed timestamptz;
    v_uid uuid := (select auth.uid());
begin
    if v_uid is null then
        return 0;
    end if;

    select u.email, u.email_confirmed_at
      into v_email, v_confirmed
      from auth.users u
     where u.id = v_uid;

    -- Same bar as the trigger. An unconfirmed address must not collect
    -- memberships by signing in.
    if v_confirmed is null then
        return 0;
    end if;

    return private.redeem_invitations(v_uid, v_email);
end;
$fn$;

revoke all on function public.redeem_my_invitations() from public;
grant execute on function public.redeem_my_invitations() to authenticated;
