"use client";

import { useActionState } from "react";

import {
  inviteMember,
  revokeInvitation,
  setMemberRole,
  type MemberState,
} from "@/app/dashboard/member-actions";
import type { Invitation, Member } from "@/lib/data/members";
import { ROLE_POWER, type UserRole } from "@/lib/roles";

const initialState: MemberState = { error: null, message: null };

/** Highest power first, which is how a hierarchy reads. */
const ROLES_BY_RANK = (Object.keys(ROLE_POWER) as UserRole[]).sort(
  (a, b) => ROLE_POWER[b] - ROLE_POWER[a],
);

function when(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function Notice({ state }: { state: MemberState }) {
  if (!state.error && !state.message) return null;

  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-3 rounded-md border px-3 py-2 text-xs ${
        state.error
          ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      }`}
    >
      {state.error ?? state.message}
    </p>
  );
}

/**
 * The invite form.
 *
 * Only offers roles the viewer may actually grant. The policy refuses a grant
 * above the granter's own rank, so listing `workspace_owner` to an
 * administrator would be offering a button that always fails.
 */
function InviteForm({
  workspaceId,
  viewerRole,
}: {
  workspaceId: string;
  viewerRole: UserRole;
}) {
  const [state, formAction, pending] = useActionState(
    inviteMember,
    initialState,
  );

  const grantable = ROLES_BY_RANK.filter(
    (r) => ROLE_POWER[r] <= ROLE_POWER[viewerRole],
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Invite a colleague</h3>
      <p className="mt-1 text-xs text-slate-400">
        Nothing is looked up. The invitation waits against the address and is
        redeemed when someone signs in having confirmed it, so you can invite
        people who have not registered yet.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />

        <div className="min-w-[240px] flex-1">
          <label
            htmlFor="invite-email"
            className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500"
          >
            Email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="colleague@company.com"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
          />
        </div>

        <div>
          <label
            htmlFor="invite-role"
            className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500"
          >
            Role
          </label>
          <select
            id="invite-role"
            name="role"
            defaultValue="agent_operator"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
          >
            {grantable.map((r) => (
              <option key={r} value={r}>
                {r} ({ROLE_POWER[r]})
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Send invitation"}
        </button>
      </form>

      <Notice state={state} />
    </div>
  );
}

function MemberRow({
  member,
  workspaceId,
  viewerRole,
  isSelf,
}: {
  member: Member;
  workspaceId: string;
  viewerRole: UserRole;
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setMemberRole,
    initialState,
  );

  // Mirrors the server checks: you may not grant above your rank, nor change
  // somebody who outranks you. A UI affordance only — the action re-checks.
  const outranksMe = ROLE_POWER[member.role] > ROLE_POWER[viewerRole];
  const grantable = ROLES_BY_RANK.filter(
    (r) => ROLE_POWER[r] <= ROLE_POWER[viewerRole],
  );
  const editable = !outranksMe && grantable.length > 0;

  return (
    <div className="border-t border-slate-800 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-slate-300">
            {member.email ?? shortId(member.userId)}
            {isSelf && (
              <span className="ml-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-400">
                YOU
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            joined {when(member.joinedAt)}
          </p>
        </div>

        {editable ? (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="userId" value={member.userId} />
            <label htmlFor={`role-${member.userId}`} className="sr-only">
              Role
            </label>
            <select
              id={`role-${member.userId}`}
              name="role"
              defaultValue={member.role}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-slate-300"
            >
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </form>
        ) : (
          <span className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-400">
            {member.role}
          </span>
        )}
      </div>

      <Notice state={state} />
    </div>
  );
}

function InvitationRow({
  invitation,
  workspaceId,
}: {
  invitation: Invitation;
  workspaceId: string;
}) {
  const [state, formAction, pending] = useActionState(
    revokeInvitation,
    initialState,
  );

  return (
    <div className="border-t border-slate-800 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-slate-300">{invitation.email}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            as {invitation.invitedRole} ·{" "}
            {invitation.expired ? (
              // Expired invitations are kept deliberately: an administrator's
              // next question is "did I ever invite them?", and a list that
              // forgets cannot answer it.
              <span className="text-amber-400">
                expired {when(invitation.expiresAt)} — re-invite to refresh
              </span>
            ) : (
              <>expires {when(invitation.expiresAt)}</>
            )}
          </p>
        </div>

        <form action={formAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-bold text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
          >
            {pending ? "Revoking…" : "Revoke"}
          </button>
        </form>
      </div>

      <Notice state={state} />
    </div>
  );
}

export default function AccessControlPanel({
  workspaceId,
  viewerId,
  viewerRole,
  members,
  invitations,
  canManage,
}: {
  workspaceId: string;
  viewerId: string;
  viewerRole: UserRole;
  members: Member[];
  invitations: Invitation[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      {canManage && (
        <InviteForm workspaceId={workspaceId} viewerRole={viewerRole} />
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-bold text-white">Members</h3>
          <span className="font-mono text-[11px] text-slate-500">
            {members.length}
          </span>
        </div>

        {members.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-500">
            No members.
          </p>
        ) : (
          members.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              workspaceId={workspaceId}
              viewerRole={viewerRole}
              isSelf={m.userId === viewerId}
            />
          ))
        )}
      </div>

      {canManage && (
        <div className="rounded-xl border border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-bold text-white">
              Pending invitations
            </h3>
            <span className="font-mono text-[11px] text-slate-500">
              {invitations.length}
            </span>
          </div>

          {invitations.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No invitations outstanding.
            </p>
          ) : (
            invitations.map((i) => (
              <InvitationRow
                key={i.id}
                invitation={i}
                workspaceId={workspaceId}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
