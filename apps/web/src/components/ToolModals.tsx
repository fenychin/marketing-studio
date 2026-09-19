import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { Icon, icons } from "./Icons";
import { Modal } from "./Modal";
import type { AssetDto, TemplateDto } from "@studio/shared";

interface PlanResult {
  valid: boolean;
  issues: string[];
  cost: { total: number } | null;
  balance: { after: number } | null;
}

function useUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ asset: AssetDto }>("/v1/assets", { method: "POST", body: form });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credits"] }),
  });
}

function UploadCard({ label, hint, asset, onPick }: { label: string; hint: string; asset?: AssetDto; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-[#2e2e2e] bg-[#101010] transition-colors hover:border-[#4a4a4a]"
    >
      {asset ? (
        <img src={asset.url} alt={label} className="h-full w-full rounded-xl object-cover" />
      ) : (
        <>
          <span className="grid h-7 w-7 place-items-center rounded-full border border-[#3a3a3a] text-[#9a9a9a]">+</span>
          <span className="text-[12px] font-semibold text-neutral-200">{label}</span>
          <span className="rounded-full border border-[#333] px-1.5 text-[9px] uppercase tracking-wide text-[#6f6f6f]">{hint}</span>
        </>
      )}
    </button>
  );
}

function useAgent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, json }: { path: string; json: unknown }) =>
      api<{ job?: { id: string }; jobs?: Array<{ id: string }> }>(path, { method: "POST", json }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (data.jobs && data.jobs.length > 1) {
        window.alert(`${data.jobs.length} ad jobs queued — one per platform.`);
      }
      navigate("/generations");
    },
    onError: (e) => window.alert(e instanceof ApiError ? e.message : "Request failed"),
  });
}

