import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Icon, icons } from "./Icons";
import { RecreateReportGates } from "./RecreateReport";
import { EditScriptModal } from "./EditScriptModal";
import type { GenerationDto, JobDto } from "@studio/shared";

const PLATFORM_LABELS: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts" };

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "渲染中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

interface AgentMeta {
  source?: string;
  platform?: string;
  renderer?: string;
}

function GenerationCard({ generation, job }: { generation: GenerationDto; job: JobDto }) {
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
  const agent = (job.params.agent ?? {}) as AgentMeta;
  const [showReport, setShowReport] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const replica = agent.source === "product-link" || agent.source === "ad-reference" || agent.source === "edit";
  // artifact URLs carry ?t= access tokens — strip before format checks
  const isMp4 = generation.url.split("?")[0]!.endsWith(".mp4");

  return (
    <div className={`group overflow-hidden rounded-xl border border-[#1e1e1e] ${rejected ? "opacity-50" : ""}`}>
      <div className="relative">
      {generation.kind === "video" ? (
        isMp4 ? (
          <video src={generation.url} controls loop className="aspect-[9/16] w-full bg-black object-cover" />
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
          <span className="rounded-md bg-[#1d2a08]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#c7e34c]">质检 ✓</span>
        )}
        {generation.qcStatus === "flagged" && (
          <span className="rounded-md bg-[#3a2508]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">质检 ⚠</span>
        )}
        {approved && (
          <span className="rounded-md bg-[#122a12]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">已通过</span>
        )}
        {rejected && (
          <span className="rounded-md bg-[#2a0d12]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300">已驳回</span>
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
          {regenerate.isPending ? "重渲中…" : "免费重渲"}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
        <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
          {generation.model}
        </span>
        {agent.source === "product-link" && agent.platform && (
          <span className="rounded-md bg-[#e80f7c]/85 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            {PLATFORM_LABELS[agent.platform] ?? agent.platform}
          </span>
        )}
        {agent.source === "ad-reference" && (
          <span className="rounded-md bg-[#7c3aed]/85 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Ad DNA
          </span>
        )}
        {replica && (
          <button
            onClick={() => setShowEditor(true)}
            className="rounded-md border border-[#333] bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-200 transition-colors hover:border-neutral-500"
          >
            ✎ 编辑
          </button>
        )}
        {replica && (
          <button
            onClick={() => setShowReport((v) => !v)}
            className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
              showReport ? "bg-[#ddf24b] text-black" : "bg-black/60 text-[#9adf2a] hover:bg-black/80"
            }`}
          >
            {showReport ? "✕ 报告" : "✦ 报告"}
          </button>
        )}
      </div>
      </div>
      {replica && (
        <div className="px-1 pb-1">
          <RecreateReportGates jobId={job.id} open={showReport} />
        </div>
      )}
      {showEditor && <EditScriptModal jobId={job.id} onClose={() => setShowEditor(false)} />}
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
            {job.status === "failed" ? `失败 — ${job.error ?? "未知错误"}` : `${STATUS_LABELS[job.status] ?? job.status} ${job.progress}%`}
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
        items.push({ key: generation.id, node: <GenerationCard generation={generation} job={job} /> });
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
