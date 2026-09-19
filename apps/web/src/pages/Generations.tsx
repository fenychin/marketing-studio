import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { JobList } from "../components/JobList";
import type { JobDto, GenerationDto, Kind } from "@studio/shared";

export function Generations({ mode }: { mode: "all" | "favorites" }) {
  const [filter, setFilter] = useState<Kind | "all">("all");

  const jobs = useQuery({
    queryKey: ["jobs", filter, mode],
    queryFn: () => api<{ jobs: JobDto[] }>(`/v1/generations${filter === "all" ? "" : `?kind=${filter}`}`),
    refetchInterval: 2500,
  });
  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api<{ generations: GenerationDto[] }>("/v1/generations?favorites=1"),
    enabled: mode === "favorites",
  });

  const active = jobs.data?.jobs.filter((j) => j.status === "queued" || j.status === "running") ?? [];
  const done = jobs.data?.jobs.filter((j) => j.status !== "queued" && j.status !== "running") ?? [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="display-font text-[22px] uppercase">{mode === "favorites" ? "My Favorites" : "My Generations"}</h1>
        {mode === "all" && (
          <div className="ml-auto flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#141414] p-1">
            {(["all", "image", "video"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold capitalize ${filter === k ? "bg-[#262626] text-white" : "text-[#9a9a9a]"}`}
              >
                {k === "all" ? "All" : `${k}s`}
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
          <div className="py-20 text-center text-[13px] text-[#6f6f6f]">Nothing favorited yet — tap the heart on any generation.</div>
        )
      ) : (
        <>
          {active.length > 0 && (
            <>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#6f6f6f]">In progress</div>
              <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                {active.map((job) => (
                  <div key={job.id} className="overflow-hidden rounded-xl border border-[#242424] bg-[#121212]">
                    <div className="grid h-36 place-items-center px-6">
                      <div className="w-full text-center">
                        <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#242424]">
                          <div className="h-full rounded-full bg-[#ddf24b] transition-all" style={{ width: `${job.progress}%` }} />
                        </div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8a8a]">
                          {job.status} {job.progress}%
                        </div>
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
            active.length === 0 && <div className="py-20 text-center text-[13px] text-[#6f6f6f]">Nothing here yet — generate from Home.</div>
          )}
        </>
      )}
    </div>
  );
}
