"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import type { WorkspaceSummary } from "@/lib/roles";

/**
 * Tenant selector. Writes the choice to the URL so the server component
 * re-fetches for the new workspace — the active tenant is shareable state, not
 * component state.
 */
export default function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceSummary[];
  activeId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center space-x-2">
      <label htmlFor="workspace" className="text-xs text-slate-400">
        Active Tenant:
      </label>
      <select
        id="workspace"
        value={activeId}
        disabled={pending || workspaces.length < 2}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams);
          params.set("workspace", event.target.value);
          startTransition(() => {
            router.push(`${pathname}?${params.toString()}`);
          });
        }}
        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </div>
  );
}
