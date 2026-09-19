import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { PromptBar } from "../components/PromptBar";
import { HeroCarousel } from "../components/HeroCarousel";
import { TemplateGrid } from "../components/TemplateGrid";
import { RecreateModal, AdReferenceModal, ProductLinkModal } from "../components/ToolModals";
import type { TemplateDto, CreditState } from "@studio/shared";
import { useEffect } from "react";

export function Home() {
  const [recreateTarget, setRecreateTarget] = useState<TemplateDto | null>(null);
  const [adOpen, setAdOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const templates = useQuery({
    queryKey: ["templates", "all", "all"],
    queryFn: () => api<{ templates: TemplateDto[] }>("/v1/templates?category=all&kind=all"),
  });
  const credits = useQuery({
    queryKey: ["credits"],
    queryFn: () => api<CreditState>("/v1/credits"),
    refetchInterval: 5000,
  });

  // Sidebar tool buttons are rendered outside the router context; bridge via custom events.
  useEffect(() => {
    const handler = (e: Event) => {
      const tool = (e as CustomEvent<string>).detail;
      if (tool === "ad-reference") setAdOpen(true);
      if (tool === "product-link") setLinkOpen(true);
    };
    window.addEventListener("studio:tool", handler);
    return () => window.removeEventListener("studio:tool", handler);
  }, []);

  return (
    <div className="pb-10">
      <div className="flex justify-center pt-4">
        <span className="rounded-full border border-[#333] bg-[#141414] px-3.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-neutral-300">
          Marketing Studio
        </span>
      </div>

      <HeroCarousel templates={templates.data?.templates ?? []} />

      <div className="mb-6 text-center">
        <h1 className="display-font text-[38px] uppercase leading-[1.05] text-white">Turn any product</h1>
        <h1 className="display-font text-[38px] uppercase leading-[1.05] text-[#5f5f5f]">Into ready to post content</h1>
        {credits.data && (
          <div className="mt-2 text-[12px] font-semibold text-[#8a8a8a]">Balance ✦ {credits.data.balance} credits</div>
        )}
      </div>

      <PromptBar />

      <div className="mt-12">
        <TemplateGrid onRecreate={setRecreateTarget} />
      </div>

      {recreateTarget && <RecreateModal template={recreateTarget} onClose={() => setRecreateTarget(null)} />}
      {adOpen && <AdReferenceModal onClose={() => setAdOpen(false)} />}
      {linkOpen && <ProductLinkModal onClose={() => setLinkOpen(false)} />}
    </div>
  );
}
