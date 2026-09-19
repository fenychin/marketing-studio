import { useEffect, useState } from "react";
import type { TemplateDto } from "@studio/shared";

/**
 * Fanned hero carousel: five programmatic template cards, the center one
 * highlighted, auto-rotating. Mirrors the reference layout without using any
 * third-party imagery — cards render live placeholder art from the API.
 */
export function HeroCarousel({ templates }: { templates: TemplateDto[] }) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (templates.length < 5) return;
    const timer = setInterval(() => setOffset((o) => o + 1), 3600);
    return () => clearInterval(timer);
  }, [templates.length]);

  if (templates.length === 0) return <div className="h-[300px]" />;
  const pick = (i: number) => templates[(((i + offset) % templates.length) + templates.length) % templates.length]!;
  const slots = [-2, -1, 0, 1, 2];

  return (
    <div className="relative mx-auto flex h-[290px] items-center justify-center [perspective:900px]">
      {slots.map((slot) => {
        const t = pick(slot);
        const center = slot === 0;
        return (
          <div
            key={`${t.id}-${slot}`}
            className={`absolute overflow-hidden rounded-2xl shadow-[0_18px_50px_rgba(0,0,0,0.6)] transition-all duration-700 ease-out ${
              center ? "z-20 h-[230px] w-[188px]" : "z-10 h-[170px] w-[142px] opacity-90"
            }`}
            style={{
              transform: center
                ? "translateX(0) rotateY(0deg)"
                : `translateX(${slot * 150}px) rotateY(${slot * -14}deg) scale(0.94)`,
              filter: center ? "brightness(1)" : "brightness(0.8)",
            }}
          >
            <img src={t.thumbUrl} alt={t.title} className="h-full w-full object-cover" />
            {center && (
              <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white">
                {t.kind === "video" ? "🎬 Motion" : "⦿ Product shot"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