export function RecreateModal({ template, onClose }: { template: TemplateDto; onClose: () => void }) {
  const upload = useUpload();
  const create = useAgent();
  const fileRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<"product" | "avatar">("product");
  const [product, setProduct] = useState<AssetDto | undefined>();
  const [avatar, setAvatar] = useState<AssetDto | undefined>();
  const [edit, setEdit] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);

  // Plan-mode: real price for 4 variants before spending anything.
  useEffect(() => {
    api<PlanResult>("/v1/plan", { method: "POST", json: { templateId: template.id, count: 4 } })
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [template.id]);

  return (
    <Modal title="" onClose={onClose} width="max-w-3xl">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          roleRef.current === "product"
            ? upload.mutateAsync(file).then(({ asset }) => setProduct(asset))
            : upload.mutateAsync(file).then(({ asset }) => setAvatar(asset));
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-[1fr_1fr] gap-6">
        <img src={template.thumbUrl} alt={template.title} className="max-h-[340px] w-full rounded-xl object-cover" />
        <div>
          <h2 className="display-font mb-4 text-[20px] uppercase">Recreate Template</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Replace product</div>
              <UploadCard label="Upload product" hint="Required" asset={product} onPick={() => { roleRef.current = "product"; fileRef.current?.click(); }} />
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Replace avatar</div>
              <UploadCard label="Choose avatar" hint="Optional" asset={avatar} onPick={() => { roleRef.current = "avatar"; fileRef.current?.click(); }} />
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Describe your edit</div>
            <textarea
              rows={3}
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              placeholder="What do you want to change?"
              className="w-full resize-none rounded-xl border border-[#2e2e2e] bg-[#101010] p-3 text-[13px] text-neutral-200 placeholder:text-[#5f5f5f]"
            />
          </div>
          <button
            disabled={upload.isPending || create.isPending}
            onClick={() =>
              create.mutate({
                // Server-side slot interpolation ({PRODUCT}/{AVATAR}/{EDIT}) —
                // the raw template prompt never leaves the backend.
                path: `/v1/templates/${template.id}/recreate`,
                json: {
                  productAssetId: product?.id,
                  avatarAssetId: avatar?.id,
                  edit: edit.trim() || undefined,
                  count: 4,
                },
              })
            }
            className="mt-4 w-full rounded-xl bg-[#93a636] py-3 text-[13px] font-black uppercase tracking-wide text-black transition hover:brightness-110 disabled:opacity-50"
          >
            Recreate <span className="ml-1">✦ {plan?.cost?.total ?? template.credits * 4}</span>
          </button>
          {plan && (
            <div className={`mt-1.5 text-center text-[11px] ${plan.valid ? "text-[#7a8a3a]" : "text-amber-400"}`}>
              {plan.valid
                ? `Plan ✓ balance ${plan.balance?.after} after this run`
                : `Plan ⚠ ${plan.issues[0] ?? "unavailable"}`}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function AdReferenceModal({ onClose }: { onClose: () => void }) {
  const upload = useUpload();
  const agent = useAgent();
  const fileRef = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<AssetDto | undefined>();
  const [transcript, setTranscript] = useState("");
  const [tone, setTone] = useState("energetic");
  const [strict, setStrict] = useState(false);

  return (
    <Modal title="Ad Reference" onClose={onClose} width="max-w-2xl">
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutateAsync(file).then(({ asset }) => setVideo(asset));
          e.target.value = "";
        }}
      />
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-600 text-2xl">🎬</div>
      <h2 className="display-font mb-2 text-[24px] uppercase leading-tight">Get inspiration from viral ads</h2>
      <p className="mb-4 max-w-md text-[13px] leading-relaxed text-[#9a9a9a]">
        Paste a viral ad and turn it into your own — same hook, same energy, now selling your product.
      </p>
      <div className="mb-4 rounded-2xl border border-[#2a2a2a] bg-[#101010] p-4">
        <div className="mb-2 text-[13px] font-semibold">Reference Ad Video</div>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-xl border border-[#2e2e2e] bg-[#151515] px-4 py-3 text-left transition-colors hover:border-[#4a4a4a]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full border border-[#3a3a3a] text-[#9a9a9a]">↑</span>
          <span>
            <span className="block text-[13px] font-semibold">{video ? "Reference attached ✓" : "Upload your video"}</span>
            <span className="block text-[11px] text-[#6f6f6f]">Rhythm, beats and pacing are cloned automatically</span>
          </span>
        </button>
      </div>
      <div className="mb-4 grid grid-cols-[1fr_140px] gap-3">
        <div>
          <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Paste the ad's script (optional — tightens the clone)</div>
          <textarea
            rows={3}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="e.g. Your skin deserves better. Meet Solv. Three seconds a day."
            className="w-full resize-none rounded-xl border border-[#2e2e2e] bg-[#101010] p-3 text-[13px] text-neutral-200 placeholder:text-[#5f5f5f]"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Tone</div>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full rounded-xl border border-[#2e2e2e] bg-[#101010] px-3 py-2.5 text-[13px] text-neutral-200"
          >
            <option value="energetic">Energetic</option>
            <option value="premium">Premium</option>
            <option value="friendly">Friendly</option>
          </select>
        </div>
      </div>
      <label className="mb-4 flex cursor-pointer items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#101010] px-3.5 py-2.5">
        <input
          type="checkbox"
          checked={strict}
          onChange={(e) => setStrict(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#ddf24b]"
        />
        <span>
          <span className="block text-[12px] font-semibold text-neutral-200">Strict replica gates</span>
          <span className="block text-[10px] text-[#6f6f6f]">Refuse to render if the clone drifts off the reference rhythm</span>
        </span>
      </label>
      <button
        disabled={!video || agent.isPending}
        onClick={() =>
          agent.mutate({
            path: "/v1/agents/ad-reference",
            json: {
              referenceAssetId: video!.id,
              transcript: transcript.trim() || undefined,
              tone,
              mode: strict ? "strict" : "loose",
            },
          })
        }
        className="w-full rounded-xl bg-gradient-to-r from-[#e80f7c] to-[#f0559a] py-3 text-[13px] font-black uppercase tracking-[0.12em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {agent.isPending ? "Analyzing…" : "Continue"}
      </button>
    </Modal>
  );
}

const PLATFORM_CHIPS = [
  { id: "tiktok", label: "TikTok" },
  { id: "reels", label: "Reels" },
  { id: "shorts", label: "Shorts" },
];

export function ProductLinkModal({ onClose }: { onClose: () => void }) {
  const agent = useAgent();
  const [url, setUrl] = useState("");
  const [tone, setTone] = useState("energetic");
  const [platforms, setPlatforms] = useState<string[]>(PLATFORM_CHIPS.map((p) => p.id));

  const togglePlatform = (id: string) =>
    setPlatforms((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  return (
    <Modal title="Product Link" onClose={onClose} width="max-w-2xl">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-2xl"><Icon path={icons.cursor} size={22} className="text-white" /></div>
      <h2 className="display-font mb-2 text-[24px] uppercase leading-tight">Make a video ad in one click</h2>
      <p className="mb-4 max-w-md text-[13px] leading-relaxed text-[#9a9a9a]">
        Drop a product link, get an ad ready for TikTok, Reels, and Shorts. No filming, no editing, no brief.
      </p>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#2e2e2e] bg-[#101010] px-4 py-3.5">
        <Icon path={icons.box} size={16} className="text-[#6f6f6f]" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="www.yourproduct.com"
          className="w-full bg-transparent text-[14px] text-neutral-200 placeholder:text-[#5f5f5f]"
        />
      </div>
      <div className="mb-4">
        <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Platforms — one ad per selection (✦{PLATFORM_CHIPS.length * 60} for all three)</div>
        <div className="flex gap-2">
          {PLATFORM_CHIPS.map((chip) => {
            const active = platforms.includes(chip.id);
            return (
              <button
                key={chip.id}
                onClick={() => togglePlatform(chip.id)}
                className={`rounded-xl border px-3.5 py-2 text-[12px] font-bold uppercase tracking-wide transition-colors ${
                  active
                    ? "border-[#ddf24b] bg-[#ddf24b]/10 text-[#ddf24b]"
                    : "border-[#2e2e2e] bg-[#101010] text-[#6f6f6f] hover:border-[#4a4a4a]"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mb-4">
        <div className="mb-1.5 text-[12px] text-[#9a9a9a]">Tone</div>
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          className="rounded-xl border border-[#2e2e2e] bg-[#101010] px-3 py-2.5 text-[13px] text-neutral-200"
        >
          <option value="energetic">Energetic</option>
          <option value="premium">Premium</option>
          <option value="friendly">Friendly</option>
        </select>
      </div>
      <button
        disabled={url.trim().length < 4 || platforms.length === 0 || agent.isPending}
        onClick={() => agent.mutate({ path: "/v1/agents/product-link", json: { url: url.trim(), tone, platforms } })}
        className="w-full rounded-xl bg-gradient-to-r from-[#e80f7c] to-[#f0559a] py-3 text-[13px] font-black uppercase tracking-[0.12em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {agent.isPending ? "Fetching product…" : platforms.length > 1 ? `Make ${platforms.length} ads` : "Continue"}
      </button>
    </Modal>
  );
}
