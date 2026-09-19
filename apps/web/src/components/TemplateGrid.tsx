import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Kind, TemplateCategory, TemplateDto } from "@studio/shared";

const CATEGORIES: Array<{ id: TemplateCategory | "all"; label: string; icon: string }> = [
  { id: "all", label: "All", icon: "▦" },
  { id: "product-shot", label: "Product shot", icon: "◎" },
  { id: "motion", label: "Motion", icon: "⟳" },
  { id: "ugc", label: "UGC", icon: "☺" },
  { id: "ads", label: "Ads", icon: "▭" },
  { id: "posters", label: "Posters", icon: "▤" },
  { id: "marketplace", label: "Marketplace", icon: "▧" },
];

export function TemplateGrid({ onRecreate }: { onRecreate: (t: TemplateDto) => void }) {
  const [category, setCategory] = useState<TemplateCategory | "all">("all");
  const [kind, setKind] = useState<Kind | "all">("all");

  const templates = useQuery({
    queryKey: ["templates", category, kind],
    queryFn: () =>
      api<{ templates: TemplateDto[] }>(
        `/v1/templates?category=${category}&kind=${kind}`,
      ),
  });

  return (
    <section className="mx-auto w-full max-w-[1500px] px-6 pb-14">
      <h2 className="display-font mb-4 text-[20px] uppercase">Explore Templates</h2>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
              category === c.id
                ? "border-neutral-500 bg-[#222] text-white"
                : "border-[#2a2a2a] bg-[#141414] text-[#9a9a9a] hover:border-neutral-600"
            }`}
          >
            <span className="text-[11px] opacity-80">{c.icon}</span>
            {c.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#141414] p-1">
          {(["all", "image", "video"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${
                kind === k ? "bg-[#262626] text-white" : "text-[#9a9a9a]"
              }`}
            >
              {k === "all" ? "All" : `${k}s`}
            </button>
          ))}
        </div>
      </div>

      <div className="columns-2 gap-3 md:columns-3 xl:columns-6 [&>*]:mb-3">
        {templates.data?.templates.map((t) => (
          <div key={t.id} className="group relative break-inside-avoid overflow-hidden rounded-xl border border-[#1e1e1e]">
            <img src={t.thumbUrl} alt={t.title} className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => onRecreate(t)}
                className="rounded-lg bg-[#ddf24b] px-4 py-1.5 text-[11px] font-black uppercase tracking-wide text-black"
              >
                Recreate ✦{t.credits}
              </button>
            </div>
            <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
              {t.category.replace("-", " ")}
            </span>
          </div>
        ))}
      </div>
      {templates.data?.templates.length === 0 && (
        <div className="py-16 text-center text-[13px] text-[#6f6f6f]">No templates in this filter.</div>
      )}
    </section>
  );
}
