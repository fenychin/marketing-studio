import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { Modal } from "./Modal";
import type { ModelInfo } from "@studio/shared";

interface EndpointDto {
  id: string;
  name: string;
  kind: "image" | "video";
  provider: string;
  model: string;
  config: { baseUrl?: string; credentialRef?: string };
  creditsPerUnit: number;
}

/**
 * BYOK integrations: tenant-owned channel credentials (sealed server-side)
 * and model endpoints. New models appear in the prompt-bar selector instantly.
 */
export function IntegrationsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "my-gpt-image",
    kind: "image",
    provider: "openai-images",
    model: "gpt-image-1",
    baseUrl: "",
    credentialRef: "my-channel-key",
    secret: "",
    creditsPerUnit: "0",
  });
  const [error, setError] = useState<string | null>(null);

  const endpoints = useQuery({
    queryKey: ["endpoints"],
    queryFn: () => api<{ endpoints: EndpointDto[] }>("/v1/endpoints"),
  });
  const models = useQuery({
    queryKey: ["models", "all"],
    queryFn: () => api<{ models: ModelInfo[] }>("/v1/models"),
  });

  const saveCredential = useMutation({
    mutationFn: () =>
      api(`/v1/credentials/${form.credentialRef}`, { method: "PUT", json: { secret: form.secret, kind: "api_key" } }),
  });
  const createEndpoint = useMutation({
    mutationFn: () =>
      api("/v1/endpoints", {
        method: "POST",
        json: {
          name: form.name,
          kind: form.kind,
          provider: form.provider,
          model: form.model,
          baseUrl: form.baseUrl,
          credentialRef: form.credentialRef,
          creditsPerUnit: Number(form.creditsPerUnit) || 0,
        },
      }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Request failed"),
  });

  const submit = async () => {
    setError(null);
    try {
      await saveCredential.mutateAsync();
      await createEndpoint.mutateAsync();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/endpoints/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const input = "w-full rounded-lg border border-[#2e2e2e] bg-[#0e0e0e] px-3 py-2 text-[12px] text-neutral-200 placeholder:text-[#5f5f5f]";

  return (
    <Modal title="Integrations (BYOK)" onClose={onClose} width="max-w-2xl">
      <div className="mb-5">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#8a8a8a]">Your channels</div>
        {endpoints.data?.endpoints.length ? (
          <div className="space-y-2">
            {endpoints.data.endpoints.map((ep) => (
              <div key={ep.id} className="flex items-center justify-between rounded-xl border border-[#2a2a2a] bg-[#101010] px-4 py-2.5">
                <div>
                  <span className="text-[13px] font-bold">{ep.name}</span>
                  <span className="ml-2 text-[11px] text-[#6f6f6f]">{ep.provider} · {ep.model} · ✦{ep.creditsPerUnit}</span>
                </div>
                <button onClick={() => remove.mutate(ep.id)} className="text-[12px] text-[#9a9a9a] hover:text-rose-400">
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#2e2e2e] p-4 text-center text-[12px] text-[#6f6f6f]">
            No custom channels yet — add one below, it appears in the model selector instantly.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#2a2a2a] bg-[#101010] p-4">
        <div className="mb-3 text-[13px] font-semibold">Add a channel</div>
        <div className="grid grid-cols-2 gap-2.5">
          <input className={input} placeholder="name (model id)" value={form.name} onChange={set("name")} />
          <select className={input} value={form.kind} onChange={set("kind")}>
            <option value="image">image</option>
            <option value="video">video</option>
          </select>
          <select className={input} value={form.provider} onChange={set("provider")}>
            <option value="openai-images">OpenAI images protocol</option>
            <option value="async-video">Async-task video protocol</option>
          </select>
          <input className={input} placeholder="channel model name" value={form.model} onChange={set("model")} />
          <input className={input} placeholder="baseUrl (https://…)" value={form.baseUrl} onChange={set("baseUrl")} />
          <input className={input} placeholder="credential ref" value={form.credentialRef} onChange={set("credentialRef")} />
          <input className={input} placeholder="API key (sealed on save)" value={form.secret} onChange={set("secret")} type="password" />
          <input className={input} placeholder="credits per unit (0 = BYOK free)" value={form.creditsPerUnit} onChange={set("creditsPerUnit")} />
        </div>
        {error && <div className="mt-2 text-[12px] text-rose-400">{error}</div>}
        <button
          onClick={submit}
          disabled={createEndpoint.isPending || saveCredential.isPending}
          className="mt-3 w-full rounded-xl bg-[#ddf24b] py-2.5 text-[12px] font-black uppercase tracking-wide text-black hover:brightness-110 disabled:opacity-50"
        >
          Save channel
        </button>
        <div className="mt-2 text-[10px] text-[#5f5f5f]">
          Secrets are sealed with AES-256-GCM and never returned by the API. Available models: {models.data?.models.length ?? 0}
        </div>
      </div>
    </Modal>
  );
}
