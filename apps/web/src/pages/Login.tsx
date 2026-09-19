import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setApiKey, setToken, ApiError } from "../lib/api";

/**
 * Sign-in / register gate. "Demo mode" continues with seeded API keys for
 * frictionless evaluation; real sessions use JWTs issued by /v1/auth/*.
 */
export function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        const result = await api<{ token: string }>("/v1/auth/login", { method: "POST", json: { email, password } });
        setToken(result.token);
      } else {
        const result = await api<{ token: string }>("/v1/auth/register", { method: "POST", json: { email, password, orgName } });
        setToken(result.token);
      }
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dot-grid flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[#262626] bg-[#121212] p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-emerald-400 to-lime-500 text-[14px]">✦</span>
          <span className="text-[15px] font-bold">Maker Studio</span>
        </div>
        <h1 className="display-font mb-4 text-[20px] uppercase">{mode === "login" ? "登录" : "创建工作区"}</h1>

        <div className="space-y-3">
          {mode === "register" && (
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="工作区名称"
              className="w-full rounded-xl border border-[#2e2e2e] bg-[#0e0e0e] px-3.5 py-2.5 text-[13px] text-neutral-200 placeholder:text-[#5f5f5f]"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            type="email"
            className="w-full rounded-xl border border-[#2e2e2e] bg-[#0e0e0e] px-3.5 py-2.5 text-[13px] text-neutral-200 placeholder:text-[#5f5f5f]"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "密码（至少 8 位）" : "密码"}
            type="password"
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full rounded-xl border border-[#2e2e2e] bg-[#0e0e0e] px-3.5 py-2.5 text-[13px] text-neutral-200 placeholder:text-[#5f5f5f]"
          />
          {error && <div className="text-[12px] text-rose-400">{error}</div>}
          <button
            disabled={busy}
            onClick={submit}
            className="w-full rounded-xl bg-[#ddf24b] py-2.5 text-[13px] font-black uppercase tracking-wide text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "登录" : "注册"}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between text-[12px] text-[#7a7a7a]">
          <button
            className="hover:text-neutral-200"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "创建账号 →" : "← 已有账号"}
          </button>
          <button
            className="rounded-full border border-[#2e2e2e] px-2.5 py-1 hover:border-neutral-500"
            onClick={() => {
              setApiKey("sk_demo_alpha");
              navigate("/");
            }}
          >
            演示模式
          </button>
        </div>
        {mode === "login" && (
          <div className="mt-3 rounded-lg border border-[#242424] bg-[#0d0d0d] p-2.5 text-[11px] leading-relaxed text-[#6f6f6f]">
            内置演示账号： <span className="text-neutral-300">demo@studio.dev</span> / <span className="text-neutral-300">demo12345</span>
          </div>
        )}
      </div>
    </div>
  );
}
