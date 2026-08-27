import type { Metadata } from "next";

import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Enterprise AgentOps",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  // searchParams is a Promise in Next 16.
  const params = await searchParams;
  const raw = params.next;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const next =
    candidate?.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/dashboard";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100 antialiased">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 text-xl font-bold text-slate-950 shadow-lg shadow-cyan-500/20">
            Æ
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              Enterprise AgentOps
            </h1>
            <p className="text-xs text-slate-400">
              Multi-Agent Orchestration &amp; Governance
            </p>
          </div>
        </div>

        <LoginForm next={next} />
      </div>
    </div>
  );
}
