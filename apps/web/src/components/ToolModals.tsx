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
        window.alert(`已入队 ${data.jobs.length} 个作业——每平台一支。`);
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
          <h2 className="display-font mb-4 text-[20px] uppercase">复刻模板</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[12px] text-[#9a9a9a]">替换商品</div>
              <UploadCard label="上传商品图" hint="必填" asset={product} onPick={() => { roleRef.current = "product"; fileRef.current?.click(); }} />
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-[#9a9a9a]">替换头像</div>
              <UploadCard label="选择头像" hint="可选" asset={avatar} onPick={() => { roleRef.current = "avatar"; fileRef.current?.click(); }} />
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] text-[#9a9a9a]">描述你的修改</div>
            <textarea
              rows={3}
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              placeholder="想改什么？"
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
            复刻 <span className="ml-1">✦ {plan?.cost?.total ?? template.credits * 4}</span>
          </button>
          {plan && (
            <div className={`mt-1.5 text-center text-[11px] ${plan.valid ? "text-[#7a8a3a]" : "text-amber-400"}`}>
              {plan.valid
                ? `Plan ✓ 本次后余额 ${plan.balance?.after}`
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
    <Modal title="广告参考" onClose={onClose} width="max-w-2xl">
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
      <h2 className="display-font mb-2 text-[24px] uppercase leading-tight">从病毒式广告汲取灵感</h2>
      <p className="mb-4 max-w-md text-[13px] leading-relaxed text-[#9a9a9a]">
        粘贴一条病毒式广告，把它变成你自己的——同样的噱头，同样的能量，现在用来推销你的产品。
      </p>
      <div className="mb-4 rounded-2xl border border-[#2a2a2a] bg-[#101010] p-4">
        <div className="mb-2 text-[13px] font-semibold">参考广告视频</div>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-xl border border-[#2e2e2e] bg-[#151515] px-4 py-3 text-left transition-colors hover:border-[#4a4a4a]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full border border-[#3a3a3a] text-[#9a9a9a]">↑</span>
          <span>
            <span className="block text-[13px] font-semibold">{video ? "参考视频已上传 ✓" : "上传你的视频"}</span>
            <span className="block text-[11px] text-[#6f6f6f]">节奏与拍点自动克隆</span>
          </span>
        </button>
      </div>
      <div className="mb-4 grid grid-cols-[1fr_140px] gap-3">
        <div>
          <div className="mb-1.5 text-[12px] text-[#9a9a9a]">粘贴广告台词（可选——让复刻更精准）</div>
          <textarea
            rows={3}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="例如：你的肌肤值得更好。三秒见效。今天就带走。"
            className="w-full resize-none rounded-xl border border-[#2e2e2e] bg-[#101010] p-3 text-[13px] text-neutral-200 placeholder:text-[#5f5f5f]"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] text-[#9a9a9a]">语气</div>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full rounded-xl border border-[#2e2e2e] bg-[#101010] px-3 py-2.5 text-[13px] text-neutral-200"
          >
            <option value="energetic">活力</option>
            <option value="premium">高级</option>
            <option value="friendly">亲和</option>
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
          <span className="block text-[12px] font-semibold text-neutral-200">严格复刻门禁</span>
          <span className="block text-[10px] text-[#6f6f6f]">偏离参考节奏时拒绝渲染</span>
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
        {agent.isPending ? "解析中…" : "开始"}
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
    <Modal title="商品链接" onClose={onClose} width="max-w-2xl">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-2xl"><Icon path={icons.cursor} size={22} className="text-white" /></div>
      <h2 className="display-font mb-2 text-[24px] uppercase leading-tight">一键生成视频广告</h2>
      <p className="mb-4 max-w-md text-[13px] leading-relaxed text-[#9a9a9a]">
        只需提供商品链接，即可获得适用于 TikTok、Reels 和 Shorts 的广告素材。无需拍摄、剪辑或撰写广告文案。
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
        <div className="mb-1.5 text-[12px] text-[#9a9a9a]">平台——每选一个生成一支（三平台共 ✦{PLATFORM_CHIPS.length * 60}）</div>
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
        <div className="mb-1.5 text-[12px] text-[#9a9a9a]">语气</div>
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          className="rounded-xl border border-[#2e2e2e] bg-[#101010] px-3 py-2.5 text-[13px] text-neutral-200"
        >
          <option value="energetic">活力</option>
          <option value="premium">高级</option>
          <option value="friendly">亲和</option>
        </select>
      </div>
      <button
        disabled={url.trim().length < 4 || platforms.length === 0 || agent.isPending}
        onClick={() => agent.mutate({ path: "/v1/agents/product-link", json: { url: url.trim(), tone, platforms } })}
        className="w-full rounded-xl bg-gradient-to-r from-[#e80f7c] to-[#f0559a] py-3 text-[13px] font-black uppercase tracking-[0.12em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {agent.isPending ? "抓取商品中…" : platforms.length > 1 ? `生成 ${platforms.length} 支广告` : "开始"}
      </button>
    </Modal>
  );
}
