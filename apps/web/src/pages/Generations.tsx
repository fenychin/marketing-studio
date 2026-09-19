import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getApiKey, getToken } from "../lib/api";
import { JobList } from "../components/JobList";
import type { JobDto, GenerationDto, JobStatus, Kind } from "@studio/shared";

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "排队中",
  running: "渲染中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

/**
 * Live job streams: one EventSource per in-progress job (token goes in the
 * query — EventSource cannot send headers). Any event invalidates the jobs
 * query; the slow refetchInterval stays as a heartbeat fallback.
 */
function useJobEvents(ids: string[]) {
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) return;
    const token = encodeURIComponent(getToken() ?? getApiKey());
    const sources = ids.map((id) => {
      const es = new EventSource(`/v1/generations/${id}/events?access_token=${token}`);
      es.onmessage = () => {
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["credits"] });
        setTick((v) => v + 1);
      };
      return es;
    });
    return () => sources.forEach((es) => es.close());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return tick;
}

export function Generations({ mode }: { mode: "all" | "favorites" }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Kind | "all">("all");

  const jobs = useQuery({
    queryKey: ["jobs", filter, mode],
    queryFn: () => api<{ jobs: JobDto[] }>(`/v1/generations${filter === "all" ? "" : `?kind=${filter}`}`),
    refetchInterval: 15000, // heartbeat only — SSE drives the live updates
  });
  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api<{ generations: GenerationDto[] }>("/v1/generations?favorites=1"),
    enabled: mode === "favorites",
  });

  const active = jobs.data?.jobs.filter((j) => j.status === "queued" || j.status === "running") ?? [];
  const done = jobs.data?.jobs.filter((j) => j.status !== "queued" && j.status !== "running") ?? [];
  useJobEvents(active.map((j) => j.id));

  const cancel = useMutation({
    mutationFn: (id: string) => api<{ cancelled: boolean }>(`/v1/generations/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="display-font text-[22px] uppercase">{mode === "favorites" ? "我的收藏" : "我的生成"}</h1>
        {mode === "all" && (
          <div className="ml-auto flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#141414] p-1">
            {(["all", "image", "video"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold capitalize ${filter === k ? "bg-[#262626] text-white" : "text-[#9a9a9a]"}`}
              >
                {k === "all" ? "全部" : k === "image" ? "图片" : "视频"}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "favorites" ? (
        favorites.data?.generations.length ? (
          <div className="columns-2 gap-3 md:columns-3 xl:columns-5 [&>*]:mb-3">
            {favorites.data.generations.map((g) => (
              <div key={g.id} className="break-inside-avoid overflow-hidden rounded-xl border border-[#1e1e1e]">
                <img src={g.url} alt="" className="w-full object-cover" />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-[13px] text-[#6f6f6f]">还没有收藏——在生成卡片上点心形图标。</div>
        )
      ) : (
        <>
          {active.length > 0 && (
            <>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#6f6f6f]">进行中</div>
              <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                {active.map((job) => (
                  <div key={job.id} className="overflow-hidden rounded-xl border border-[#242424] bg-[#121212]">
                    <div className="grid h-36 place-items-center px-6">
                      <div className="w-full text-center">
                        <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#242424]">
                          <div className="h-full rounded-full bg-[#ddf24b] transition-all" style={{ width: `${job.progress}%` }} />
                        </div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8a8a]">
                          {STATUS_LABELS[job.status] ?? job.status} {job.progress}%
                        </div>
                        <button
                          onClick={() => cancel.mutate(job.id)}
                          disabled={cancel.isPending}
                          className="mt-2 rounded-lg border border-[#3a3a3a] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9a9a9a] transition-colors hover:border-rose-400 hover:text-rose-300 disabled:opacity-50"
                        >
                          {cancel.isPending ? "取消中…" : "取消"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {done.length > 0 ? (
            <JobList jobs={done} />
          ) : (
            active.length === 0 && <div className="py-20 text-center text-[13px] text-[#6f6f6f]">这里还什么都没有——去首页生成。</div>
          )}
        </>
      )}
    </div>
  );
}
