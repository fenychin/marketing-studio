import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Icon, icons } from "./Icons";
import type { AssetDto, GenerationDto } from "@studio/shared";

type Tab = "uploads" | "generations" | "liked";
type Recency = "recent" | "all";
type SortOrder = "newest" | "oldest";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "uploads", label: "上传" },
  { id: "generations", label: "世代" },
  { id: "liked", label: "喜欢" },
];

/** A generation is stored as a real asset row, so it can attach as a reference. */
function generationAsAsset(g: GenerationDto): AssetDto {
  return { id: g.assetId, kind: g.kind, mime: "", bytes: 0, url: g.url, createdAt: g.createdAt };
}

function EmptyState({ icon, gradient, title, subtitle }: { icon: string; gradient: string; title: string; subtitle: string }) {
  return (
    <div className="grid h-full min-h-[380px] place-items-center">
      <div className="flex flex-col items-center text-center">
        <div className={`mb-5 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg ${gradient}`}>
          <Icon path={icon} size={26} />
        </div>
        <div className="text-[17px] font-bold text-neutral-100">{title}</div>
        <div className="mt-1.5 text-[13px] text-[#8a8a8a]">{subtitle}</div>
      </div>
    </div>
  );
}

function SortControl({ order, onChange }: { order: SortOrder; onChange: (o: SortOrder) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-[#9a9a9a] transition-colors hover:text-white"
      >
        <Icon path={icons.sort} size={13} />
        排序方式
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-32 overflow-hidden rounded-xl border border-[#2e2e2e] bg-[#1c1c1c] shadow-xl">
          {(["newest", "oldest"] as SortOrder[]).map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-[12px] hover:bg-[#2a2a2a] ${order === o ? "text-white" : "text-[#9a9a9a]"}`}
            >
              {o === "newest" ? "最新优先" : "最早优先"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MediaLibraryModal({
  onPick,
  onClose,
}: {
  onPick: (asset: AssetDto) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("uploads");
  const [recency, setRecency] = useState<Recency>("recent");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const fileInput = useRef<HTMLInputElement>(null);

  const uploads = useQuery({
    queryKey: ["assets"],
    queryFn: () => api<{ assets: AssetDto[] }>("/v1/assets?limit=200"),
  });

  const jobs = useQuery({
    queryKey: ["jobs", "library"],
    queryFn: () => api<{ jobs: { generations: GenerationDto[] }[] }>("/v1/generations"),
    enabled: tab === "generations" || tab === "liked",
  });

  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api<{ generations: GenerationDto[] }>("/v1/generations?favorites=1"),
    enabled: tab === "liked",
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ asset: AssetDto }>("/v1/assets", { method: "POST", body: form });
    },
    onSuccess: ({ asset }) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      onPick(asset);
    },
  });

  // 最近的 = 最近 7 天上传；全部 = 全部，均按排序方式排列。
  const uploadAssets = useMemo(() => {
    const list = [...(uploads.data?.assets ?? [])];
    if (sortOrder === "oldest") list.reverse();
    if (recency === "recent") {
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
      return list.filter((a) => new Date(a.createdAt).getTime() >= cutoff);
    }
    return list;
  }, [uploads.data, recency, sortOrder]);

  const generations = useMemo(() => {
    const list = (jobs.data?.jobs ?? []).flatMap((j) => j.generations);
    list.sort((a, b) => (sortOrder === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
    return list;
  }, [jobs.data, sortOrder]);

  const liked = useMemo(() => {
    const list = [...(favorites.data?.generations ?? [])];
    if (sortOrder === "oldest") list.reverse();
    return list;
  }, [favorites.data, sortOrder]);

  const grid = "grid content-start grid-cols-2 gap-3 min-h-0 flex-1 overflow-y-auto sm:grid-cols-3 md:grid-cols-4";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8" onClick={onClose}>
      <div
        className="flex h-full max-h-[720px] w-full max-w-4xl flex-col rounded-2xl border border-[#2a2a2a] bg-[#242424] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

        {/* tab row */}
        <div className="mb-3 flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                tab === t.id ? "bg-white text-black" : "text-[#9a9a9a] hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-[#333] text-[#9a9a9a] transition-colors hover:text-white"
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon path={icons.close} size={14} />
          </button>
        </div>

        {/* content panel */}
        <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#1e1e1e] p-4">
          {tab === "uploads" && (
            <>
              <div className="mb-4 flex items-center gap-2">
                {(["recent", "all"] as Recency[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRecency(r)}
                    className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                      recency === r ? "border border-[#4a4a4a] bg-[#2e2e2e] text-white" : "text-[#9a9a9a] hover:text-white"
                    }`}
                  >
                    {r === "recent" ? "最近的" : "全部"}
                  </button>
                ))}
                <div className="ml-auto">
                  <SortControl order={sortOrder} onChange={setSortOrder} />
                </div>
              </div>
              <div className={grid}>
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={upload.isPending}
                  className="flex aspect-square flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#4a4a4a] bg-[#262626] text-[#c8c8c8] transition-colors hover:border-[#6a6a6a] hover:text-white disabled:opacity-60"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#3a3a3a]">
                    <Icon path={icons.uploadCloud} size={20} />
                  </span>
                  <span className="text-[13px]">{upload.isPending ? "上传中…" : "上传媒体"}</span>
                </button>
                {uploadAssets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onPick(a)}
                    className="group aspect-square overflow-hidden rounded-xl border border-[#2e2e2e] bg-[#181818]"
                    title="选择为参考"
                  >
                    {a.mime.startsWith("video/") ? (
                      <span className="grid h-full place-items-center text-[#8a8a8a]">
                        <Icon path={icons.play} size={28} />
                      </span>
                    ) : (
                      <img src={a.url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === "generations" &&
            (generations.length > 0 ? (
              <div className={`${grid} max-h-full`}>
                {generations.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => onPick(generationAsAsset(g))}
                    className="group aspect-square overflow-hidden rounded-xl border border-[#2e2e2e] bg-[#181818]"
                    title="选择为参考"
                  >
                    <img src={g.url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={icons.stack}
                gradient="bg-gradient-to-b from-sky-400 to-blue-600"
                title="你的图片生成结果将显示在这里"
                subtitle="生成图片后即可在这里看到"
              />
            ))}

          {tab === "liked" &&
            (liked.length > 0 ? (
              <div className={`${grid} max-h-full`}>
                {liked.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => onPick(generationAsAsset(g))}
                    className="group aspect-square overflow-hidden rounded-xl border border-[#2e2e2e] bg-[#181818]"
                    title="选择为参考"
                  >
                    <img src={g.url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={icons.heart}
                gradient="bg-gradient-to-b from-pink-400 to-rose-600"
                title="你喜欢的生成内容将显示在这里"
                subtitle="标记你喜欢的内容即可保存到这里"
              />
            ))}
        </div>
      </div>
    </div>
  );
}
