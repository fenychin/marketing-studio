import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Icon, icons } from "./Icons";
import type { GenerationDto, JobDto } from "@studio/shared";

function GenerationCard({ generation }: { generation: GenerationDto }) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["favorites"] });
  };
  const toggle = useMutation({
    mutationFn: () =>
      api(`/v1/generations/item/${generation.id}/favorite`, { method: "POST", json: { favorite: !generation.favorite } }),
    onSuccess: invalidate,
  });
  const review = useMutation({
    mutationFn: (verdict: "approved" | "rejected") =>
      api(`/v1/generations/item/${generation.id}/review`, { method: "POST", json: { verdict } }),
    onSuccess: invalidate,
  });
  const regenerate = useMutation({
    mutationFn: () => api(`/v1/generations/item/${generation.id}/regenerate`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const rejected = generation.reviewStatus === "rejected";
  const approved = generation.reviewStatus === "approved";

  return (
    <div className={`group relative overflow-hidden rounded-xl border border-[#1e1e1e] ${rejected ? "opacity-50" : ""}`}>
      {generation.kind === "video" ? (
        generation.url.endsWith(".mp4") ? (
          <video src={generation.url} controls loop className="w-full object-cover" />
        ) : (
          <div className="relative">
            <img src={generation.url} alt="" className="w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white">▶</span>
            </span>
          </div>
        )
      ) : (
        <img src={generation.url} alt="" className="w-full object-cover" />
      )}

      {/* QC + review badges */}
      <div className="absolute left-2 top-2 flex gap-1">
        {generation.qcStatus === "passed" && (
          <span className="rounded-md bg-[#1d2a08]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#c7e34c]">QC ✓</span>
        )}
        {generation.qcStatus === "flagged" && (
          <span className="rounded-md bg-[#3a2508]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">QC ⚠</span>
        )}
        {approved && (
          <span className="rounded-md bg-[#122a12]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Approved</span>
        )}
        {rejected && (
          <span className="rounded-md bg-[#2a0d12]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300">Rejected</span>
        )}
      </div>

      {/* favorite + review actions */}
      <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => review.mutate("approved")}
          className={`grid h-7 w-7 place-items-center rounded-full bg-black/60 text-emerald-300 hover:bg-black/80 ${approved ? "opacity-100" : ""}`}
          aria-label="Approve"
        >
          ✓
        </button>
        <button
          onClick={() => review.mutate("rejected")}
          className={`grid h-7 w-7 place-items-center rounded-full bg-black/60 text-rose-300 hover:bg-black/80 ${rejected ? "opacity-100" : ""}`}
          aria-label="Reject"
        >
          ✕
        </button>
        <button
          onClick={() => toggle.mutate()}
          className={`grid h-7 w-7 place-items-center rounded-full bg-black/60 transition-opacity ${
            generation.favorite ? "text-rose-400 opacity-100" : "text-white"
          }`}
          aria-label="Favorite"
        >
          <Icon path={icons.heart} size={14} />
        </button>
      </div>

      {rejected && (
        <button
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
          className="absolute bottom-9 right-2 rounded-lg bg-[#ddf24b] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-black disabled:opacity-50"
        >
          {regenerate.isPending ? "Re-rendering…" : "Free re-render"}
        </button>
      )}

      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
        {generation.model}
      </span>
    </div>
  );
}

function JobProgressCard({ job }: { job: JobDto }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#242424] bg-[#121212]">
      <div className="grid h-40 place-items-center">
        <div className="w-3/4 text-center">
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#242424]">
            <div className="h-full rounded-full bg-[#ddf24b] transition-all" style={{ width: `${job.progress}%` }} />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8a8a]">
            {job.status === "failed" ? `Failed — ${job.error ?? "error"}` : `${job.status} ${job.progress}%`}
          </div>
        </div>
      </div>
      <div className="border-t border-[#1e1e1e] px-3 py-2 text-[11px] text-[#6f6f6f]">{job.prompt.slice(0, 90)}…</div>
    </div>
  );
}

export function JobList({ jobs }: { jobs: JobDto[] }) {
  const items: Array<{ key: string; node: React.ReactNode }> = [];
  for (const job of jobs) {
    if (job.status === "succeeded") {
      for (const generation of job.generations) {
        items.push({ key: generation.id, node: <GenerationCard generation={generation} /> });
      }
    } else {
      items.push({ key: job.id, node: <JobProgressCard job={job} /> });
    }
  }
  return (
    <div className="columns-2 gap-3 md:columns-3 xl:columns-5 [&>*]:mb-3">
      {items.map((item) => (
        <div key={item.key} className="break-inside-avoid">
          {item.node}
        </div>
      ))}
    </div>
  );
}
