import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { Icon, icons } from "./Icons";
import type { AspectRatio, AssetDto, Kind, ModelInfo, ReferenceRole } from "@studio/shared";

interface PlanPreview {
  valid: boolean;
  issues: string[];
  cost: { total: number } | null;
  balance: { after: number } | null;
}

const IMAGE_RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const VIDEO_RATIOS: AspectRatio[] = ["9:16", "1:1", "16:9"];
const RESOLUTIONS = ["540p", "720p", "1080p"];
const DURATIONS = [5, 10, 15];
const SHOTS = ["Closeup", "Wide", "Top-down", "Hero angle"];

interface ReferenceChip {
  role: ReferenceRole;
  asset: AssetDto;
}

function cycle<T>(list: T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length]!;
}

export function PromptBar({ initialKind = "image" }: { initialKind?: Kind }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>("3:4");
  const [resolution, setResolution] = useState("1080p");
  const [duration, setDuration] = useState(15);
  const [count, setCount] = useState(1);
  const [shot, setShot] = useState(SHOTS[0]!);
  const [refs, setRefs] = useState<ReferenceChip[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingRole = useRef<ReferenceRole>("product");

  const models = useQuery({
    queryKey: ["models", kind],
    queryFn: () => api<{ models: ModelInfo[] }>(`/v1/models?kind=${kind}`),
  });
  const list = models.data?.models ?? [];
  const model = list.find((m) => m.id === modelId) ?? list[0];
  const ratios = kind === "video" ? VIDEO_RATIOS : IMAGE_RATIOS;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ asset: AssetDto }>("/v1/assets", { method: "POST", body: form });
    },
    onSuccess: ({ asset }) => {
      setRefs((prev) => [...prev.filter((r) => r.role !== pendingRole.current), { role: pendingRole.current, asset }]);
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ job: { id: string } }>("/v1/generations", {
        method: "POST",
        json: {
          kind,
          model: model!.id,
          prompt: kind === "video" ? `${prompt.trim() || "A short product ad"}. Shot: ${shot}.` : `${prompt.trim() || "A product shot"}. Shot: ${shot}.`,
          params: {
            aspectRatio: aspect,
            count,
            ...(kind === "video" ? { resolution, durationSec: duration } : {}),
            ...(refs.length > 0 ? { references: refs.map((r) => ({ assetId: r.asset.id, role: r.role })) } : {}),
          },
        },
      }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      navigate("/generations");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Request failed"),
  });

  const cost = (model?.creditsPerUnit ?? 0) * count;
  const openUpload = (role: ReferenceRole) => {
    pendingRole.current = role;
    fileInput.current?.click();
  };

  // Plan preview: dry-run pricing, debounced — the plan gate made visible.
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  useEffect(() => {
    if (!model || prompt.trim().length === 0) {
      setPlan(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await api<PlanPreview>("/v1/plan", {
          method: "POST",
          json: {
            kind,
            model: model.id,
            prompt: prompt.trim(),
            params: {
              aspectRatio: aspect,
              count,
              ...(kind === "video" ? { resolution, durationSec: duration } : {}),
              ...(refs.length > 0 ? { references: refs.map((r) => ({ assetId: r.asset.id, role: r.role })) } : {}),
            },
          },
        });
        setPlan(result);
      } catch {
        setPlan(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, kind, model, aspect, count, resolution, duration, refs]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2 rounded-[22px] border border-[#262626] bg-[#121212]/95 p-2.5 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur">
        {/* kind segmented toggle */}
        <div className="flex flex-col gap-1 rounded-2xl border border-[#242424] bg-[#0e0e0e] p-1">
          {(["image", "video"] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setAspect(k === "video" ? "9:16" : "3:4");
                setModelId(null);
              }}
              className={`flex w-[58px] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold capitalize transition-colors ${
                kind === k ? "bg-[#222] text-white" : "text-[#7a7a7a] hover:text-neutral-300"
              }`}
            >
              <Icon path={k === "image" ? icons.image : icons.video} size={15} />
              {k}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder={kind === "video" ? "Describe the video you want to create..." : "Describe what you want to create..."}
            className="w-full resize-none bg-transparent px-2 pt-1.5 text-[14px] text-neutral-200 placeholder:text-[#5f5f5f]"
          />

          {/* reference chips */}
          {refs.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
              {refs.map((r) => (
                <span key={r.role} className="flex items-center gap-1.5 rounded-full border border-[#2e2e2e] bg-[#191919] py-0.5 pl-0.5 pr-2 text-[11px] font-semibold uppercase text-neutral-300">
                  <img src={r.asset.url} alt={r.role} className="h-5 w-5 rounded-full object-cover" />
                  {r.role}
                  <button className="text-[#777] hover:text-white" onClick={() => setRefs((p) => p.filter((x) => x.role !== r.role))}>×</button>
                </span>
              ))}
            </div>
          )}
          {error && <div className="px-1 pb-1 text-[12px] text-rose-400">{error}</div>}
          {plan && (
            <div className={`px-1 pb-1 text-[11px] ${plan.valid ? "text-[#7a8a3a]" : "text-amber-400"}`}>
              {plan.valid
                ? `Plan ✓ ✦${plan.cost?.total} credits · balance ${plan.balance?.after} after render`
                : `Plan ⚠ ${plan.issues[0] ?? "unavailable"}`}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 px-0.5 pb-0.5">
            <button className="chip !px-2" title="Add attachment" onClick={() => openUpload("reference")}>
              <Icon path={icons.plus} size={12} />
            </button>

            {/* model selector */}
            <div className="relative">
              <button className="chip" onClick={() => setModelOpen((v) => !v)}>
                <span className="text-[#b7f34d]">✦</span>
                {model?.name ?? "Select model"}
                <Icon path={icons.chevronRight} size={11} className="rotate-90" />
              </button>
              {modelOpen && (
                <div className="absolute bottom-full z-30 mb-1.5 w-56 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#161616] shadow-xl">
                  {list.map((m) => (
                    <button
                      key={m.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] hover:bg-[#222]"
                      onClick={() => {
                        setModelId(m.id);
                        setModelOpen(false);
                      }}
                    >
                      <span>{m.name}</span>
                      <span className="text-[#777]">✦{m.creditsPerUnit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {kind === "image" ? (
              <button className="chip" onClick={() => setShot((s) => cycle(SHOTS, s))}>
                <Icon path={icons.box} size={12} />
                {shot}
              </button>
            ) : (
              <button className="chip" onClick={() => openUpload("reference")}>
                <Icon path={icons.box} size={12} />
                References
              </button>
            )}

            <button className="chip" onClick={() => setAspect((a) => cycle(ratios, a))}>
              <Icon path={icons.video} size={12} />
              {aspect}
            </button>
            {kind === "video" && (
              <button className="chip" onClick={() => setResolution((r) => cycle(RESOLUTIONS, r))}>
                <Icon path={icons.image} size={12} />
                {resolution}
              </button>
            )}
            {kind === "video" && (
              <button className="chip" onClick={() => setDuration((d) => cycle(DURATIONS, d))}>
                <Icon path={icons.play} size={12} />
                {duration}s
              </button>
            )}

            <button className="chip !px-2" title="Count">
              <span onClick={() => setCount((c) => Math.max(1, c - 1))}>−</span>
              <span className="min-w-4 text-center">{count}</span>
              <span onClick={() => setCount((c) => Math.min(model?.maxCount ?? 4, c + 1))}>+</span>
            </button>

            <button className="chip uppercase" onClick={() => openUpload("avatar")}>
              Avatar
            </button>
            <button className="chip uppercase" onClick={() => openUpload("product")}>
              Product
            </button>

            <button
              disabled={create.isPending || !model}
              onClick={() => create.mutate()}
              className="ml-auto rounded-xl bg-[#ddf24b] px-4 py-2 text-[12px] font-black uppercase tracking-wide text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {create.isPending ? "Generating…" : "Generate"}
              <span className="ml-1.5 font-bold">✦{cost}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
