import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { RecreateReport } from "@studio/shared";

/**
 * Replica verification gates (beat structure, durations, word windows,
 * energy curve, hook/CTA positions, canvas) from the job's AdDNA
 * recreate-report. Presentational: the toggle chip lives in the card's
 * badge row so it can never collide with the panel below the media.
 */
export function RecreateReportGates({ jobId, open }: { jobId: string; open: boolean }) {
  const query = useQuery({
    queryKey: ["report", jobId],
    queryFn: () => api<{ report: RecreateReport }>(`/v1/generations/${jobId}/recreate-report`),
    enabled: open,
  });

  if (!open) return null;
  return (
    <div className="rounded-lg border border-[#242424] bg-[#0d0d0d] p-2 text-left">
      {query.isLoading && <div className="text-[11px] text-[#6f6f6f]">加载中…</div>}
      {query.isError && (
        <div className="text-[11px] text-[#7a7a7a]">
          {query.error instanceof ApiError && query.error.status === 404
            ? "该作业没有复刻验收数据。"
            : "报告不可用。"}
        </div>
      )}
      {query.data && (
        <>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-300">
              复刻验收门
            </span>
            <span
              className={`text-[10px] font-bold ${query.data.report.score === 1 ? "text-[#c7e34c]" : "text-amber-300"}`}
            >
              {Math.round(query.data.report.score * 100)}%
            </span>
          </div>
          <ul className="space-y-1">
            {query.data.report.gates.map((gate) => (
              <li key={gate.key} className="flex items-start gap-1.5">
                <span className={`text-[10px] leading-4 ${gate.pass ? "text-[#c7e34c]" : "text-rose-400"}`}>
                  {gate.pass ? "✓" : "✗"}
                </span>
                <span className="leading-4">
                  <span className="text-[10px] font-semibold text-neutral-300">{gate.label}</span>{" "}
                  <span className="text-[9px] text-[#6f6f6f]">{gate.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
