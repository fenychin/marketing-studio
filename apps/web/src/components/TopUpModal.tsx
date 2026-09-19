import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { Modal } from "./Modal";

const PACKS = [
  { credits: 500, price: "$4.90" },
  { credits: 2000, price: "$19.00" },
  { credits: 10000, price: "$79.00" },
];

/** Credit top-up over the billing abstraction (mock provider confirms instantly). */
export function TopUpModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(2000);
  const [error, setError] = useState<string | null>(null);

  const purchase = useMutation({
    mutationFn: async (credits: number) => {
      const session = await api<{ sessionId: string; amountCents: number }>("/v1/billing/checkout", {
        method: "POST",
        json: { credits, provider: "mock" },
      });
      // A real gateway redirects to checkoutUrl and confirms via webhook.
      return api<{ status: string; credits: number }>("/v1/billing/mock/confirm", {
        method: "POST",
        json: { sessionId: session.sessionId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Request failed"),
  });

  return (
    <Modal title="Top up credits" onClose={onClose} width="max-w-md">
      <div className="space-y-2.5">
        {PACKS.map((p) => (
          <button
            key={p.credits}
            onClick={() => setSelected(p.credits)}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
              selected === p.credits ? "border-[#ddf24b] bg-[#161a08]" : "border-[#2e2e2e] bg-[#101010] hover:border-[#4a4a4a]"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-[15px] font-black">✦ {p.credits.toLocaleString()}</span>
              <span className="text-[11px] uppercase tracking-wide text-[#6f6f6f]">credits</span>
            </span>
            <span className="text-[13px] font-bold text-neutral-200">{p.price}</span>
          </button>
        ))}
      </div>
      {error && <div className="mt-3 text-[12px] text-rose-400">{error}</div>}
      <button
        disabled={purchase.isPending}
        onClick={() => purchase.mutate(selected)}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#e80f7c] to-[#f0559a] py-3 text-[13px] font-black uppercase tracking-[0.12em] text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {purchase.isPending ? "Processing…" : `Purchase ✦ ${selected.toLocaleString()}`}
      </button>
      <div className="mt-2 text-center text-[10px] text-[#5f5f5f]">Sandbox checkout — wire a real provider via the billing adapter.</div>
    </Modal>
  );
}
