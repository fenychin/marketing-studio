import { NavLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, authMode, getApiKey, getToken, setApiKey, setToken } from "../lib/api";
import { Icon, icons, Section } from "./Icons";
import { TopUpModal } from "./TopUpModal";
import { IntegrationsModal } from "./IntegrationsModal";
import type { ProjectDto } from "@studio/shared";

const DEMO_KEYS = [
  { label: "Alpha workspace", key: "sk_demo_alpha" },
  { label: "Beta workspace", key: "sk_demo_beta" },
];

function NavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
          isActive ? "bg-[#1e1e1e] text-white" : "text-[#9a9a9a] hover:bg-[#161616] hover:text-neutral-200"
        }`
      }
    >
      <Icon path={icon} />
      {label}
    </NavLink>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentKey, setCurrentKey] = useState(getApiKey());
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const isJwt = authMode() === "jwt";

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ tenant: { name: string }; user?: { email: string }; balance: number }>("/v1/auth/me"),
    enabled: isJwt,
  });

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: ProjectDto[] }>("/v1/projects"),
  });

  const createProject = useMutation({
    mutationFn: (name: string) => api("/v1/projects", { method: "POST", json: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-[#1c1c1c] bg-[#0c0c0c] px-2.5 py-3">
      <div className="mb-4 flex items-center gap-2 px-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-emerald-400 to-lime-500 text-[13px]">✦</span>
        <span className="text-[14px] font-bold tracking-tight">Maker Studio</span>
        <Icon path={icons.chevronDown} size={12} className="ml-auto text-[#5c5c5c]" />
      </div>

      <nav className="space-y-0.5">
        <NavItem to="/" icon={icons.home} label="Home" />
        <NavItem to="/generations" icon={icons.grid} label="My generations" />
        <NavItem to="/favorites" icon={icons.heart} label="My favorites" />
      </nav>

      <Section>Tools</Section>
      <nav className="space-y-0.5">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#9a9a9a] transition-colors hover:bg-[#161616] hover:text-neutral-200"
          onClick={() => window.dispatchEvent(new CustomEvent("studio:tool", { detail: "ad-reference" }))}
        >
          <span className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-fuchsia-500 to-pink-600 text-[10px]">▶</span>
          Ad Reference
        </button>
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#9a9a9a] transition-colors hover:bg-[#161616] hover:text-neutral-200"
          onClick={() => window.dispatchEvent(new CustomEvent("studio:tool", { detail: "product-link" }))}
        >
          <span className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-pink-500 to-rose-600 text-[10px]">✦</span>
          Product Link
        </button>
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#9a9a9a] transition-colors hover:bg-[#161616] hover:text-neutral-200"
          onClick={() => setIntegrationsOpen(true)}
        >
          <span className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-cyan-500 to-sky-600 text-[10px]">⚡</span>
          Integrations
        </button>
      </nav>

      <Section>Projects</Section>
      <div className="space-y-0.5">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#9a9a9a] transition-colors hover:bg-[#161616] hover:text-neutral-200"
          onClick={() => {
            const name = window.prompt("Project name", "Spring campaign");
            if (name) createProject.mutate(name);
          }}
        >
          <Icon path={icons.plus} />
          New project
        </button>
        {projects.data?.projects.map((p) => (
          <div key={p.id} className="truncate rounded-lg px-3 py-1.5 text-[13px] text-[#6f6f6f]">
            {p.name}
          </div>
        ))}
      </div>

      <div className="mt-auto space-y-2 px-1">
        {isJwt ? (
          <div className="rounded-xl border border-[#232323] bg-[#101010] p-2.5">
            <div className="truncate text-[12px] font-semibold text-neutral-200">{me.data?.user?.email ?? "…"}</div>
            <div className="truncate text-[10px] text-[#6f6f6f]">{me.data?.tenant.name}</div>
            <button
              className="mt-2 w-full rounded-md border border-[#2e2e2e] py-1.5 text-[11px] font-semibold text-[#9a9a9a] hover:border-neutral-500 hover:text-neutral-200"
              onClick={() => {
                setToken(null);
                navigate("/");
              }}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-[#232323] bg-[#101010] p-2.5">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#565656]">Workspace</div>
            <select
              className="w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-1.5 text-[12px] text-neutral-300"
              value={currentKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setCurrentKey(e.target.value);
                queryClient.clear();
                navigate("/");
              }}
            >
              {DEMO_KEYS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              className="mt-2 w-full rounded-md border border-[#2e2e2e] py-1.5 text-[11px] font-semibold text-[#9a9a9a] hover:border-neutral-500 hover:text-neutral-200"
              onClick={() => navigate("/login")}
            >
              Sign in to a workspace
            </button>
          </div>
        )}
        <button
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] font-semibold text-[#f0559a]"
          onClick={() => setTopUpOpen(true)}
        >
          Pricing
          <span className="rounded-full bg-gradient-to-r from-pink-600 to-fuchsia-500 px-1.5 py-0.5 text-[10px] font-bold text-white">50% OFF</span>
        </button>
      </div>

      {topUpOpen && <TopUpModal onClose={() => setTopUpOpen(false)} />}
      {integrationsOpen && <IntegrationsModal onClose={() => setIntegrationsOpen(false)} />}
    </aside>
  );
}
