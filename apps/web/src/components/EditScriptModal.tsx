import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { Modal } from "./Modal";
import type { AdDNA } from "@studio/shared";

interface ScriptData {
  jobId: string;
  source: string;
  language: "zh" | "en";
  dna: AdDNA;
  beatTexts: Array<{ index: number; text: string }>;
}

/**
 * Edit-and-rerender: per-beat script editing. Beats stay the time authority —
 * edited texts re-fill the same AdDNA windows, so re-rendered timing reflows
 * automatically and the replica contract is re-verified on submit.
 */
export function EditScriptModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const script = useQuery({
    queryKey: ["script", jobId],
    queryFn: () => api<ScriptData>(`/v1/generations/${jobId}/script`),
  });
  const [texts, setTexts] = useState<Array<{ index: number; text: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beats = texts ?? script.data?.beatTexts ?? [];
  const dna = script.data?.dna;

  const rerender = useMutation({
    mutationFn: () =>
      api<{ job: { id: string } }>(`/v1/generations/${jobId}/rerender`, {
        method: "POST",
        json: { beatTexts: beats },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Request failed"),
  });

  return (
    <Modal title="Edit Script" onClose={onClose} width="max-w-2xl">
      <h2 className="display-font mb-2 text-[24px] uppercase leading-tight">Tune the script</h2>
      <p className="mb-4 max-w-md text-[13px] leading-relaxed text-[#9a9a9a]">
        Edit the lines beat by beat — the rhythm, cuts and captions reflow to the same beat windows automatically.
      </p>
      {script.isLoading && <div className="py-8 text-center text-[13px] text-[#6f6f6f]">Loading script…</div>}
      {script.isError && <div className="py-8 text-center text-[13px] text-rose-400">No editable script on this job.</div>}
      {script.data && (
        <div className="mb-4 space-y-3">
          {beats.map((beat, i) => {
            const role = dna?.beats[i]?.role ?? "";
            const seconds = dna ? (dna.beats[i]!.endSec - dna.beats[i]!.startSec).toFixed(1) : "?";
            const [min, max] = dna?.beats[i]?.targetWords ?? [0, 999];
            return (
              <div key={i} className="rounded-xl border border-[#2a2a2a] bg-[#101010] p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded-md bg-[#262626] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#ddf24b]">
                    {role}
                  </span>
                  <span className="text-[10px] text-[#6f6f6f]">{seconds}s · {min}–{max} words</span>
                </div>
                <textarea
                  rows={2}
                  value={beat.text}
                  onChange={(e) =>
                    setTexts((prev) => {
                      const base = prev ?? script.data!.beatTexts;
                      return base.map((b, bi) => (bi === i ? { ...b, text: e.target.value } : b));
                    })
                  }
                  className="w-full resize-none rounded-lg border border-[#2e2e2e] bg-[#0e0e0e] p-2.5 text-[13px] text-neutral-200"
                />
              </div>
            );
          })}
        </div>
      )}
      {error && <div className="mb-2 text-[12px] text-rose-400">{error}</div>}
      <button
        disabled={script.isLoading || rerender.isPending || beats.length === 0}
        onClick={() => rerender.mutate()}
        className="w-full rounded-xl bg-[#ddf24b] py-3 text-[13px] font-black uppercase tracking-wide text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {rerender.isPending ? "Queuing…" : "Re-render with edits"}
      </button>
    </Modal>
  );
}
